import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { extractAssetReferences, extractInternalPathReferences } from "@/lib/content/entryValidation";
import { getLocalizationStatus } from "@/lib/content/localizationService";
import { getWebQualityPolicy, DEFAULT_MEDIA_BUDGET, DEFAULT_QUALITY_SETTINGS } from "@/lib/content/webQualityService";
import type { PreflightResult } from "@/lib/content/preflightRules";
import type { CanonicalSchema, FieldDefinition } from "@/lib/schema/fields/types";
import { normalizePath } from "@/lib/routing/routeService";

export interface AssuranceDestination {
  routeId: string;
  locale: string;
  path: string;
  canonical: boolean;
  indexingPolicy: string;
  sitemapIncluded: boolean;
  url: string;
}

export interface DestinationAssuranceReport {
  results: PreflightResult[];
  destinations: AssuranceDestination[];
  toolingBoundary: string;
}

const result = (rule_id:string, category:string, status:"pass"|"warning"|"fail"|"skipped", message:string, options:Partial<PreflightResult>={}) : PreflightResult => ({
  rule_id, category, severity: status === "fail" ? "blocking" : status === "warning" ? "warning" : "info", status, message, ...options,
});
const pass=(id:string,cat:string,msg:string,evidence?:Record<string,unknown>)=>result(id,cat,"pass",msg,{evidence});
const warn=(id:string,cat:string,msg:string,field?:string,action?:string,evidence?:Record<string,unknown>)=>result(id,cat,"warning",msg,{field,recommended_action:action,evidence});
const fail=(id:string,cat:string,msg:string,field?:string,action?:string,evidence?:Record<string,unknown>)=>result(id,cat,"fail",msg,{field,recommended_action:action,evidence});
const present=(v:unknown)=>v!==undefined&&v!==null&&v!==""&&(!Array.isArray(v)||v.length>0);

function semantic(field:FieldDefinition): string {
  const hints = field.uiHints ?? {};
  return String(hints.semantic ?? hints.semanticRole ?? hints.role ?? "").trim().toLowerCase();
}
function findField(schema:CanonicalSchema, keys:string[], semantics:string[]=[]): FieldDefinition | undefined {
  const bySemantic=schema.fields.find((f)=>semantics.includes(semantic(f)));
  return bySemantic ?? schema.fields.find((f)=>keys.includes(f.key));
}
function text(data:Record<string,unknown>, field?:FieldDefinition){const v=field?data[field.key]:undefined;return typeof v==="string"?v.trim():"";}
function schemaOrgValue(value:unknown):Record<string,unknown>|null{
  if(value&&typeof value==="object"&&!Array.isArray(value))return value as Record<string,unknown>;
  if(typeof value==="string"&&value.trim()){try{const parsed=JSON.parse(value);return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:null;}catch{return null;}}
  return null;
}
function absolute(base:string|null,path:string){return base?`${base.replace(/\/$/,"")}${path==="/"?"":path}`:path;}

export async function evaluateDestinationAssurance(params:{workspaceId:string;entryId:string;versionId:string;schema:CanonicalSchema;data:Record<string,unknown>;locale:string}):Promise<DestinationAssuranceReport>{
  const db=createServiceRoleClient();
  const policy=await getWebQualityPolicy(params.workspaceId);
  const mediaBudget={...DEFAULT_MEDIA_BUDGET,...policy.media_budget_json} as typeof DEFAULT_MEDIA_BUDGET;
  const settings={...DEFAULT_QUALITY_SETTINGS,...policy.settings_json} as typeof DEFAULT_QUALITY_SETTINGS;
  const findings:PreflightResult[]=[];

  const {data:routes}=await db.from("content_routes").select("id,entry_id,locale,path,title,parent_route_id,is_canonical,status,indexing_policy,sitemap_included,sitemap_priority,sitemap_changefreq").eq("workspace_id",params.workspaceId).eq("entry_id",params.entryId).neq("status","archived");
  const canonical=(routes??[]).find((r)=>r.is_canonical&&r.locale===params.locale&&r.status==="active") ?? null;
  const destinations:AssuranceDestination[]=(routes??[]).filter((r)=>r.status==="active").map((r)=>({routeId:r.id,locale:r.locale,path:r.path,canonical:r.is_canonical,indexingPolicy:r.indexing_policy,sitemapIncluded:r.sitemap_included,url:absolute(policy.site_base_url,r.path)}));

  if(policy.require_canonical_route){
    findings.push(canonical?pass("destination.canonical_route","Destination","An active canonical route exists for this locale.",{routeId:canonical.id,path:canonical.path,locale:canonical.locale,url:absolute(policy.site_base_url,canonical.path)}):fail("destination.canonical_route","Destination",`No active canonical route exists for locale ${params.locale}.`,undefined,"Assign an active canonical route before publication.",{locale:params.locale}));
  }else if(!canonical) findings.push(warn("destination.canonical_route","Destination",`No canonical route exists for locale ${params.locale}.`,undefined,"Assign a canonical route if this content should be discoverable."));

  if(canonical){
    const {data:sourceRedirect}=await db.from("content_redirects").select("id,target_path,status_code").eq("workspace_id",params.workspaceId).eq("source_path",canonical.path).eq("is_active",true).or(`locale.eq.${params.locale},locale.is.null`).limit(1).maybeSingle();
    if(sourceRedirect) findings.push(fail("destination.redirect_collision","Destination","The canonical route path is also an active redirect source.",undefined,"Remove the redirect or change the canonical route.",{routeId:canonical.id,path:canonical.path,redirectId:sourceRedirect.id,targetPath:sourceRedirect.target_path}));
    else findings.push(pass("destination.redirect_collision","Destination","Canonical route does not collide with an active redirect.",{path:canonical.path}));
    if(canonical.indexing_policy==="noindex") findings.push(warn("seo.noindex_canonical","SEO / Web Quality","The canonical route is explicitly noindex.",undefined,"Confirm noindex is intentional before publication.",{path:canonical.path}));
    if(canonical.indexing_policy==="noindex"&&canonical.sitemap_included) findings.push(fail("seo.noindex_sitemap_conflict","SEO / Web Quality","The canonical route is noindex but still included in the sitemap.",undefined,"Disable sitemap inclusion or allow indexing.",{path:canonical.path}));
  }

  // Managed internal links: an active route or redirect must resolve the path.
  const internalRefs=extractInternalPathReferences(params.schema,params.data);
  let brokenLinks=0;
  for(const ref of internalRefs){
    const norm=normalizePath(ref.path); if(!norm.ok) continue;
    const {data:route}=await db.from("content_routes").select("id,path,status").eq("workspace_id",params.workspaceId).eq("locale",params.locale).eq("path",norm.path).neq("status","archived").limit(1).maybeSingle();
    if(route) continue;
    const {data:redirect}=await db.from("content_redirects").select("id,target_path").eq("workspace_id",params.workspaceId).eq("source_path",norm.path).eq("is_active",true).or(`locale.eq.${params.locale},locale.is.null`).limit(1).maybeSingle();
    if(!redirect){brokenLinks++;findings.push(fail("link.internal_broken","Internal Links",`Internal link ${norm.path} does not resolve to a managed route or redirect.`,ref.fieldKey,"Create the destination route/redirect or correct the link.",{path:norm.path,locale:params.locale}));continue;}
    if(!/^https?:\/\//i.test(redirect.target_path)){
      const {data:second}=await db.from("content_redirects").select("id").eq("workspace_id",params.workspaceId).eq("source_path",redirect.target_path).eq("is_active",true).limit(1).maybeSingle();
      if(second)findings.push(warn("link.redirect_chain","Internal Links",`Internal link ${norm.path} resolves through more than one redirect hop.`,ref.fieldKey,"Point the content directly at the final canonical route.",{path:norm.path,targetPath:redirect.target_path}));
    }
  }
  if(!brokenLinks)findings.push(pass("link.internal_integrity","Internal Links","All detected internal links resolve to managed destinations."));

  // Breadcrumb chain from the canonical route.
  if(canonical){
    const {data:allRoutes}=await db.from("content_routes").select("id,parent_route_id,path,title,locale").eq("workspace_id",params.workspaceId).eq("locale",params.locale).neq("status","archived");
    const byId=new Map((allRoutes??[]).map((r)=>[r.id,r]));
    const seen=new Set<string>(); let current=canonical; let depth=0; let breadcrumbBlocked=false;
    while(current.parent_route_id){
      if(seen.has(current.id)||depth++>32){breadcrumbBlocked=true;findings.push(fail("navigation.breadcrumb_cycle","Breadcrumbs","Canonical route ancestry contains a cycle or exceeds 32 levels.",undefined,"Repair the managed site tree before publication.",{routeId:canonical.id,path:canonical.path}));break;}
      seen.add(current.id); const parent=byId.get(current.parent_route_id);
      if(!parent){breadcrumbBlocked=true;findings.push(fail("navigation.breadcrumb_missing_parent","Breadcrumbs","A canonical route parent is missing.",undefined,"Repair the parent route relationship.",{routeId:canonical.id,path:canonical.path}));break;}
      if(!parent.title)findings.push(warn("navigation.breadcrumb_untitled","Breadcrumbs",`Breadcrumb ancestor ${parent.path} has no managed title.`,undefined,"Add a route title for accessible breadcrumb labels.",{routeId:parent.id,path:parent.path}));
      current=parent as typeof canonical;
    }
    if(!breadcrumbBlocked)findings.push(pass("navigation.breadcrumb_chain","Breadcrumbs","Managed breadcrumb ancestry is structurally valid.",{depth}));
  }

  // SEO metadata and semantic metadata.
  const titleField=findField(params.schema,["seo_title","meta_title","title","name"],["seo_title","title"]);
  const descField=findField(params.schema,["meta_description","seo_description","summary","description"],["meta_description","seo_description"]);
  const canonicalField=findField(params.schema,["canonical_url"],["canonical_url"]);
  const socialTitleField=findField(params.schema,["og_title","social_title"],["og_title","social_title"]);
  const socialDescField=findField(params.schema,["og_description","social_description"],["og_description","social_description"]);
  const socialImageField=findField(params.schema,["social_image","og_image"],["social_image","og_image"]);
  const schemaField=findField(params.schema,["schema_org","schema_jsonld","structured_data"],["schema_org","json_ld"]);
  const seoTitle=text(params.data,titleField);
  const seoDesc=text(params.data,descField);
  if(!seoTitle)findings.push(warn("seo.title_missing","SEO / Web Quality","No discoverability title is present.",titleField?.key,"Add a concise, unique title."));
  else if(seoTitle.length>60)findings.push(warn("seo.title_length","SEO / Web Quality",`Discoverability title is ${seoTitle.length} characters; search snippets may truncate it.`,titleField?.key,"Keep the title around 60 characters or fewer.",{length:seoTitle.length}));
  else findings.push(pass("seo.title","SEO / Web Quality","Discoverability title is present.",{length:seoTitle.length}));
  if(!seoDesc)findings.push(warn("seo.description_missing","SEO / Web Quality","Meta/SEO description is missing.",descField?.key,"Add a useful page summary."));
  else if(seoDesc.length<50||seoDesc.length>160)findings.push(warn("seo.description_length","SEO / Web Quality",`Meta description is ${seoDesc.length} characters.`,descField?.key,"Aim for roughly 50–160 characters.",{length:seoDesc.length}));
  else findings.push(pass("seo.description","SEO / Web Quality","Meta description length is within the editorial guideline.",{length:seoDesc.length}));
  const declaredCanonical=text(params.data,canonicalField);
  if(declaredCanonical&&canonical){
    const expected=absolute(policy.site_base_url,canonical.path);
    if(declaredCanonical!==canonical.path&&declaredCanonical!==expected)findings.push(fail("seo.canonical_mismatch","SEO / Web Quality","Content canonical URL does not match the managed canonical route.",canonicalField?.key,"Use the managed route as the canonical URL.",{declaredCanonical,managedCanonical:expected}));
    else findings.push(pass("seo.canonical_consistency","SEO / Web Quality","Declared canonical URL matches the managed canonical route."));
  }
  if(policy.require_social_card){
    const socialTitle=text(params.data,socialTitleField)||seoTitle;
    const socialDesc=text(params.data,socialDescField)||seoDesc;
    const socialImage=socialImageField?params.data[socialImageField.key]:undefined;
    if(!socialTitle)findings.push(fail("social.title","Social Cards","Social card title is required by workspace policy.",socialTitleField?.key,"Add an OpenGraph/social title."));
    if(!socialDesc)findings.push(fail("social.description","Social Cards","Social card description is required by workspace policy.",socialDescField?.key,"Add an OpenGraph/social description."));
    if(!present(socialImage))findings.push(fail("social.image","Social Cards","Social card image is required by workspace policy.",socialImageField?.key,"Select a social sharing image."));
    if(socialTitle&&socialDesc&&present(socialImage))findings.push(pass("social.card","Social Cards","Required social card metadata is present."));
  }
  const schemaValue=schemaField?schemaOrgValue(params.data[schemaField.key]):null;
  if(policy.require_schema_org&&!schemaValue)findings.push(fail("schema_org.missing","Structured Data","Schema.org structured data is required by workspace policy.",schemaField?.key,"Add a JSON-LD object with @context and @type."));
  else if(schemaValue){
    const context=String(schemaValue["@context"]??""); const type=schemaValue["@type"];
    if(!context.includes("schema.org")||!present(type))findings.push(fail("schema_org.invalid","Structured Data","Structured data must declare a schema.org @context and @type.",schemaField?.key,"Correct the JSON-LD semantic metadata."));
    else findings.push(pass("schema_org.valid","Structured Data","Schema.org JSON-LD has @context and @type.",{type}));
  }

  // Duplicate title among current workspace versions.
  if(seoTitle){
    const {data:entryRows}=await db.from("content_entries").select("id,current_draft_version_id,published_version_id").eq("workspace_id",params.workspaceId).neq("id",params.entryId);
    const ids=[...new Set((entryRows??[]).map((e)=>e.current_draft_version_id??e.published_version_id).filter((id):id is string=>Boolean(id)))];
    const {data:otherVersions}=ids.length?await db.from("content_entry_versions").select("entry_id,data_jsonb").in("id",ids):{data:[] as Array<{entry_id:string;data_jsonb:Record<string,unknown>}>};
    const duplicate=(otherVersions??[]).find((v)=>["seo_title","meta_title","title","name"].some((key)=>typeof v.data_jsonb?.[key]==="string"&&String(v.data_jsonb[key]).trim().toLocaleLowerCase()===seoTitle.toLocaleLowerCase()));
    if(duplicate)findings.push(warn("seo.duplicate_title","SEO / Web Quality","Another current entry uses the same discoverability title.",titleField?.key,"Use a distinct title for indexable destinations.",{conflictingEntryId:duplicate.entry_id}));
  }

  // Required localization / hreflang readiness applies to source entries, not translated children.
  const {data:asTranslation}=await db.from("content_entry_translations").select("id,source_entry_id,locale").eq("workspace_id",params.workspaceId).eq("translated_entry_id",params.entryId).limit(1).maybeSingle();
  if(!asTranslation){
    const localization=await getLocalizationStatus(params.workspaceId,params.entryId);
    if(localization){
      for(const locale of localization.filter((l)=>l.required&&!l.isDefault&&l.locale!==params.locale)){
        if(locale.status!=="current") findings.push(fail("localization.required_readiness","Localization",`Required locale ${locale.locale} is ${locale.status.replace("_"," ")}.`,undefined,"Create, approve and review the translation before coordinated publication.",{locale:locale.locale,status:locale.status,translatedEntryId:locale.translatedEntryId}));
        else if(settings.requireHreflangForRequiredLocales&&locale.translatedEntryId){
          const {data:altRoute}=await db.from("content_routes").select("id,path").eq("workspace_id",params.workspaceId).eq("entry_id",locale.translatedEntryId).eq("locale",locale.locale).eq("is_canonical",true).eq("status","active").limit(1).maybeSingle();
          if(!altRoute)findings.push(fail("localization.hreflang_destination","Localization",`Required locale ${locale.locale} is current but has no active canonical destination for hreflang.`,undefined,"Assign a canonical route to the translated entry.",{locale:locale.locale,translatedEntryId:locale.translatedEntryId}));
          else findings.push(pass("localization.hreflang_destination","Localization",`Required locale ${locale.locale} has a canonical alternate destination.`,{locale:locale.locale,path:altRoute.path,routeId:altRoute.id}));
        }
      }
    }
  }

  // Asset accessibility and delivery guardrails.
  const assetRefs=extractAssetReferences(params.schema,params.data);
  const assetIds=[...new Set(assetRefs.map((r)=>r.assetId))];
  const {data:assets}=assetIds.length?await db.from("assets").select("id,filename,mime_type,size_bytes,width,height,alt_text,metadata_json,archived_at").eq("workspace_id",params.workspaceId).in("id",assetIds):{data:[] as Array<{id:string;filename:string;mime_type:string;size_bytes:number;width:number|null;height:number|null;alt_text:string|null;metadata_json:Record<string,unknown>;archived_at:string|null}>};
  const assetMap=new Map((assets??[]).map((a)=>[a.id,a]));
  for(const ref of assetRefs){
    const asset=assetMap.get(ref.assetId); if(!asset){findings.push(fail("media.missing","Media / Accessibility","A referenced media asset is missing.",ref.fieldKey,"Choose an active workspace asset.",{assetId:ref.assetId}));continue;}
    if(asset.archived_at)findings.push(fail("media.archived","Media / Accessibility",`Asset ${asset.filename} is archived.`,ref.fieldKey,"Replace it with an active asset.",{assetId:asset.id}));
    if(asset.mime_type.startsWith("image/")){
      if(!asset.alt_text?.trim())findings.push(warn("a11y.image_alt","Media / Accessibility",`Image ${asset.filename} has no managed alternative text.`,ref.fieldKey,"Add useful alt text in the Media Library.",{assetId:asset.id}));
      if(!asset.width||!asset.height)findings.push(warn("media.dimensions","Media / Performance",`Image ${asset.filename} has unknown dimensions.`,ref.fieldKey,"Replace/reprocess the asset so intrinsic dimensions are known.",{assetId:asset.id}));
      if(Number(asset.size_bytes)>Number(mediaBudget.maxImageBytes))findings.push(warn("media.image_budget","Media / Performance",`Image ${asset.filename} exceeds the workspace image budget.`,ref.fieldKey,"Compress or replace the image before shipping.",{assetId:asset.id,sizeBytes:Number(asset.size_bytes),maxImageBytes:Number(mediaBudget.maxImageBytes)}));
      const hero=/hero|cover|banner|lcp/i.test(ref.fieldKey);
      if(hero&&Number(asset.size_bytes)>Number(mediaBudget.lcpWarningBytes))findings.push(warn("performance.lcp_asset_size","Media / Performance",`Likely LCP image ${asset.filename} is heavy for first render.`,ref.fieldKey,"Use a smaller responsive derivative and verify with Lighthouse/WebPageTest.",{assetId:asset.id,sizeBytes:Number(asset.size_bytes)}));
      if(hero&&asset.width&&asset.width<Number(mediaBudget.minLcpWidth))findings.push(warn("performance.lcp_dimensions","Media / Performance",`Likely LCP image ${asset.filename} may be too narrow for large displays.`,ref.fieldKey,"Provide a sufficiently wide responsive source.",{assetId:asset.id,width:asset.width,minLcpWidth:Number(mediaBudget.minLcpWidth)}));
      if(hero&&Array.isArray(mediaBudget.preferredImageFormats)&&!mediaBudget.preferredImageFormats.includes(asset.mime_type))findings.push(warn("performance.image_format","Media / Performance",`Likely LCP image ${asset.filename} uses ${asset.mime_type} rather than a preferred modern format.`,ref.fieldKey,"Prefer AVIF/WebP where delivery supports it.",{assetId:asset.id,mimeType:asset.mime_type}));
    }
  }
  if(assetRefs.length&&!findings.some((f)=>f.rule_id.startsWith("media.")||f.rule_id.startsWith("a11y.")||f.rule_id.startsWith("performance.")))findings.push(pass("media.guardrails","Media / Performance","Referenced media passes deterministic CMS guardrails."));

  for(const field of params.schema.fields.filter((f)=>/embed|iframe|video_url/i.test(f.key))){
    const value=params.data[field.key];
    if(typeof value==="string"&&value.trim()&&!/^https:\/\//i.test(value.trim()))findings.push(fail("embed.insecure","Embeds",`Embed field “${field.label}” must use HTTPS.`,field.key,"Use an HTTPS embed URL."));
  }

  const aiDefault=String(policy.ai_crawler_policy?.default??"allow");
  findings.push(result("ai_crawler.policy","AI Discovery","pass",`Workspace AI-crawler default policy is ${aiDefault}.`,{evidence:{policy:policy.ai_crawler_policy}}));

  return {results:findings,destinations,toolingBoundary:"CMS assurance validates deterministic content, metadata, route, graph, localization and asset invariants. It does not replace browser-based Lighthouse/WebPageTest accessibility or runtime performance measurement."};
}
