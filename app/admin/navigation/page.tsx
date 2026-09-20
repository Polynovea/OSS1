"use client";

import { useState, useEffect } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import {
  Compass,
  Plus,
  Rocket,
  Eye,
  Trash2,
  Edit2,
  AlertCircle,
  CheckCircle2,
  Layers,
  Globe,
  ExternalLink,
  Shield,
  Save,
} from "lucide-react";

interface Menu {
  id: string;
  key: string;
  name: string;
  description: string | null;
  current_draft_version_id: string | null;
  published_version_id: string | null;
}

interface NavItem {
  id: string;
  label: string;
  itemType: "internal_entry" | "internal_route" | "external_url";
  targetEntryId?: string | null;
  targetRouteId?: string | null;
  url?: string | null;
  openInNewTab?: boolean;
  audienceRule?: "all" | "authenticated" | "guest";
  orderIndex?: number;
  children?: NavItem[];
}

export default function NavigationPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [items, setItems] = useState<NavItem[]>([]);
  const [currentDraftVersion, setCurrentDraftVersion] = useState<any>(null);
  const [currentPublishedVersion, setCurrentPublishedVersion] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New Menu Modal
  const [showCreateMenuModal, setShowCreateMenuModal] = useState(false);
  const [menuKey, setMenuKey] = useState("");
  const [menuName, setMenuName] = useState("");
  const [menuDesc, setMenuDesc] = useState("");

  // Add Item Modal
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [itemLabel, setItemLabel] = useState("");
  const [itemType, setItemType] = useState<"internal_entry" | "internal_route" | "external_url">("external_url");
  const [itemUrl, setItemUrl] = useState("/");
  const [itemNewTab, setItemNewTab] = useState(false);
  const [itemAudience, setItemAudience] = useState<"all" | "authenticated" | "guest">("all");
  const [parentItemId, setParentItemId] = useState<string | null>(null);

  // Preview Modal
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewNodes, setPreviewNodes] = useState<any[]>([]);

  useEffect(() => {
    loadMenus();
  }, []);

  useEffect(() => {
    if (selectedMenu) {
      loadMenuDetail(selectedMenu.id);
    }
  }, [selectedMenu?.id]);

  async function loadMenus() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/navigation/menus");
      const json = await res.json();
      if (json.success) {
        setMenus(json.data || []);
        if (json.data?.length > 0 && !selectedMenu) {
          setSelectedMenu(json.data[0]);
        }
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMenuDetail(id: string) {
    try {
      const res = await fetch(`/api/navigation/menus/${id}`);
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        setCurrentDraftVersion(d.currentDraft);
        setCurrentPublishedVersion(d.currentPublished);
        setItems(d.currentDraft?.items_jsonb || []);
        setIsDirty(false);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleCreateMenu(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/navigation/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: menuKey,
          name: menuName,
          description: menuDesc,
          items: [],
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSuccess(`Menu "${json.data.menu.name}" created.`);
        setShowCreateMenuModal(false);
        setMenuKey("");
        setMenuName("");
        setMenuDesc("");
        loadMenus();
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    const newItem: NavItem = {
      id: `item-${Date.now()}`,
      label: itemLabel,
      itemType,
      url: itemUrl,
      openInNewTab: itemNewTab,
      audienceRule: itemAudience,
      children: [],
    };

    if (parentItemId) {
      setItems((prev) => {
        function appendChild(list: NavItem[]): NavItem[] {
          return list.map((it) => {
            if (it.id === parentItemId) {
              return { ...it, children: [...(it.children || []), newItem] };
            }
            if (it.children) return { ...it, children: appendChild(it.children) };
            return it;
          });
        }
        return appendChild(prev);
      });
    } else {
      setItems((prev) => [...prev, newItem]);
    }

    setIsDirty(true);
    setShowAddItemModal(false);
    setItemLabel("");
    setItemUrl("/");
    setItemNewTab(false);
    setParentItemId(null);
  }

  function handleDeleteItem(itemId: string) {
    function filterItem(list: NavItem[]): NavItem[] {
      return list
        .filter((it) => it.id !== itemId)
        .map((it) => (it.children ? { ...it, children: filterItem(it.children) } : it));
    }
    setItems((prev) => filterItem(prev));
    setIsDirty(true);
  }

  async function handleSaveDraft() {
    if (!selectedMenu) return;
    try {
      const res = await fetch(`/api/navigation/menus/${selectedMenu.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (json.success) {
        setSuccess("Draft navigation version saved.");
        setIsDirty(false);
        loadMenuDetail(selectedMenu.id);
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handlePublish() {
    if (!selectedMenu) return;
    if (isDirty) {
      await handleSaveDraft();
    }
    try {
      const res = await fetch(`/api/navigation/menus/${selectedMenu.id}/publish`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.success) {
        setSuccess(`Navigation published (v${json.data.version_number}).`);
        loadMenuDetail(selectedMenu.id);
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleOpenPreview() {
    if (!selectedMenu) return;
    try {
      const res = await fetch(`/api/navigation/menus/${selectedMenu.key}/tree?mode=preview`);
      const json = await res.json();
      if (json.success) {
        setPreviewNodes(json.data || []);
        setShowPreviewModal(true);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  function renderItemNode(item: NavItem, depth = 0) {
    return (
      <div key={item.id} className="border-b border-subtle last:border-0">
        <div
          className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-2"
          style={{ paddingLeft: `${depth * 24 + 16}px` }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {depth > 0 && <span className="text-fg-muted text-xs">└─</span>}
            <span className="text-sm font-semibold text-fg-primary">{item.label}</span>
            <span className="font-mono text-xs text-primary">{item.url}</span>
            {item.audienceRule && item.audienceRule !== "all" && (
              <span className="text-[10px] bg-review-muted text-review border border-review px-1.5 py-0.5 rounded font-mono uppercase">
                {item.audienceRule}
              </span>
            )}
            {item.openInNewTab && (
              <span className="text-[10px] bg-info-muted text-info border border-info px-1.5 py-0.5 rounded font-mono">
                New Tab
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setParentItemId(item.id);
                setShowAddItemModal(true);
              }}
              className="ui-btn ui-btn-secondary min-h-0 px-2 py-1 text-[10px]"
            >
              <Plus className="w-3 h-3" /> Child
            </button>
            <button
              onClick={() => handleDeleteItem(item.id)}
              className="p-1.5 text-danger hover:text-danger hover:bg-danger-muted rounded"
              title="Delete item"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {item.children && item.children.map((child) => renderItemNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        {/* Header */}
        <div className="ui-page-header">
          <div>
            <p className="ui-eyebrow">Structure / Navigation</p>
            <h1 className="ui-page-title flex items-center gap-2">
              <Compass className="h-5 w-5 text-primary" />
              Navigation Menu Studio
            </h1>
            <p className="ui-page-description">
              Build versioned, multi-level navigation trees with audience rules, draft previews, and transactional publishing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenPreview}
              className="ui-btn ui-btn-secondary"
            >
              <Eye className="w-4 h-4 text-primary" />
              Preview Menu
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={!isDirty}
              className="ui-btn ui-btn-secondary disabled:opacity-40"
            >
              <Save className="w-4 h-4 text-primary" />
              Save Draft
            </button>
            <button
              onClick={handlePublish}
              className="ui-btn border border-success bg-success-muted text-success"
            >
              <Rocket className="w-4 h-4" />
              Publish Live
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="ui-alert ui-alert-danger mt-5 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="ui-alert ui-alert-success mt-5 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {success}
          </div>
        )}

        {/* Main Workspace */}
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Left: Menus List */}
          <div className="border-y border-subtle py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">Menus</h2>
              <button
                onClick={() => setShowCreateMenuModal(true)}
                className="ui-btn ui-btn-tertiary min-h-0 px-2 py-1 text-[11px]"
              >
                <Plus className="w-3 h-3" /> New Menu
              </button>
            </div>
            <div className="space-y-1.5">
              {menus.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMenu(m)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedMenu?.id === m.id
                      ? "bg-surface-2 border-primary/40 text-fg-primary"
                      : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg-primary"
                  }`}
                >
                  <div className="font-medium text-sm text-fg-primary">{m.name}</div>
                  <div className="mt-1 font-mono text-[10px] text-fg-muted">{m.key}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Items Tree */}
          <div className="md:col-span-2 border-y border-subtle py-4 space-y-4">
            {selectedMenu ? (
              <>
                <div className="flex items-center justify-between border-b border-subtle pb-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-base font-semibold text-fg-primary">
                      {selectedMenu.name} Items
                      {isDirty && (
                        <span className="text-[10px] bg-warning-muted text-warning border border-warning px-1.5 py-0.5 rounded font-mono">
                          Unsaved changes
                        </span>
                      )}
                    </h2>
                    <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
                      Draft: v{currentDraftVersion?.version_number || 1} | Published:{" "}
                      {currentPublishedVersion ? `v${currentPublishedVersion.version_number}` : "Not published"}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setParentItemId(null);
                      setShowAddItemModal(true);
                    }}
                    className="ui-btn ui-btn-secondary min-h-0 px-2.5 py-1.5 text-[11px]"
                  >
                    <Plus className="w-3.5 h-3.5 text-primary" />
                    Add Nav Item
                  </button>
                </div>

                {items.length === 0 ? (
                  <div className="ui-empty">
                    No items in this menu yet. Click "Add Nav Item" to build the menu.
                  </div>
                ) : (
                  <div className="overflow-hidden border-y border-subtle">
                    {items.map((it) => renderItemNode(it))}
                  </div>
                )}
              </>
            ) : (
              <div className="ui-empty">
                Select a navigation menu on the left.
              </div>
            )}
          </div>
        </div>

        {/* Create Menu Modal */}
        {showCreateMenuModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-fg-primary">Create Navigation Menu</h3>
              <form onSubmit={handleCreateMenu} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Menu Key</label>
                  <input
                    type="text"
                    required
                    value={menuKey}
                    onChange={(e) => setMenuKey(e.target.value)}
                    placeholder="e.g. main_header"
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Menu Name</label>
                  <input
                    type="text"
                    required
                    value={menuName}
                    onChange={(e) => setMenuName(e.target.value)}
                    placeholder="e.g. Main Header Navigation"
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Description</label>
                  <input
                    type="text"
                    value={menuDesc}
                    onChange={(e) => setMenuDesc(e.target.value)}
                    placeholder="Optional description..."
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateMenuModal(false)}
                    className="px-4 py-2 border border-subtle rounded-lg text-sm text-fg-muted hover:text-fg-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ui-btn ui-btn-primary"
                  >
                    Create Menu
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Item Modal */}
        {showAddItemModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-fg-primary">
                {parentItemId ? "Add Sub-Menu Item" : "Add Navigation Item"}
              </h3>
              <form onSubmit={handleAddItem} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Label</label>
                  <input
                    type="text"
                    required
                    value={itemLabel}
                    onChange={(e) => setItemLabel(e.target.value)}
                    placeholder="e.g. Products"
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Link URL</label>
                  <input
                    type="text"
                    required
                    value={itemUrl}
                    onChange={(e) => setItemUrl(e.target.value)}
                    placeholder="/products or https://..."
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Audience Rule</label>
                  <select
                    value={itemAudience}
                    onChange={(e: any) => setItemAudience(e.target.value)}
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="all">Everyone (All Visitors)</option>
                    <option value="authenticated">Authenticated Users Only</option>
                    <option value="guest">Guest / Unauthenticated Visitors Only</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="newtab-check"
                    checked={itemNewTab}
                    onChange={(e) => setItemNewTab(e.target.checked)}
                    className="rounded border-subtle"
                  />
                  <label htmlFor="newtab-check" className="text-sm text-fg-primary">
                    Open link in new browser tab
                  </label>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddItemModal(false)}
                    className="px-4 py-2 border border-subtle rounded-lg text-sm text-fg-muted hover:text-fg-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ui-btn ui-btn-primary"
                  >
                    Add to Menu
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Live Preview Modal */}
        {showPreviewModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-2xl w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-fg-primary flex items-center gap-2">
                <Eye className="w-5 h-5 text-primary" />
                Live Preview: {selectedMenu?.name}
              </h3>
              <p className="text-xs text-fg-muted">
                Rendered preview of resolved navigation nodes.
              </p>
              <div className="rounded-lg border border-subtle bg-surface-2 p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-4">
                  {previewNodes.map((node) => (
                    <div key={node.id} className="relative group">
                      <a
                        href={node.url}
                        target={node.openInNewTab ? "_blank" : undefined}
                        className="text-sm font-medium text-fg-primary hover:text-primary px-2 py-1 rounded"
                      >
                        {node.label}
                      </a>
                      {node.children && node.children.length > 0 && (
                        <div className="mt-1 pl-3 border-l border-subtle space-y-1">
                          {node.children.map((child: any) => (
                            <div key={child.id}>
                              <a
                                href={child.url}
                                target={child.openInNewTab ? "_blank" : undefined}
                                className="text-xs text-fg-muted hover:text-fg-primary"
                              >
                                {child.label}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="ui-btn ui-btn-secondary"
                >
                  Close Preview
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
