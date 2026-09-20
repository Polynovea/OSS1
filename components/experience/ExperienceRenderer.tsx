"use client";

import React, { useState } from "react";
import type { ExperienceDocument, ExperienceBlock } from "@/lib/experience/types";
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
} from "lucide-react";

interface ExperienceRendererProps {
  document: ExperienceDocument | null | undefined;
  className?: string;
}

const ICON_MAP: Record<string, React.ElementType> = {
  Layers,
  ShieldCheck,
  GitCommit,
  BarChart2,
  Sparkles,
  HelpCircle,
};

export default function ExperienceRenderer({
  document,
  className = "",
}: ExperienceRendererProps) {
  if (!document || !Array.isArray(document.blocks) || document.blocks.length === 0) {
    return null;
  }

  const visibleBlocks = document.blocks.filter((b) => !b.hidden);

  return (
    <div className={`w-full bg-[#0a0a0a] text-white font-sans ${className}`}>
      {visibleBlocks.map((block) => (
        <SingleBlockRenderer key={block.id} block={block} />
      ))}
    </div>
  );
}

function SingleBlockRenderer({ block }: { block: ExperienceBlock }) {
  const data = block.data || {};
  const variant = block.variant || "standard";

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
              ? "min-h-[80vh] flex items-center justify-center py-24"
              : isCompact
              ? "py-12"
              : "py-20"
          } px-6 md:px-12 bg-gradient-to-b from-[#141419] to-[#0a0a0a] border-b border-white/5`}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(230,211,163,0.06),transparent_60%)] pointer-events-none" />
          <div
            className={`relative z-10 max-w-5xl mx-auto ${
              alignment === "center" ? "text-center" : "text-left"
            }`}
          >
            {badge && (
              <div
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#e6d3a3]/20 bg-[#e6d3a3]/5 text-[#e6d3a3] text-xs font-semibold uppercase tracking-wider mb-6 ${
                  alignment === "center" ? "mx-auto" : ""
                }`}
              >
                <Sparkles size={12} />
                <span>{badge}</span>
              </div>
            )}
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-5 text-base md:text-lg text-zinc-400 max-w-3xl leading-relaxed">
                {subtitle}
              </p>
            )}
            {(primaryCtaLabel || secondaryCtaLabel) && (
              <div
                className={`mt-8 flex flex-wrap items-center gap-4 ${
                  alignment === "center" ? "justify-center" : "justify-start"
                }`}
              >
                {primaryCtaLabel && (
                  <a
                    href={primaryCtaUrl}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#e6d3a3] text-black font-bold text-sm tracking-wide hover:bg-[#f5e1b0] transition-colors no-underline shadow-[0_0_20px_rgba(230,211,163,0.2)]"
                  >
                    <span>{primaryCtaLabel}</span>
                    <ArrowRight size={15} />
                  </a>
                )}
                {secondaryCtaLabel && (
                  <a
                    href={secondaryCtaUrl}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/15 bg-white/5 text-zinc-200 font-semibold text-sm hover:bg-white/10 transition-colors no-underline"
                  >
                    <span>{secondaryCtaLabel}</span>
                  </a>
                )}
              </div>
            )}
            {mediaUrl && (
              <div className="mt-12 rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                <img
                  src={mediaUrl}
                  alt={title}
                  className="w-full h-auto max-h-[500px] object-cover"
                />
              </div>
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

      return (
        <section className="py-20 px-6 md:px-12 bg-[#0d0d10] border-b border-white/5">
          <div className="max-w-6xl mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-16">
              {kicker && (
                <p className="text-[10px] font-bold tracking-[0.2em] text-[#e6d3a3] uppercase mb-2">
                  {kicker}
                </p>
              )}
              <h2 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight">
                {title}
              </h2>
              {subtitle && (
                <p className="mt-4 text-sm md:text-base text-zinc-400">
                  {subtitle}
                </p>
              )}
            </div>
            <div className={`grid gap-6 ${cols}`}>
              {items.map((item: any, idx: number) => {
                const IconComponent = ICON_MAP[item.icon] || Layers;
                return (
                  <div
                    key={idx}
                    className="p-6 rounded-2xl border border-[#27272A] bg-[#141418] flex flex-col justify-between"
                  >
                    <div>
                      <div className="w-10 h-10 rounded-xl bg-[#e6d3a3]/10 border border-[#e6d3a3]/20 flex items-center justify-center text-[#e6d3a3] mb-4">
                        <IconComponent size={20} />
                      </div>
                      <h3 className="text-lg font-bold text-white mb-2">
                        {item.title}
                      </h3>
                      <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">
                        {item.description}
                      </p>
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
        <section className="py-20 px-6 md:px-12 bg-[#0a0a0a] border-b border-white/5">
          <div
            className={`max-w-5xl mx-auto rounded-3xl p-8 md:p-14 text-center relative overflow-hidden border ${
              isGold
                ? "border-[#e6d3a3]/40 bg-gradient-to-b from-[#242018] to-[#12110e] shadow-[0_0_50px_rgba(230,211,163,0.08)]"
                : isGlass
                ? "border-white/10 bg-white/[0.03] backdrop-blur-xl"
                : "border-[#27272A] bg-[#121215]"
            }`}
          >
            <div className="relative z-10 max-w-2xl mx-auto">
              <h2 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight">
                {title}
              </h2>
              {description && (
                <p className="mt-4 text-sm md:text-base text-zinc-300">
                  {description}
                </p>
              )}
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                {primaryLabel && (
                  <a
                    href={primaryUrl}
                    className="px-6 py-3 rounded-xl bg-[#e6d3a3] text-black font-bold text-sm tracking-wide hover:bg-[#f5e1b0] transition-colors no-underline"
                  >
                    {primaryLabel}
                  </a>
                )}
                {secondaryLabel && (
                  <a
                    href={secondaryUrl}
                    className="px-6 py-3 rounded-xl border border-white/15 bg-white/5 text-zinc-200 font-semibold text-sm hover:bg-white/10 transition-colors no-underline"
                  >
                    {secondaryLabel}
                  </a>
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
      const isTwoCol = variant === "two_column";

      return (
        <FaqPublicAccordion
          kicker={kicker}
          title={title}
          subtitle={subtitle}
          items={items}
          isTwoCol={isTwoCol}
        />
      );
    }

    case "stats": {
      const title = (data.title as string) || "";
      const items = Array.isArray(data.items) ? data.items : [];
      const isBar = variant === "bar";

      return (
        <section className="py-16 px-6 md:px-12 bg-[#0e0e12] border-b border-white/5">
          <div className="max-w-6xl mx-auto">
            {title && (
              <div className="text-center max-w-2xl mx-auto mb-12">
                <h2 className="text-2xl md:text-3xl font-bold text-white">
                  {title}
                </h2>
              </div>
            )}
            <div
              className={
                isBar
                  ? "grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-white/10 rounded-2xl border border-[#27272A] bg-[#141418] p-4 md:p-8"
                  : "grid grid-cols-2 md:grid-cols-4 gap-6"
              }
            >
              {items.map((stat: any, idx: number) => (
                <div
                  key={idx}
                  className={`text-center p-4 ${
                    !isBar
                      ? "rounded-2xl border border-[#27272A] bg-[#141418]"
                      : ""
                  }`}
                >
                  <div className="text-3xl md:text-4xl font-extrabold text-[#e6d3a3] tracking-tight flex items-center justify-center gap-0.5">
                    <span>{stat.value}</span>
                    {stat.suffix && (
                      <span className="text-xl font-bold text-zinc-400">
                        {stat.suffix}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs md:text-sm font-semibold text-zinc-300">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case "testimonial": {
      const quote = (data.quote as string) || "";
      const author = (data.author as string) || "";
      const role = (data.role as string) || "";
      const company = (data.company as string) || "";
      const avatarUrl = (data.avatarUrl as string) || "";
      const rating = Number(data.rating) || 5;
      const isHeroic = variant === "heroic";

      return (
        <section className="py-20 px-6 md:px-12 bg-[#0a0a0a] border-b border-white/5">
          <div
            className={`mx-auto ${
              isHeroic ? "max-w-4xl text-center" : "max-w-3xl"
            }`}
          >
            <div
              className={`rounded-3xl border border-[#27272A] bg-[#121216] p-8 md:p-12 relative overflow-hidden ${
                isHeroic ? "border-[#e6d3a3]/30" : ""
              }`}
            >
              <Quote
                size={36}
                className="text-[#e6d3a3]/20 mb-6 mx-auto md:mx-0"
              />
              <div className="flex gap-1 mb-4 justify-center md:justify-start">
                {Array.from({ length: Math.min(Math.max(rating, 1), 5) }).map(
                  (_, idx) => (
                    <Star
                      key={idx}
                      size={15}
                      className="fill-[#e6d3a3] text-[#e6d3a3]"
                    />
                  )
                )}
              </div>
              <p className="text-lg md:text-xl font-medium text-zinc-200 leading-relaxed italic">
                "{quote}"
              </p>
              <div className="mt-8 flex items-center gap-4 justify-center md:justify-start border-t border-white/5 pt-6">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={author}
                    className="w-12 h-12 rounded-full object-cover border border-[#e6d3a3]/30"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-[#27272A] flex items-center justify-center font-bold text-zinc-400">
                    {author.charAt(0)}
                  </div>
                )}
                <div>
                  <h4 className="font-bold text-white text-sm">{author}</h4>
                  {(role || company) && (
                    <p className="text-xs text-zinc-400">
                      {role} {role && company ? "·" : ""} {company}
                    </p>
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
        <section className="py-12 px-6 md:px-12 bg-[#09090b] border-b border-white/5">
          <div className="max-w-5xl mx-auto text-center">
            {label && (
              <p className="text-[10px] font-bold tracking-[0.2em] text-zinc-500 uppercase mb-8">
                {label}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-8 md:gap-14">
              {items.map((item: any, idx: number) => (
                <div
                  key={idx}
                  className={`text-sm md:text-base font-bold tracking-wider text-zinc-400 ${
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
        <section className="py-16 px-6 md:px-12 bg-[#0a0a0a] border-b border-white/5">
          <div className={`${widthClass} mx-auto text-zinc-300 text-base md:text-lg leading-relaxed whitespace-pre-wrap`}>
            {content}
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
          } bg-[#08080a] border-b border-white/5`}
        >
          <div className={isFullBleed ? "w-full" : "max-w-5xl mx-auto"}>
            {mediaUrl && (
              <div
                className={`overflow-hidden ${
                  !isFullBleed
                    ? "rounded-2xl border border-white/10 shadow-2xl"
                    : ""
                }`}
              >
                <img
                  src={mediaUrl}
                  alt={altText}
                  className="w-full h-auto object-cover max-h-[600px]"
                />
              </div>
            )}
            {caption && (
              <p className="mt-3 text-center text-xs text-zinc-500 italic">
                {caption}
              </p>
            )}
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}

function FaqPublicAccordion({
  kicker,
  title,
  subtitle,
  items,
  isTwoCol,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  items: Array<{ question: string; answer: string }>;
  isTwoCol: boolean;
}) {
  const [openIndexes, setOpenIndexes] = useState<Set<number>>(new Set([0]));

  const toggle = (idx: number) => {
    setOpenIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <section className="py-20 px-6 md:px-12 bg-[#0c0c0f] border-b border-white/5">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-14">
          {kicker && (
            <p className="text-[10px] font-bold tracking-[0.2em] text-[#e6d3a3] uppercase mb-2">
              {kicker}
            </p>
          )}
          <h2 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-3 text-sm text-zinc-400">{subtitle}</p>
          )}
        </div>

        <div className={`grid gap-4 ${isTwoCol ? "md:grid-cols-2" : ""}`}>
          {items.map((item, idx) => {
            const isOpen = openIndexes.has(idx);
            return (
              <div
                key={idx}
                className="rounded-2xl border border-[#27272A] bg-[#141418] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  className="w-full px-6 py-4 flex items-center justify-between text-left text-sm md:text-base font-bold text-zinc-100 cursor-pointer"
                >
                  <span>{item.question}</span>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 transition-transform ${
                      isOpen ? "rotate-180 text-[#e6d3a3]" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-5 text-xs md:text-sm text-zinc-400 leading-relaxed border-t border-white/5 pt-3">
                    {item.answer}
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
