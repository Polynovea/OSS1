"use client";

import React, { useState } from "react";
import type { ExperienceBlock } from "@/lib/experience/types";
import {
  Sparkles,
  ArrowRight,
  ChevronDown,
  Quote,
  Star,
  Layers,
  ShieldCheck,
  GitCommit,
  BarChart2,
  HelpCircle,
  EyeOff,
  Link as LinkIcon,
  Image as ImageIcon,
  Edit2,
  Check,
} from "lucide-react";

interface BlockRendererProps {
  block: ExperienceBlock;
  isSelected?: boolean;
  onSelect?: () => void;
  onUpdateBlock?: (updated: ExperienceBlock) => void;
  isPreviewOnly?: boolean;
}

const ICON_MAP: Record<string, React.ElementType> = {
  Layers,
  ShieldCheck,
  GitCommit,
  BarChart2,
  Sparkles,
  HelpCircle,
};

export default function BlockRenderer({
  block,
  isSelected = false,
  onSelect,
  onUpdateBlock,
  isPreviewOnly = false,
}: BlockRendererProps) {
  if (block.hidden && isPreviewOnly) {
    return null;
  }

  const data = block.data || {};
  const variant = block.variant || "standard";

  const updateField = (key: string, val: unknown) => {
    if (onUpdateBlock) {
      onUpdateBlock({
        ...block,
        data: {
          ...data,
          [key]: val,
        },
      });
    }
  };

  const renderContent = () => {
    switch (block.blockType) {
      case "hero": {
        const title = (data.title as string) || "Headline";
        const subtitle = (data.subtitle as string) || "";
        const badge = (data.badge as string) || "";
        const primaryCtaLabel = (data.primaryCtaLabel as string) || "";
        const primaryCtaUrl = (data.primaryCtaUrl as string) || "#";
        const secondaryCtaLabel = (data.secondaryCtaLabel as string) || "";
        const secondaryCtaUrl = (data.secondaryCtaUrl as string) || "#";
        const mediaUrl = (data.mediaUrl as string) || "";
        const alignment = (data.alignment as string) || "left";

        const isFullscreen = variant === "fullscreen";
        const isCompact = variant === "compact";

        return (
          <section
            className={`relative overflow-hidden ${
              isFullscreen
                ? "min-h-[75vh] flex items-center justify-center py-24"
                : isCompact
                ? "py-12"
                : "py-20"
            } px-6 md:px-12 bg-gradient-to-b from-[#141419] to-[#0a0a0a] border-b border-subtle`}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(230,211,163,0.06),transparent_60%)] pointer-events-none" />
            <div
              className={`relative z-10 max-w-5xl mx-auto ${
                alignment === "center" ? "text-center" : "text-left"
              }`}
            >
              {/* Eyebrow Badge */}
              {(!isPreviewOnly || badge) && (
                <div
                  className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border border-action/20 bg-action/5 text-action text-xs font-semibold uppercase tracking-wider mb-6 ${
                    alignment === "center" ? "mx-auto" : ""
                  }`}
                >
                  <Sparkles size={12} />
                  {!isPreviewOnly ? (
                    <input
                      type="text"
                      value={badge}
                      onChange={(e) => updateField("badge", e.target.value)}
                      placeholder="Eyebrow badge..."
                      className="bg-transparent border-0 text-action text-xs font-semibold uppercase tracking-wider focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-1"
                    />
                  ) : (
                    <span>{badge}</span>
                  )}
                </div>
              )}

              {/* Title */}
              {!isPreviewOnly ? (
                <textarea
                  value={title}
                  onChange={(e) => updateField("title", e.target.value)}
                  placeholder="Hero headline..."
                  rows={2}
                  className="w-full bg-transparent border-0 text-3xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-xl resize-none p-1"
                />
              ) : (
                <h1 className="text-3xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
                  {title}
                </h1>
              )}

              {/* Subtitle */}
              {!isPreviewOnly ? (
                <textarea
                  value={subtitle}
                  onChange={(e) => updateField("subtitle", e.target.value)}
                  placeholder="Subheadline details..."
                  rows={2}
                  className="mt-4 w-full bg-transparent border-0 text-base md:text-lg text-fg-secondary max-w-3xl leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-xl resize-none p-1"
                />
              ) : (
                subtitle && (
                  <p className="mt-5 text-base md:text-lg text-fg-secondary max-w-3xl leading-relaxed">
                    {subtitle}
                  </p>
                )
              )}

              {/* CTAs */}
              {(primaryCtaLabel || secondaryCtaLabel || !isPreviewOnly) && (
                <div
                  className={`mt-8 flex flex-wrap items-center gap-4 ${
                    alignment === "center" ? "justify-center" : "justify-start"
                  }`}
                >
                  {!isPreviewOnly ? (
                    <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-field border border-subtle">
                      <input
                        type="text"
                        value={primaryCtaLabel}
                        onChange={(e) =>
                          updateField("primaryCtaLabel", e.target.value)
                        }
                        placeholder="Primary Button Text"
                        className="ui-btn ui-btn-primary font-bold text-xs px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-black"
                      />
                      <input
                        type="text"
                        value={primaryCtaUrl}
                        onChange={(e) =>
                          updateField("primaryCtaUrl", e.target.value)
                        }
                        placeholder="Link URL (/signup)"
                        className="bg-transparent text-xs text-fg-secondary px-2 py-1 focus:outline-none focus:border-b border-action"
                      />
                    </div>
                  ) : (
                    primaryCtaLabel && (
                      <a
                        href={primaryCtaUrl}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl ui-btn ui-btn-primary font-bold text-sm tracking-wide hover:bg-action-hover transition-colors no-underline shadow-[0_0_20px_rgba(230,211,163,0.2)]"
                      >
                        <span>{primaryCtaLabel}</span>
                        <ArrowRight size={15} />
                      </a>
                    )
                  )}

                  {!isPreviewOnly ? (
                    <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-field border border-subtle">
                      <input
                        type="text"
                        value={secondaryCtaLabel}
                        onChange={(e) =>
                          updateField("secondaryCtaLabel", e.target.value)
                        }
                        placeholder="Secondary Button (Optional)"
                        className="bg-surface-2 text-fg-primary font-semibold text-xs px-3 py-2 rounded-xl focus:outline-none"
                      />
                      <input
                        type="text"
                        value={secondaryCtaUrl}
                        onChange={(e) =>
                          updateField("secondaryCtaUrl", e.target.value)
                        }
                        placeholder="Link URL (/demo)"
                        className="bg-transparent text-xs text-fg-secondary px-2 py-1 focus:outline-none focus:border-b border-action"
                      />
                    </div>
                  ) : (
                    secondaryCtaLabel && (
                      <a
                        href={secondaryCtaUrl}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-subtle bg-surface-2 text-fg-primary font-semibold text-sm hover:bg-surface-2 transition-colors no-underline"
                      >
                        <span>{secondaryCtaLabel}</span>
                      </a>
                    )
                  )}
                </div>
              )}

              {/* Media URL / Image Frame */}
              {mediaUrl ? (
                <div className="mt-12 rounded-2xl overflow-hidden border border-subtle shadow-2xl relative group">
                  <img
                    src={mediaUrl}
                    alt={title}
                    className="w-full h-auto max-h-[500px] object-cover"
                  />
                  {!isPreviewOnly && (
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => {
                          const nextUrl = prompt("Enter new image URL:", mediaUrl);
                          if (nextUrl !== null) updateField("mediaUrl", nextUrl);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-black/80 text-white text-xs font-semibold backdrop-blur-md border border-default hover:bg-action-hover hover:text-on-primary flex items-center gap-1.5 cursor-pointer"
                      >
                        <ImageIcon size={12} />
                        <span>Change Image</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                !isPreviewOnly && (
                  <div className="mt-8 p-6 rounded-xl border border-dashed border-subtle bg-field text-center">
                    <button
                      type="button"
                      onClick={() => {
                        const url = prompt("Enter image URL for Hero:");
                        if (url) updateField("mediaUrl", url);
                      }}
                      className="text-xs font-semibold text-action hover:underline inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ImageIcon size={13} />
                      <span>+ Attach Cover Image</span>
                    </button>
                  </div>
                )
              )}
            </div>
          </section>
        );
      }

      case "features": {
        const kicker = (data.kicker as string) || "";
        const title = (data.title as string) || "Features";
        const subtitle = (data.subtitle as string) || "";
        const items = Array.isArray(data.items) ? data.items : [];
        const cols =
          variant === "2_col"
            ? "md:grid-cols-2"
            : variant === "4_col"
            ? "md:grid-cols-2 lg:grid-cols-4"
            : "md:grid-cols-3";

        const updateFeatureItem = (idx: number, key: string, val: string) => {
          const nextItems = items.map((it: any, i: number) =>
            i === idx ? { ...it, [key]: val } : it
          );
          updateField("items", nextItems);
        };

        return (
          <section className="py-20 px-6 md:px-12 bg-field border-b border-subtle">
            <div className="max-w-6xl mx-auto">
              <div className="text-center max-w-3xl mx-auto mb-16">
                {!isPreviewOnly ? (
                  <input
                    type="text"
                    value={kicker}
                    onChange={(e) => updateField("kicker", e.target.value)}
                    placeholder="Section Kicker..."
                    className="text-center bg-transparent border-0 text-[10px] font-bold tracking-[0.2em] text-action uppercase mb-2 focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-2"
                  />
                ) : (
                  kicker && (
                    <p className="text-[10px] font-bold tracking-[0.2em] text-action uppercase mb-2">
                      {kicker}
                    </p>
                  )
                )}

                {!isPreviewOnly ? (
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => updateField("title", e.target.value)}
                    placeholder="Section Title..."
                    className="w-full text-center bg-transparent border-0 text-2xl md:text-4xl font-extrabold text-white tracking-tight focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-lg p-1"
                  />
                ) : (
                  <h2 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight">
                    {title}
                  </h2>
                )}

                {!isPreviewOnly ? (
                  <textarea
                    value={subtitle}
                    onChange={(e) => updateField("subtitle", e.target.value)}
                    placeholder="Section description..."
                    rows={2}
                    className="w-full text-center bg-transparent border-0 mt-3 text-sm md:text-base text-fg-secondary focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-lg resize-none p-1"
                  />
                ) : (
                  subtitle && (
                    <p className="mt-4 text-sm md:text-base text-fg-secondary">
                      {subtitle}
                    </p>
                  )
                )}
              </div>

              <div className={`grid gap-6 ${cols}`}>
                {items.map((item: any, idx: number) => {
                  const IconComponent = ICON_MAP[item.icon] || Layers;
                  return (
                    <div
                      key={idx}
                      className="p-6 rounded-2xl border border-subtle bg-surface-2 hover:border-action/30 transition-colors flex flex-col justify-between"
                    >
                      <div>
                        <div className="w-10 h-10 rounded-xl bg-action/10 border border-action/20 flex items-center justify-center text-action mb-4">
                          <IconComponent size={20} />
                        </div>
                        {!isPreviewOnly ? (
                          <input
                            type="text"
                            value={item.title || ""}
                            onChange={(e) =>
                              updateFeatureItem(idx, "title", e.target.value)
                            }
                            placeholder="Feature Title..."
                            className="w-full bg-transparent border-0 text-lg font-bold text-white mb-2 focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-1"
                          />
                        ) : (
                          <h3 className="text-lg font-bold text-white mb-2">
                            {item.title}
                          </h3>
                        )}

                        {!isPreviewOnly ? (
                          <textarea
                            value={item.description || ""}
                            onChange={(e) =>
                              updateFeatureItem(
                                idx,
                                "description",
                                e.target.value
                              )
                            }
                            placeholder="Feature description..."
                            rows={3}
                            className="w-full bg-transparent border-0 text-xs md:text-sm text-fg-secondary leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded resize-none p-1"
                          />
                        ) : (
                          <p className="text-xs md:text-sm text-fg-secondary leading-relaxed">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      }

      case "cta": {
        const title = (data.title as string) || "Call to Action";
        const description = (data.description as string) || "";
        const primaryLabel = (data.primaryLabel as string) || "Get Started";
        const primaryUrl = (data.primaryUrl as string) || "#";
        const secondaryLabel = (data.secondaryLabel as string) || "";
        const secondaryUrl = (data.secondaryUrl as string) || "#";

        const isGold = variant === "gold";
        const isGlass = variant === "glass";

        return (
          <section className="py-20 px-6 md:px-12 bg-canvas border-b border-subtle">
            <div
              className={`max-w-5xl mx-auto rounded-3xl p-8 md:p-14 text-center relative overflow-hidden border ${
                isGold
                  ? "border-action/40 bg-gradient-to-b from-[#242018] to-[#12110e] shadow-[0_0_50px_rgba(230,211,163,0.08)]"
                  : isGlass
                  ? "border-subtle bg-surface-2 backdrop-blur-xl"
                  : "border-subtle bg-[#121215]"
              }`}
            >
              <div className="relative z-10 max-w-2xl mx-auto">
                {!isPreviewOnly ? (
                  <textarea
                    value={title}
                    onChange={(e) => updateField("title", e.target.value)}
                    placeholder="CTA Headline..."
                    rows={2}
                    className="w-full text-center bg-transparent border-0 text-2xl md:text-4xl font-extrabold text-white tracking-tight focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-xl resize-none p-1"
                  />
                ) : (
                  <h2 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight">
                    {title}
                  </h2>
                )}

                {!isPreviewOnly ? (
                  <textarea
                    value={description}
                    onChange={(e) => updateField("description", e.target.value)}
                    placeholder="Supporting CTA text..."
                    rows={2}
                    className="w-full text-center bg-transparent border-0 mt-3 text-sm md:text-base text-fg-secondary focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-xl resize-none p-1"
                  />
                ) : (
                  description && (
                    <p className="mt-4 text-sm md:text-base text-fg-secondary">
                      {description}
                    </p>
                  )
                )}

                <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                  {!isPreviewOnly ? (
                    <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-field0 border border-subtle">
                      <input
                        type="text"
                        value={primaryLabel}
                        onChange={(e) =>
                          updateField("primaryLabel", e.target.value)
                        }
                        placeholder="Button Text"
                        className="ui-btn ui-btn-primary font-bold text-xs px-3 py-2 rounded-xl focus:outline-none"
                      />
                      <input
                        type="text"
                        value={primaryUrl}
                        onChange={(e) =>
                          updateField("primaryUrl", e.target.value)
                        }
                        placeholder="Target URL (/signup)"
                        className="bg-transparent text-xs text-fg-secondary px-2 py-1 focus:outline-none focus:border-b border-action"
                      />
                    </div>
                  ) : (
                    primaryLabel && (
                      <a
                        href={primaryUrl}
                        className="px-6 py-3 rounded-xl ui-btn ui-btn-primary font-bold text-sm tracking-wide hover:bg-action-hover transition-colors no-underline"
                      >
                        {primaryLabel}
                      </a>
                    )
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      }

      case "faq": {
        const kicker = (data.kicker as string) || "";
        const title = (data.title as string) || "FAQ";
        const subtitle = (data.subtitle as string) || "";
        const items = Array.isArray(data.items) ? data.items : [];

        const updateFaqItem = (idx: number, key: string, val: string) => {
          const nextItems = items.map((it: any, i: number) =>
            i === idx ? { ...it, [key]: val } : it
          );
          updateField("items", nextItems);
        };

        return (
          <FaqAccordionRenderer
            kicker={kicker}
            title={title}
            subtitle={subtitle}
            items={items}
            isTwoCol={variant === "two_column"}
            isPreviewOnly={isPreviewOnly}
            onUpdateKicker={(val) => updateField("kicker", val)}
            onUpdateTitle={(val) => updateField("title", val)}
            onUpdateSubtitle={(val) => updateField("subtitle", val)}
            onUpdateItem={updateFaqItem}
          />
        );
      }

      case "stats": {
        const title = (data.title as string) || "";
        const subtitle = (data.subtitle as string) || "";
        const items = Array.isArray(data.items) ? data.items : [];
        const isBar = variant === "bar";

        const updateStatItem = (idx: number, key: string, val: string) => {
          const nextItems = items.map((it: any, i: number) =>
            i === idx ? { ...it, [key]: val } : it
          );
          updateField("items", nextItems);
        };

        return (
          <section className="py-16 px-6 md:px-12 bg-[#0e0e12] border-b border-subtle">
            <div className="max-w-6xl mx-auto">
              {(title || subtitle || !isPreviewOnly) && (
                <div className="text-center max-w-2xl mx-auto mb-12">
                  {!isPreviewOnly ? (
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => updateField("title", e.target.value)}
                      placeholder="Stats Section Title (Optional)..."
                      className="w-full text-center bg-transparent border-0 text-2xl md:text-3xl font-bold text-white focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-lg p-1"
                    />
                  ) : (
                    title && (
                      <h2 className="text-2xl md:text-3xl font-bold text-white">
                        {title}
                      </h2>
                    )
                  )}
                </div>
              )}

              <div
                className={
                  isBar
                    ? "grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-white/10 rounded-2xl border border-subtle bg-surface-2 p-4 md:p-8"
                    : "grid grid-cols-2 md:grid-cols-4 gap-6"
                }
              >
                {items.map((stat: any, idx: number) => (
                  <div
                    key={idx}
                    className={`text-center p-4 ${
                      !isBar
                        ? "rounded-2xl border border-subtle bg-surface-2"
                        : ""
                    }`}
                  >
                    <div className="text-3xl md:text-4xl font-extrabold text-action tracking-tight flex items-center justify-center gap-0.5">
                      {!isPreviewOnly ? (
                        <input
                          type="text"
                          value={stat.value || ""}
                          onChange={(e) =>
                            updateStatItem(idx, "value", e.target.value)
                          }
                          className="w-20 text-center bg-transparent border-0 text-action font-extrabold focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded"
                        />
                      ) : (
                        <span>{stat.value}</span>
                      )}
                      {stat.suffix && (
                        <span className="text-xl font-bold text-fg-secondary">
                          {stat.suffix}
                        </span>
                      )}
                    </div>

                    {!isPreviewOnly ? (
                      <input
                        type="text"
                        value={stat.label || ""}
                        onChange={(e) =>
                          updateStatItem(idx, "label", e.target.value)
                        }
                        placeholder="Metric label..."
                        className="mt-2 w-full text-center bg-transparent border-0 text-xs md:text-sm font-semibold text-fg-secondary focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-1"
                      />
                    ) : (
                      <p className="mt-2 text-xs md:text-sm font-semibold text-fg-secondary">
                        {stat.label}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      }

      case "testimonial": {
        const quote = (data.quote as string) || "Testimonial quote text.";
        const author = (data.author as string) || "Elena Vance";
        const role = (data.role as string) || "VP of Digital Engineering";
        const company = (data.company as string) || "Aether Dynamics";
        const avatarUrl = (data.avatarUrl as string) || "";
        const rating = Number(data.rating) || 5;
        const isHeroic = variant === "heroic";

        return (
          <section className="py-20 px-6 md:px-12 bg-canvas border-b border-subtle">
            <div
              className={`mx-auto ${
                isHeroic ? "max-w-4xl text-center" : "max-w-3xl"
              }`}
            >
              <div
                className={`rounded-3xl border border-subtle bg-surface-1 p-8 md:p-12 relative overflow-hidden ${
                  isHeroic ? "border-action/30" : ""
                }`}
              >
                <Quote
                  size={36}
                  className="text-action/20 mb-6 mx-auto md:mx-0"
                />
                <div className="flex gap-1 mb-4 justify-center md:justify-start">
                  {Array.from({ length: Math.min(Math.max(rating, 1), 5) }).map(
                    (_, idx) => (
                      <Star
                        key={idx}
                        size={15}
                        className="fill-[#e6d3a3] text-action"
                      />
                    )
                  )}
                </div>

                {!isPreviewOnly ? (
                  <textarea
                    value={quote}
                    onChange={(e) => updateField("quote", e.target.value)}
                    rows={3}
                    placeholder="Testimonial quote text..."
                    className="w-full bg-transparent border-0 text-lg md:text-xl font-medium text-fg-primary leading-relaxed italic focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-xl resize-none p-1"
                  />
                ) : (
                  <p className="text-lg md:text-xl font-medium text-fg-primary leading-relaxed italic">
                    "{quote}"
                  </p>
                )}

                <div className="mt-8 flex items-center gap-4 justify-center md:justify-start border-t border-subtle pt-6">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={author}
                      className="w-12 h-12 rounded-full object-cover border border-action/30"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#27272A] flex items-center justify-center font-bold text-fg-secondary">
                      {author.charAt(0)}
                    </div>
                  )}
                  <div className="flex-1">
                    {!isPreviewOnly ? (
                      <div className="flex flex-col gap-1">
                        <input
                          type="text"
                          value={author}
                          onChange={(e) => updateField("author", e.target.value)}
                          placeholder="Author Name"
                          className="bg-transparent border-0 font-bold text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-1"
                        />
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={role}
                            onChange={(e) => updateField("role", e.target.value)}
                            placeholder="Role / Title"
                            className="bg-transparent border-0 text-xs text-fg-secondary focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-1"
                          />
                          <input
                            type="text"
                            value={company}
                            onChange={(e) =>
                              updateField("company", e.target.value)
                            }
                            placeholder="Company"
                            className="bg-transparent border-0 text-xs text-fg-secondary focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-1"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <h4 className="font-bold text-white text-sm">{author}</h4>
                        {(role || company) && (
                          <p className="text-xs text-fg-secondary">
                            {role} {role && company ? "·" : ""} {company}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        );
      }

      case "logos": {
        const label = (data.label as string) || "";
        const grayscale = data.grayscale !== false;
        const items = Array.isArray(data.items) ? data.items : [];

        return (
          <section className="py-12 px-6 md:px-12 bg-canvas border-b border-subtle">
            <div className="max-w-5xl mx-auto text-center">
              {!isPreviewOnly ? (
                <input
                  type="text"
                  value={label}
                  onChange={(e) => updateField("label", e.target.value)}
                  placeholder="Section Label / Proof Kicker..."
                  className="text-center bg-transparent border-0 text-[10px] font-bold tracking-[0.2em] text-fg-muted uppercase mb-8 focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-2 w-full max-w-md"
                />
              ) : (
                label && (
                  <p className="text-[10px] font-bold tracking-[0.2em] text-fg-muted uppercase mb-8">
                    {label}
                  </p>
                )
              )}
              <div className="flex flex-wrap items-center justify-center gap-8 md:gap-14">
                {items.map((item: any, idx: number) => (
                  <div
                    key={idx}
                    className={`text-sm md:text-base font-bold tracking-wider text-fg-secondary transition-opacity hover:opacity-100 ${
                      grayscale ? "opacity-60 grayscale" : "opacity-90"
                    }`}
                  >
                    {item.logoUrl ? (
                      <img
                        src={item.logoUrl}
                        alt={item.name}
                        className="h-6 md:h-8 max-w-[120px] object-contain"
                      />
                    ) : (
                      <span>{item.name}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      }

      case "rich_text": {
        const content = (data.content as string) || "";
        const widthClass =
          variant === "narrow"
            ? "max-w-2xl"
            : variant === "wide"
            ? "max-w-5xl"
            : "max-w-3xl";

        return (
          <section className="py-16 px-6 md:px-12 bg-canvas border-b border-subtle">
            <div className={`${widthClass} mx-auto prose prose-invert`}>
              {!isPreviewOnly ? (
                <textarea
                  value={content}
                  onChange={(e) => updateField("content", e.target.value)}
                  placeholder="Write rich prose section..."
                  rows={6}
                  className="w-full bg-transparent border-0 text-fg-secondary text-base md:text-lg leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-xl resize-y p-2"
                />
              ) : (
                <div className="text-fg-secondary text-base md:text-lg leading-relaxed whitespace-pre-wrap">
                  {content}
                </div>
              )}
            </div>
          </section>
        );
      }

      case "media_showcase": {
        const mediaUrl = (data.mediaUrl as string) || "";
        const caption = (data.caption as string) || "";
        const altText = (data.altText as string) || "";
        const isFullBleed = variant === "full_bleed";

        return (
          <section
            className={`py-12 ${
              isFullBleed ? "px-0" : "px-6 md:px-12"
            } bg-canvas border-b border-subtle`}
          >
            <div className={isFullBleed ? "w-full" : "max-w-5xl mx-auto"}>
              {mediaUrl ? (
                <div
                  className={`overflow-hidden relative group ${
                    !isFullBleed
                      ? "rounded-2xl border border-subtle shadow-2xl"
                      : ""
                  }`}
                >
                  <img
                    src={mediaUrl}
                    alt={altText}
                    className="w-full h-auto object-cover max-h-[600px]"
                  />
                  {!isPreviewOnly && (
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => {
                          const nextUrl = prompt("Enter media URL:", mediaUrl);
                          if (nextUrl !== null) updateField("mediaUrl", nextUrl);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-black/80 text-white text-xs font-semibold backdrop-blur-md border border-default hover:bg-action-hover hover:text-on-primary flex items-center gap-1.5 cursor-pointer"
                      >
                        <ImageIcon size={12} />
                        <span>Change Media</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                !isPreviewOnly && (
                  <div className="rounded-2xl border border-dashed border-subtle bg-surface-2 p-16 text-center text-fg-muted">
                    <p className="text-sm font-semibold">
                      No media asset assigned
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const url = prompt("Enter media URL:");
                        if (url) updateField("mediaUrl", url);
                      }}
                      className="mt-3 px-4 py-2 rounded-lg bg-surface-2 text-white text-xs font-bold hover:bg-action-hover hover:text-on-primary transition-colors cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <ImageIcon size={13} />
                      <span>Set Image URL</span>
                    </button>
                  </div>
                )
              )}

              {(!isPreviewOnly || caption) && (
                <div className="mt-3 text-center">
                  {!isPreviewOnly ? (
                    <input
                      type="text"
                      value={caption}
                      onChange={(e) => updateField("caption", e.target.value)}
                      placeholder="Optional caption..."
                      className="text-center bg-transparent border-0 text-xs text-fg-muted italic focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-2"
                    />
                  ) : (
                    <p className="text-xs text-fg-muted italic">{caption}</p>
                  )}
                </div>
              )}
            </div>
          </section>
        );
      }

      default:
        return (
          <div className="p-8 text-center bg-danger-muted border border-danger text-danger text-sm">
            Unknown block type: <code className="font-mono">{block.blockType}</code>
          </div>
        );
    }
  };

  if (isPreviewOnly) {
    return <div>{renderContent()}</div>;
  }

  return (
    <div
      onClick={onSelect}
      className={`group relative transition-all cursor-pointer ${
        isSelected
          ? "ring-2 ring-[#e6d3a3] ring-offset-2 ring-offset-[#0a0a0a]"
          : "hover:ring-1 hover:ring-[#e6d3a3]/40"
      }`}
    >
      {/* Visual outline overlay banner for editor context */}
      <div
        className={`absolute top-2 left-2 z-20 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider backdrop-blur-md flex items-center gap-1.5 transition-opacity ${
          isSelected
            ? "ui-btn ui-btn-primary opacity-100"
            : "bg-black/80 text-fg-secondary opacity-0 group-hover:opacity-100"
        }`}
      >
        <span>{block.blockType.replace("_", " ")}</span>
        {block.variant && <span className="opacity-70">({block.variant})</span>}
        {block.hidden && <EyeOff size={10} className="text-warning" />}
      </div>

      {block.hidden && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
          <div className="px-3 py-1.5 rounded-lg bg-surface-2 border border-subtle text-xs font-semibold text-fg-secondary flex items-center gap-2">
            <EyeOff size={14} className="text-warning" />
            <span>Block hidden from public preview</span>
          </div>
        </div>
      )}

      {renderContent()}
    </div>
  );
}

function FaqAccordionRenderer({
  kicker,
  title,
  subtitle,
  items,
  isTwoCol,
  isPreviewOnly,
  onUpdateKicker,
  onUpdateTitle,
  onUpdateSubtitle,
  onUpdateItem,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  items: Array<{ question: string; answer: string }>;
  isTwoCol: boolean;
  isPreviewOnly: boolean;
  onUpdateKicker?: (val: string) => void;
  onUpdateTitle?: (val: string) => void;
  onUpdateSubtitle?: (val: string) => void;
  onUpdateItem?: (idx: number, key: string, val: string) => void;
}) {
  const [openIndexes, setOpenIndexes] = useState<Set<number>>(new Set([0]));

  const toggle = (idx: number) => {
    setOpenIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  return (
    <section className="py-20 px-6 md:px-12 bg-canvas border-b border-subtle">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-14">
          {!isPreviewOnly && onUpdateKicker ? (
            <input
              type="text"
              value={kicker}
              onChange={(e) => onUpdateKicker(e.target.value)}
              placeholder="FAQ Kicker..."
              className="text-center bg-transparent border-0 text-[10px] font-bold tracking-[0.2em] text-action uppercase mb-2 focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-2"
            />
          ) : (
            kicker && (
              <p className="text-[10px] font-bold tracking-[0.2em] text-action uppercase mb-2">
                {kicker}
              </p>
            )
          )}

          {!isPreviewOnly && onUpdateTitle ? (
            <input
              type="text"
              value={title}
              onChange={(e) => onUpdateTitle(e.target.value)}
              placeholder="FAQ Title..."
              className="w-full text-center bg-transparent border-0 text-2xl md:text-4xl font-extrabold text-white tracking-tight focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-lg p-1"
            />
          ) : (
            <h2 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight">
              {title}
            </h2>
          )}

          {!isPreviewOnly && onUpdateSubtitle ? (
            <textarea
              value={subtitle}
              onChange={(e) => onUpdateSubtitle(e.target.value)}
              placeholder="FAQ subtitle..."
              rows={2}
              className="w-full text-center bg-transparent border-0 mt-3 text-sm text-fg-secondary focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded-lg resize-none p-1"
            />
          ) : (
            subtitle && <p className="mt-3 text-sm text-fg-secondary">{subtitle}</p>
          )}
        </div>

        <div className={`grid gap-4 ${isTwoCol ? "md:grid-cols-2" : ""}`}>
          {items.map((item, idx) => {
            const isOpen = openIndexes.has(idx);
            return (
              <div
                key={idx}
                className="rounded-2xl border border-subtle bg-surface-2 overflow-hidden transition-colors"
              >
                <div className="w-full px-6 py-4 flex items-center justify-between text-left text-sm md:text-base font-bold text-fg-primary">
                  {!isPreviewOnly && onUpdateItem ? (
                    <input
                      type="text"
                      value={item.question || ""}
                      onChange={(e) =>
                        onUpdateItem(idx, "question", e.target.value)
                      }
                      placeholder="Question..."
                      className="w-full bg-transparent border-0 font-bold text-fg-primary focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded px-1"
                    />
                  ) : (
                    <span>{item.question}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(idx)}
                    className="p-1 rounded text-fg-secondary hover:text-white cursor-pointer ml-2"
                  >
                    <ChevronDown
                      size={16}
                      className={`shrink-0 transition-transform ${
                        isOpen ? "rotate-180 text-action" : ""
                      }`}
                    />
                  </button>
                </div>
                {isOpen && (
                  <div className="px-6 pb-5 text-xs md:text-sm text-fg-secondary leading-relaxed border-t border-subtle pt-3">
                    {!isPreviewOnly && onUpdateItem ? (
                      <textarea
                        value={item.answer || ""}
                        onChange={(e) =>
                          onUpdateItem(idx, "answer", e.target.value)
                        }
                        placeholder="Answer details..."
                        rows={3}
                        className="w-full bg-transparent border-0 text-xs md:text-sm text-fg-secondary leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#e6d3a3]/50 rounded resize-none p-1"
                      />
                    ) : (
                      item.answer
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
