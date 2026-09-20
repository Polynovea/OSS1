# Polynovea CMS Design System v1
## Imperial Operations — Product UI Color, Surface and Interaction System

**Status:** Canonical product UI specification
**Applies to:** Polynovea CMS admin/product surfaces
**Theme pair:** Imperial Night / Imperial Ivory
**Primary mode:** Dark
**Secondary mode:** Light
**Source lineage:** Derived from the Infrakinetic Imperial color-system architecture, adapted for the Polynovea CMS as a calmer, more neutral, operational product interface.
**Last design direction:** Modern workspace / cloud control plane — not sci-fi console, PCB panel, terminal dashboard or decorative luxury UI.

---

# 1. Purpose

This document is the canonical visual-system specification for the Polynovea CMS.

It exists to prevent the UI from drifting into page-specific styling decisions such as:

- arbitrary `text-zinc-*` values;
- opacity-driven typography such as `text-white/40`;
- raw hexadecimal colors repeated across components;
- every region becoming a bordered card;
- gold being used as a universal accent;
- purple being used without semantic meaning;
- different screens inventing their own status colors;
- dark mode being implemented as near-black surfaces with insufficient tonal separation;
- future light mode requiring a full component rewrite.

The system defines six layers:

1. **Brand palette** — persistent Polynovea-family visual identity.
2. **Theme palette** — surfaces, hierarchy, typography and boundaries.
3. **Semantic palette** — operational meaning such as success, warning, failure, information and review.
4. **Interaction palette** — hover, pressed, selected, focus and disabled states.
5. **Data-visualization palette** — charts, distributions and analytical signals.
6. **Layout language** — how those colors are used across navigation, content, forms, tables and operational views.

Core rule:

> **Brand colors create identity. Semantic colors communicate meaning. Theme colors create structure.**

A brand color must never replace a semantic color simply because it looks attractive.

---

# 2. Product Visual Direction

The Polynovea CMS should feel:

- calm;
- precise;
- premium;
- technically credible;
- operational;
- institutional;
- intelligent;
- durable;
- readable for long working sessions;
- modern without becoming trendy.

The product should resemble the visual discipline of a high-end workspace or cloud control plane more than a hardware console.

Desired references:

- modern enterprise workspaces;
- editorial tools;
- cloud operations products;
- sophisticated data systems;
- institutional reporting environments;
- premium analytical software.

The UI must **not** feel like:

- a chip-design control panel;
- a PCB/register dashboard;
- a terminal skin;
- cyberpunk;
- neon AI SaaS;
- gaming;
- Web3;
- casino luxury;
- generic purple startup software;
- a wall of bordered cards.

---

# 3. Relationship to Infrakinetic

The CMS shares the broader Imperial visual grammar with Infrakinetic, but it does **not** use the same visual mass.

Infrakinetic marketing can be more expressive and royal.

Polynovea CMS is more neutral because users may work inside it for many hours.

Recommended CMS visual balance:

- **78%** neutral/theme surfaces;
- **12%** aubergine/plum depth;
- **8%** light/ivory typography and high-contrast elements;
- **2%** champagne/metal prestige accents.

This is a visual-mass guideline, not a literal pixel-count rule.

The practical consequence is:

> Gold must feel valuable because it is rare.

---

# 4. Design-System Architecture

| Layer | Purpose | Operational meaning |
|---|---|---|
| Brand | Polynovea-family recognition | No |
| Theme | Surfaces, hierarchy, text, structure | Structural |
| Semantic | State and outcome | Yes |
| Interaction | Actionability and selection | Yes |
| Data visualization | Analytical differentiation | Contextual |
| Layout | Reading order and information density | Structural |

Hard rules:

- Never use gold to mean success.
- Never use purple to mean failure.
- Never use red merely for emphasis.
- Never use green merely because something is recommended.
- Human review belongs to violet/review semantics, not danger semantics.
- Absence of configuration is not a healthy state.
- Do not represent an unknown/degraded subsystem as green.

---

# 5. Permanent Brand Palette

These are stable identity colors and should not change between themes.

## 5.1 Core

| Token | Name | Hex | Role |
|---|---|---:|---|
| `brand.obsidian` | Obsidian Ink | `#0B0910` | Core institutional dark |
| `brand.ivory` | Warm Ivory | `#F5F1E8` | Core institutional light |

These two colors should be sufficient to reproduce the core identity in monochrome form.

## 5.2 Royal Family

| Token | Name | Hex | Role |
|---|---|---:|---|
| `brand.aubergine` | Imperial Aubergine | `#24162E` | Branded depth, large emphasis regions |
| `brand.plum` | Royal Plum | `#3B2348` | Structural brand accent |
| `brand.violet` | Regent Violet | `#8C6F99` | Intelligence, review, transformation |

Avoid common electric SaaS purple values such as:

- `#7C3AED`
- `#8B5CF6`
- `#A855F7`

They are too electric for the intended institutional visual language.

## 5.3 Metal Family

| Token | Name | Hex | Role |
|---|---|---:|---|
| `brand.champagne` | Champagne Gold | `#D8B56A` | Primary prestige accent |
| `brand.brass` | Antique Brass | `#B89452` | Secondary prestige accent |
| `brand.bronze` | Rose Bronze | `#C58F78` | Rare editorial / special-use accent |

Gold is scarce.

Allowed uses include:

- high-value primary CTA in dark mode;
- selected premium navigation moment;
- one important proof metric;
- important architectural highlight;
- critical brand moment;
- focus treatment when appropriate.

Gold should **not** be used for:

- every card border;
- every icon;
- every heading;
- routine navigation labels;
- success states;
- decorative outlines around most controls.

## 5.4 Supporting Neutrals

| Token | Name | Hex |
|---|---|---:|
| `neutral.graphitePlum` | Graphite Plum | `#15111A` |
| `neutral.charcoal` | Charcoal | `#25212A` |
| `neutral.mutedSlate` | Muted Slate | `#706A76` |
| `neutral.silverLilac` | Silver Lilac | `#B9B2C2` |

---

# 6. Dark Theme — Imperial Night

Dark mode is the flagship CMS expression.

It should feel dark without crushing detail.

## 6.1 Surfaces

| Semantic token | Hex | Usage |
|---|---:|---|
| `--bg-canvas` | `#0B0910` | Main application canvas |
| `--bg-sidebar` | `#0F0D12` | Navigation shell |
| `--bg-surface-1` | `#121017` | Default product sections |
| `--bg-surface-2` | `#18141D` | Nested panels / grouped content |
| `--bg-surface-3` | `#211B27` | Strong section separation |
| `--bg-elevated` | `#2A2231` | Dialogs, floating menus, popovers |
| `--bg-field` | `#100E14` | Inputs and inset wells |

Visual stack:

```text
#0B0910  Canvas
#0F0D12  Sidebar
#121017  Surface 01
#18141D  Surface 02
#211B27  Surface 03
#2A2231  Elevated
#100E14  Field / inset
```

Primary rule:

> **Use tonal shifts before borders to establish hierarchy.**

## 6.2 Borders

| Token | Hex | Usage |
|---|---:|---|
| `--border-subtle` | `#2D2732` | Dividers / quiet boundaries |
| `--border-default` | `#3A323F` | Inputs / clear object boundaries |
| `--border-strong` | `#4B414F` | Rare strong separation |
| `--border-brand` | `#6F596F` | Rare branded/selected edge |

Borders must not define every component.

## 6.3 Typography

| Token | Hex | Usage |
|---|---:|---|
| `--text-primary` | `#F5F1E8` | Headings and primary body copy |
| `--text-secondary` | `#C7BFCB` | Secondary copy |
| `--text-muted` | `#938A98` | Metadata and tertiary labels |
| `--text-disabled` | `#655E69` | Disabled/unavailable only |
| `--text-inverse` | `#0B0910` | Text on light/gold surfaces |

Important:

- ordinary explanatory copy must not use disabled-level contrast;
- metadata can be muted;
- avoid arbitrary white opacity as a hierarchy mechanism;
- small text requires stronger contrast than decorative metadata.

## 6.4 Icons

| Token | Hex |
|---|---:|
| `--icon-primary` | `#E9E3DD` |
| `--icon-secondary` | `#9B929F` |
| `--icon-muted` | `#706873` |

## 6.5 Brand Actions

| Token | Hex |
|---|---:|
| `--action-primary` | `#D8B56A` |
| `--action-primary-hover` | `#E3C884` |
| `--action-primary-pressed` | `#C49C4E` |
| `--action-primary-text` | `#0B0910` |
| `--action-secondary` | `#8C6F99` |
| `--brand-depth` | `#24162E` |

---

# 7. Light Theme — Imperial Ivory

Light mode must be a first-class product theme, not an inversion of dark mode.

It should feel like:

- premium paper;
- editorial reports;
- stone;
- institutional architecture;
- board materials;
- analytical documents.

Do not use pure white as the main application canvas.

## 7.1 Surfaces

| Semantic token | Hex | Usage |
|---|---:|---|
| `--bg-canvas` | `#F6F2EA` | Main warm canvas |
| `--bg-sidebar` | `#F1EBE2` | Navigation shell |
| `--bg-surface-1` | `#FFFCF7` | Primary sections |
| `--bg-surface-2` | `#F0EAE0` | Nested regions |
| `--bg-surface-3` | `#E8E0D6` | Strong separation |
| `--bg-elevated` | `#FFFFFF` | Floating UI |
| `--bg-field` | `#FBF8F2` | Inputs |

## 7.2 Borders

| Token | Hex |
|---|---:|
| `--border-subtle` | `#DED6CB` |
| `--border-default` | `#CDC3B8` |
| `--border-strong` | `#BDB2A6` |
| `--border-brand` | `#856A8C` |

## 7.3 Typography

| Token | Hex |
|---|---:|
| `--text-primary` | `#17121A` |
| `--text-secondary` | `#4C4551` |
| `--text-muted` | `#716876` |
| `--text-disabled` | `#A39AA7` |
| `--text-inverse` | `#F5F1E8` |

## 7.4 Icons

| Token | Hex |
|---|---:|
| `--icon-primary` | `#2C2530` |
| `--icon-secondary` | `#6F6674` |
| `--icon-muted` | `#928A95` |

## 7.5 Brand Actions

In light mode, deep Plum carries the primary action role.

Champagne becomes a prestige accent rather than the default action fill.

| Token | Hex |
|---|---:|
| `--action-primary` | `#4A2B58` |
| `--action-primary-hover` | `#3C2348` |
| `--action-primary-pressed` | `#301B39` |
| `--action-primary-text` | `#F5F1E8` |
| `--action-secondary` | `#78617F` |
| `--prestige-accent` | `#A27E3C` |
| `--brand-depth` | `#24162E` |

---

# 8. Theme-Aware Prestige Accent

Dark mode prestige accent:

`#D8B56A`

Light mode prestige accent:

`#A27E3C`

Do not force the same metallic hex across both themes.

The semantic role remains prestige/high-value emphasis, but the actual color is theme-aware to preserve sophistication and contrast.

---

# 9. Semantic Palette

Semantic states communicate actual product meaning.

They may not be replaced with brand colors.

Categories:

- success;
- warning;
- danger;
- information;
- review / intelligence;
- pending / neutral.

## 9.1 Dark Semantic States

| State | Foreground | Background | Border |
|---|---:|---:|---:|
| Success | `#79D3A7` | `#10281E` | `#2F7556` |
| Warning | `#F0C36A` | `#2B210E` | `#8B6825` |
| Danger | `#F28C94` | `#321518` | `#8D3940` |
| Information | `#8BB9E7` | `#132536` | `#3D6E9C` |
| Review / Intelligence | `#C3A4D2` | `#261A2E` | `#684B76` |
| Pending / Neutral | `#BEC5CC` | `#20252A` | `#515A63` |

## 9.2 Light Semantic States

| State | Foreground | Background | Border |
|---|---:|---:|---:|
| Success | `#216B4A` | `#E8F4ED` | `#8FC9AA` |
| Warning | `#8A5B12` | `#FFF4D8` | `#D6A84D` |
| Danger | `#A23843` | `#FCEBEC` | `#D88B92` |
| Information | `#315F8F` | `#EAF2FA` | `#88ADD1` |
| Review / Intelligence | `#68497B` | `#F3ECF6` | `#B89BC5` |
| Pending / Neutral | `#5E6670` | `#EFF1F3` | `#C0C5CB` |

---

# 10. Semantic Meaning Rules

## 10.1 Success — Green

Use for:

- passed checks;
- successful execution;
- completed reconciliation;
- healthy state;
- resolved dependency;
- verified deployment;
- successful migration.

Do not use green merely because something is recommended.

## 10.2 Warning — Amber

Use for:

- attention required;
- caution;
- approaching threshold;
- incomplete configuration;
- non-blocking issue;
- incomplete information;
- missing environment/setup requirement.

## 10.3 Danger — Red

Reserve for:

- failed validation;
- destructive actions;
- broken relationships;
- reconciliation failure;
- actual migration blockers;
- execution failure;
- critical violation;
- dead-letter state where intervention is required.

Do not use red for:

- human review;
- complexity;
- ordinary unmapped fields;
- neutral uncertainty.

## 10.4 Information — Blue

Use for:

- neutral informational state;
- system notices;
- explanatory feedback;
- background system state;
- ordinary editorial items awaiting action where no risk exists.

## 10.5 Review / Intelligence — Violet

Use for:

- machine-learning predictions;
- intelligence surfaces;
- human confirmation;
- ambiguous mapping review;
- scored recommendation;
- model confidence;
- transformation process;
- review queues;
- future Phase 12.75 predictive signals.

This separation is deliberate:

> **Deterministic truth uses normal semantic state. Predictive/intelligence signals use review-violet when they are neither success nor failure.**

## 10.6 Pending / Neutral

Use for:

- queued;
- not yet evaluated;
- idle;
- pending execution;
- configured but not verified;
- neutral unknown state.

---

# 11. Operational Intelligence Color Logic

The CMS architecture distinguishes deterministic intelligence from machine-learning intelligence.

The visual system must reinforce that distinction.

Example:

```text
Migration classification
SAFE                                  Success green

Predicted failure probability
4.7%                                  Review/intelligence violet

Human confirmation required
Pending                               Review/intelligence violet

Configuration incomplete
Environment missing                   Warning amber

Migration blocker
Foreign-key dependency unresolved     Danger red
```

Rules:

- ML never receives a special color that implies certainty.
- Confidence must be shown numerically/textually, not by saturation alone.
- Deterministic blocked states remain red regardless of ML prediction.
- Prediction and truth must never be visually indistinguishable.

---

# 12. Interaction Palette

## 12.1 Dark

| Interaction | Hex |
|---|---:|
| Primary action | `#D8B56A` |
| Primary hover | `#E3C884` |
| Primary pressed | `#C49C4E` |
| Primary text | `#0B0910` |
| Link | `#E0C17D` |
| Link hover | `#F0D89D` |
| Selected background | `#2E2435` |
| Selected border | `#8C6F99` |
| Selected text | `#F5F1E8` |
| Focus ring | `#E0C17D` |
| Neutral hover | `#211C25` |
| Neutral pressed | `#2B2430` |
| Disabled background | `#1D1920` |
| Disabled text | `#655E69` |
| Disabled border | `#302A34` |

## 12.2 Light

| Interaction | Hex |
|---|---:|
| Primary action | `#4A2B58` |
| Primary hover | `#3C2348` |
| Primary pressed | `#301B39` |
| Primary text | `#F5F1E8` |
| Link | `#5B366A` |
| Link hover | `#3D2448` |
| Selected background | `#EDE3F0` |
| Selected border | `#6C4A7A` |
| Selected text | `#3B2348` |
| Focus ring | `#7A4D8C` |
| Neutral hover | `#EFE9E1` |
| Neutral pressed | `#E2D9CF` |
| Disabled background | `#E6E0D8` |
| Disabled text | `#9D949F` |
| Disabled border | `#D2CBC3` |

---

# 13. Typography System

Current product fonts may remain:

- **Headline:** Epilogue
- **Body/UI:** Inter

The problem to solve is hierarchy and contrast, not font novelty.

## 13.1 Product Type Scale

Recommended roles:

| Role | Typical size | Weight | Purpose |
|---|---:|---:|---|
| Display / page hero | 40–52px | 700–800 | Rare command-center/editor hero |
| Page title | 28–36px | 650–750 | Main page heading |
| Section title | 18–22px | 600–700 | Primary region heading |
| Subsection title | 14–16px | 600 | Nested region |
| Body | 13–15px | 400–500 | Main working copy |
| Supporting | 12–13px | 400–500 | Secondary explanation |
| Metadata | 11–12px | 450–550 | Timestamps/state labels |
| Micro label | 10–11px | 500–600 | Rare field/category label |

## 13.2 Typography Rules

- Do not uppercase normal navigation.
- Do not uppercase normal form labels.
- Do not use uppercase as the default method for hierarchy.
- Micro-uppercase is allowed only for rare eyebrow/status/category treatment.
- Secondary explanatory text must remain readable.
- Avoid text below 11px except truly decorative metadata.
- Avoid excessively wide letter-spacing on routine labels.
- Headings should not all use maximum weight.

---

# 14. Surface and Card Logic

The CMS must not be a wall of cards.

Default hierarchy should come from:

1. spacing;
2. typography;
3. tonal background changes;
4. dividers;
5. borders only where required;
6. branded/semantic emphasis only when justified.

## 14.1 Use a Card When

A region is:

- independently actionable;
- a portable object;
- a selected item;
- a bounded configuration object;
- a status/evidence block;
- a reusable summary object.

## 14.2 Do Not Use a Card When

The content is merely:

- a section of the current page;
- a simple metric row;
- a list of events;
- a table;
- a sequence/flow;
- a group that spacing can already communicate.

## 14.3 Preferred Pattern

Instead of:

```text
[ CARD ] [ CARD ] [ CARD ] [ CARD ]
[ CARD ] [ CARD ] [ CARD ] [ CARD ]
```

Prefer:

```text
Section title

metric     metric     metric     metric

──────────────────────────────────────

Operational activity

row
row
row
```

---

# 15. Layout Rhythm

Use a spacious product rhythm without creating empty black voids.

Recommended spacing scale:

```text
4   micro
8   compact
12  control gap
16  component gap
20  compact section padding
24  standard section padding
32  section separation
40  major section separation
48  page rhythm
64  rare hero rhythm
```

Rules:

- operational pages should prefer 24–40px vertical section rhythm;
- dense data tables may compress internally but should have breathing room around them;
- do not use a border where 24px of whitespace provides sufficient separation;
- avoid arbitrary spacing values unless a component truly requires them.

---

# 16. Navigation System

The CMS navigation is grouped by user intent.

Canonical groups:

## Workspace

- Command Center

## Create

- Experience Studio
- Blog
- Data Studio
- Media

## Structure

- Data Models
- Taxonomy
- Site Tree & Routes
- Redirects
- Navigation
- Localization

## Operate

- Releases
- Workflows
- Calendar
- My Work

## Observe

- Metrics
- Assurance
- Delivery Ops
- Intelligence

## Platform

- Developer
- Environments
- Connections
- Setup & Infrastructure
- Access

Navigation rules:

- title case;
- calm 13px labels;
- no all-caps list;
- active state uses tonal selection + modest brand accent;
- no gold trace/bar down the side of every active item;
- group labels are subtle and secondary;
- rarely used platform areas may later become collapsible;
- gold text is not used for normal navigation.

---

# 17. Command Center Rules

The Command Center is an operational overview, not a grid of dashboard cards.

It must answer four questions immediately:

1. Is the platform healthy?
2. What needs attention?
3. What is moving through content/release/delivery?
4. What environment/infrastructure is being operated?

Preferred composition:

- open page header;
- platform readiness statement;
- current environment summary;
- horizontal metric rail;
- Needs Attention list;
- content lifecycle visualization;
- delivery/infrastructure/assurance operational list;
- recent releases/activity feed.

Do not:

- surface raw database table names;
- fail the entire dashboard because one subsystem is unavailable;
- say “Operational” when no runtime environment exists;
- use eight identical bordered stat cards;
- use gold for every count/icon.

Unavailable subsystem behavior:

> Degrade gracefully into an unavailable/unknown signal and continue rendering the remaining platform state.

---

# 18. Forms and Inputs

Forms are a major source of perceived product quality.

## 18.1 Dark Field Tokens

```text
Background      #100E14
Border          #2D2732
Text            #F5F1E8
Secondary       #C7BFCB
Placeholder     #655E69
Hover border    #3A323F
Focus ring      #E0C17D
Disabled bg     #1D1920
```

## 18.2 Light Field Tokens

```text
Background      #FBF8F2
Border          #CDC3B8
Text            #17121A
Secondary       #4C4551
Placeholder     #A39AA7
Hover border    #BDB2A6
Focus ring      #7A4D8C
Disabled bg     #E6E0D8
```

## 18.3 Form Rules

- labels above fields;
- labels in title case, not all caps;
- support text immediately below label or field;
- validation message adjacent to affected field;
- form groups separated with spacing rather than boxed panels where possible;
- secrets use explicit write-only treatment;
- destructive actions visually separated from ordinary actions;
- inputs use inset tonal surface, not bright outlines;
- focus must always remain visible.

---

# 19. Buttons and Actions

## 19.1 Primary

Dark:

- fill Champagne `#D8B56A`;
- text Obsidian `#0B0910`.

Light:

- fill Deep Plum `#4A2B58`;
- text Ivory `#F5F1E8`.

Use one primary action per decision region.

## 19.2 Secondary

- neutral/transparent surface;
- theme primary text;
- subtle border only when needed.

## 19.3 Tertiary

- text/link action;
- no container until hover where practical.

## 19.4 Destructive

Must use semantic danger tokens, not brand red/gold styling.

## 19.5 Action Hierarchy

Never make primary and secondary actions equally visually loud.

---

# 20. Tables

Tables should feel like data, not a stack of mini cards.

Rules:

- use a clean surface with row separators;
- reduce vertical borders;
- header text is 11–12px and readable;
- avoid tiny uppercase column headers unless very short and genuinely categorical;
- selected rows use selected-background tokens;
- status cells use semantic badges/labels;
- actions align consistently at right;
- dense tables may use 36–44px row height;
- ordinary tables should use 44–52px row height;
- hover treatment is tonal, not a bright border.

---

# 21. Lists and Activity Feeds

Operational activity is better represented as rows/timelines than as cards.

Each row may contain:

- primary label;
- secondary context;
- status icon/label;
- timestamp;
- action/link.

Use dividers sparingly and allow spacing to create structure.

Audit feeds should not reveal low-level technical implementation names unless the user explicitly opens technical detail.

---

# 22. Status Components

Do not rely on color alone.

Good:

```text
✓ Passed
⚠ Needs attention
● Review required
✕ Failed
```

Bad:

```text
[green dot]
[amber dot]
[red dot]
```

A status component should combine:

- color;
- label;
- shape/icon;
- optional explanation.

---

# 23. Data Visualization Palette

Charts are information systems and must not use arbitrary brand colors.

## 23.1 Dark Categorical

Maximum recommended simultaneous categories: **6**.

| Index | Name | Hex |
|---|---|---:|
| 1 | Regent | `#B395C0` |
| 2 | Champagne | `#D8B56A` |
| 3 | Sky Slate | `#75A9D7` |
| 4 | Mineral Teal | `#64AAA2` |
| 5 | Sage | `#86AD76` |
| 6 | Rose | `#D38F98` |
| 7 | Periwinkle | `#9297D2` |
| 8 | Silver | `#B5AFBA` |

## 23.2 Light Categorical

| Index | Name | Hex |
|---|---|---:|
| 1 | Royal | `#5B366A` |
| 2 | Brass | `#A06F1F` |
| 3 | Slate Blue | `#376FA3` |
| 4 | Deep Teal | `#2F7C77` |
| 5 | Sage | `#4F7B46` |
| 6 | Rose | `#A65362` |
| 7 | Indigo | `#5A5F9C` |
| 8 | Graphite Violet | `#6A6673` |

Chart rule:

- 1 series: one appropriate brand/chart color;
- 2–6 series: categorical palette;
- 7+ series: reconsider the chart structure before adding colors.

---

# 24. Sequential and Diverging Scales

## 24.1 Sequential Royal — Dark

Use for:

- risk intensity;
- confidence;
- workload;
- probability;
- density;
- health intensity.

```text
Low
#33223C
#493052
#64426F
#81598E
#A57CB2
#CFB3D8
High
```

## 24.2 Sequential Royal — Light

```text
Low
#F3ECF6
#DFCEE6
#C4A7CF
#9B72AA
#704C7F
#4A2B58
High
```

## 24.3 Diverging — Dark

Use only with a meaningful negative ↔ neutral ↔ positive midpoint.

```text
#F28C94 → #B76068 → #4B4550 → #57A17A → #79D3A7
Negative                Neutral                Positive
```

## 24.4 Diverging — Light

```text
#A23843 → #D7898F → #E9E2D9 → #8FC39E → #216B4A
Negative                Neutral                Positive
```

---

# 25. Charts and ML / Intelligence

ML confidence is not automatically “good”.

Therefore:

- model confidence may use sequential violet;
- predicted risk should use an appropriate risk scale;
- actual operational failure uses danger semantics;
- predicted probability and actual outcome must be visually distinct;
- do not use green for high confidence unless the underlying outcome is also positive.

---

# 26. Background and Atmosphere

Atmosphere is allowed only as a supporting treatment.

Dark Aubergine example:

```css
background:
  radial-gradient(
    circle at 70% 15%,
    rgba(59, 35, 72, 0.16),
    transparent 45%
  ),
  #0B0910;
```

Subtle Champagne example:

```css
background:
  radial-gradient(
    circle at 25% 10%,
    rgba(216, 181, 106, 0.04),
    transparent 35%
  ),
  #0B0910;
```

Rules:

- no animated starfield behind dense application UI;
- no permanent particle field;
- no high-opacity violet/gold blobs;
- no neon glow;
- no large pulsing gradients;
- atmosphere must never compete with readability.

---

# 27. Metallic Color Rule

Metallic colors in digital UI are flat colors.

Do not simulate metal using:

- bevels;
- chrome;
- fake reflections;
- lens flares;
- strong gradients;
- glossy buttons.

Luxury/premium quality comes from:

- scarcity;
- proportion;
- typography;
- spacing;
- material-inspired hue;
- restraint.

---

# 28. Motion

Allowed:

- subtle hover transitions;
- small selected-state transitions;
- restrained opacity/position transitions;
- progress/state animation where informative.

Avoid:

- pulsing gold;
- continuous glowing buttons;
- animated particles behind content;
- neon trails;
- decorative perpetual motion;
- motion that makes dense operational pages harder to scan.

Respect `prefers-reduced-motion`.

---

# 29. Accessibility

Target: **WCAG 2.2 AA**.

Minimum requirements:

- normal text: 4.5:1;
- large text: 3:1;
- important boundaries/graphics: 3:1 where applicable;
- focus ring always visible;
- status never communicated by color alone;
- controls retain sufficient hit area;
- disabled states remain distinguishable without becoming unreadable.

Focus ring:

Dark:

`#E0C17D`

Light:

`#7A4D8C`

Use a consistent 2px or equivalent ring.

---

# 30. Theme Behavior

Supported modes should eventually be:

- System;
- Light;
- Dark.

Persist user preference.

If no preference exists:

> Use system theme.

The CMS may currently default to dark during migration, but the token architecture must not assume dark forever.

---

# 31. CSS Token Contract

Components should consume semantic variables rather than raw palette values.

## 31.1 Permanent Brand Variables

```css
:root {
  --brand-obsidian: #0B0910;
  --brand-ivory: #F5F1E8;
  --brand-aubergine: #24162E;
  --brand-plum: #3B2348;
  --brand-violet: #8C6F99;
  --brand-champagne: #D8B56A;
  --brand-brass: #B89452;
  --brand-bronze: #C58F78;
}
```

## 31.2 Dark Theme Variables

```css
[data-theme="dark"] {
  --bg-canvas: #0B0910;
  --bg-sidebar: #0F0D12;
  --bg-surface-1: #121017;
  --bg-surface-2: #18141D;
  --bg-surface-3: #211B27;
  --bg-elevated: #2A2231;
  --bg-field: #100E14;

  --border-subtle: #2D2732;
  --border-default: #3A323F;
  --border-strong: #4B414F;
  --border-brand: #6F596F;

  --text-primary: #F5F1E8;
  --text-secondary: #C7BFCB;
  --text-muted: #938A98;
  --text-disabled: #655E69;
  --text-inverse: #0B0910;

  --icon-primary: #E9E3DD;
  --icon-secondary: #9B929F;
  --icon-muted: #706873;

  --action-primary: #D8B56A;
  --action-primary-hover: #E3C884;
  --action-primary-pressed: #C49C4E;
  --action-primary-text: #0B0910;
  --action-secondary: #8C6F99;
  --focus-ring: #E0C17D;
}
```

## 31.3 Light Theme Variables

```css
[data-theme="light"] {
  --bg-canvas: #F6F2EA;
  --bg-sidebar: #F1EBE2;
  --bg-surface-1: #FFFCF7;
  --bg-surface-2: #F0EAE0;
  --bg-surface-3: #E8E0D6;
  --bg-elevated: #FFFFFF;
  --bg-field: #FBF8F2;

  --border-subtle: #DED6CB;
  --border-default: #CDC3B8;
  --border-strong: #BDB2A6;
  --border-brand: #856A8C;

  --text-primary: #17121A;
  --text-secondary: #4C4551;
  --text-muted: #716876;
  --text-disabled: #A39AA7;
  --text-inverse: #F5F1E8;

  --icon-primary: #2C2530;
  --icon-secondary: #6F6674;
  --icon-muted: #928A95;

  --action-primary: #4A2B58;
  --action-primary-hover: #3C2348;
  --action-primary-pressed: #301B39;
  --action-primary-text: #F5F1E8;
  --action-secondary: #78617F;
  --prestige-accent: #A27E3C;
  --focus-ring: #7A4D8C;
}
```

## 31.4 Dark Semantic Variables

```css
[data-theme="dark"] {
  --success-fg: #79D3A7;
  --success-bg: #10281E;
  --success-border: #2F7556;

  --warning-fg: #F0C36A;
  --warning-bg: #2B210E;
  --warning-border: #8B6825;

  --danger-fg: #F28C94;
  --danger-bg: #321518;
  --danger-border: #8D3940;

  --info-fg: #8BB9E7;
  --info-bg: #132536;
  --info-border: #3D6E9C;

  --review-fg: #C3A4D2;
  --review-bg: #261A2E;
  --review-border: #684B76;

  --pending-fg: #BEC5CC;
  --pending-bg: #20252A;
  --pending-border: #515A63;
}
```

Equivalent light-theme semantic variables must also exist.

---

# 32. Tailwind / Utility Contract

Do not continue proliferating values such as:

```tsx
text-white/40
text-zinc-600
bg-white/[0.025]
border-white/10
bg-purple-500/10
border-yellow-400/30
```

Prefer semantic utilities/tokens such as:

```tsx
text-primary
text-secondary
text-muted
text-disabled

bg-canvas
bg-surface-1
bg-surface-2
bg-elevated
bg-field

border-subtle
border-default

text-success
bg-success-muted

text-review
bg-review-muted
```

The exact Tailwind mapping may evolve, but semantic names are mandatory.

---

# 33. Opacity-Driven Typography Is Deprecated

The following patterns are deprecated for routine product text:

- `text-white/30`
- `text-white/40`
- `text-white/50`
- `text-white/60`
- `text-zinc-700` for explanatory copy
- arbitrary alpha values used as pseudo-design tokens.

Why:

- accessibility becomes unpredictable;
- light theme becomes difficult;
- visual hierarchy becomes accidental;
- brand identity drifts;
- pages become eye-straining.

Use explicit semantic text colors instead.

---

# 34. Product-Specific Surface Guidance

## 34.1 Data Studio / Editor

- neutral Surface 1 main editor;
- Surface 2 metadata rail;
- fields on Field surface;
- review state uses violet only when review is actually relevant;
- primary focus remains content, not decorative brand color.

## 34.2 Intelligence

- may use more Regent/Aubergine depth;
- ML/prediction surfaces use Review/Intelligence semantics;
- actual system health continues to use normal semantic colors;
- charts use data-visualization palette, not random brand colors.

## 34.3 Infrastructure / Environments / Connections

- primarily neutral;
- correctness beats branding;
- warning/danger/success states must be immediately legible;
- credentials/forms use the standard field system;
- provider logos/colors must not override semantic meaning.

## 34.4 Releases / Delivery Ops

- flows and timelines preferred over card grids;
- execution state uses semantic tokens;
- destructive/rollback actions clearly isolated;
- dead-letter is danger;
- queued/running are pending/information depending on context.

## 34.5 Assurance

- findings use semantic severity;
- review is not red;
- blocking = danger;
- warning = amber;
- resolved = success;
- informational quality advice = blue/neutral.

## 34.6 Developer

- code/API content remains neutral;
- syntax/readability takes priority;
- secrets are never represented using decorative branded treatments;
- generated credentials use explicit security warnings.

---

# 35. Empty States

Empty states should communicate what is missing and what the user can do next.

Example:

Bad:

```text
0 environments
```

Better:

```text
No environment configured
Create an environment to activate provisioning, deployment health and reconciliation.
[Create environment]
```

Rules:

- zero data is not automatically an error;
- required missing configuration is warning-level;
- explain the consequence of the missing configuration;
- provide the next action;
- do not use large decorative illustrations unless they aid comprehension.

---

# 36. Error Presentation

User-facing UI must not expose raw internal implementation detail such as:

- database table names;
- raw PostgREST errors;
- SQL fragments;
- credential locators;
- internal stack traces;
- provider SDK exception dumps.

Instead show:

```text
Analytics status is temporarily unavailable.
The rest of the Command Center is still available.
[View diagnostics]
```

Technical detail may be exposed intentionally in Developer/Diagnostics surfaces with appropriate permissions.

---

# 37. Graceful Degradation

Platform overview screens must be fault-tolerant.

A failure in one optional subsystem must not blank the entire UI.

Rules:

- subsystem unavailable → record unavailable/degraded signal;
- remaining subsystems continue rendering;
- overall readiness calculation distinguishes required vs optional systems;
- raw errors remain server-side/diagnostic;
- uncertainty is shown explicitly rather than converted to success.

---

# 38. Implementation Sequence

## Step 1 — Token Foundation

Create permanent brand variables and theme/semantic variables in the global CSS/theme layer.

## Step 2 — Typography

Replace low-opacity and arbitrary `zinc` text values with semantic text tokens.

## Step 3 — Surfaces

Replace raw near-black backgrounds with canvas/surface/elevated/field tokens.

## Step 4 — Shared Shell

Convert:

- sidebar;
- top bar;
- page canvas;
- navigation states;
- scrollbars;
- global focus behavior.

## Step 5 — Forms

Normalize:

- input;
- textarea;
- select;
- checkbox;
- radio;
- toggle;
- field labels;
- validation states.

## Step 6 — Semantic Status Components

Create reusable:

- Success state;
- Warning state;
- Danger state;
- Information state;
- Review/Intelligence state;
- Pending state.

## Step 7 — Command Center

Use it as the reference implementation for open-section hierarchy and operational state.

## Step 8 — High-Use Screens

Prioritize:

1. Data Studio;
2. Data Models;
3. Infrastructure;
4. Connections;
5. Environments;
6. Releases;
7. Delivery Ops;
8. Intelligence;
9. Assurance;
10. Workflows.

## Step 9 — Tables and Lists

Replace card-based lists where a table/row/feed is structurally better.

## Step 10 — Light Theme

Implement Imperial Ivory from the same semantic token contract.

## Step 11 — Charts

Migrate charts to data-visualization tokens and audit accessibility.

## Step 12 — Hard-Coded Color Audit

Search and remove remaining direct:

- `#...` color values in product components;
- `text-zinc-*` product hierarchy values;
- `text-white/*` hierarchy values;
- random semantic colors;
- page-local border systems.

---

# 39. Do Not Do

Do not:

- globally replace every existing gold with one new hex and call the migration complete;
- globally replace every purple with Aubergine;
- use opacity modifiers as the primary hierarchy system;
- make every region a card;
- make every component visibly branded;
- turn semantic status colors into brand colors;
- use gold gradients on buttons;
- make light mode pure white;
- make dark mode pure black;
- use neon purple;
- make selection, review and failure visually similar;
- make all proof metrics gold;
- add large decorative animation behind working screens;
- hide operational meaning for aesthetic consistency.

---

# 40. Code Review Rules

New or materially redesigned CMS UI should be rejected in review if it:

- introduces raw brand/theme hex values in component JSX without a justified exception;
- introduces arbitrary `text-white/XX` hierarchy styling;
- uses red for review;
- uses gold for success;
- relies on color alone for status;
- creates a new page-local status palette;
- uses a bordered card where spacing/typography would communicate hierarchy better;
- exposes raw backend errors to normal users;
- fails WCAG contrast without documented exception;
- prevents light-theme compatibility through hard-coded dark values.

---

# 41. Definition of Success

The CMS redesign is successful when a user sees:

> **a calm, premium operational workspace**

rather than:

> a dark admin console.

A technical evaluator should see:

> **controlled information hierarchy and explicit operational semantics**

rather than:

> decorative branding or arbitrary status color.

A person using the CMS for several hours should experience:

- readable secondary text;
- clear hierarchy without excessive borders;
- sufficient tonal separation;
- predictable action emphasis;
- semantic state consistency;
- low visual fatigue.

A returning user should recognize the visual family as Polynovea while still being able to distinguish product state from brand decoration.

---

# 42. Canonical Quick Reference

## Brand Core

```text
Obsidian Ink       #0B0910
Warm Ivory         #F5F1E8
Imperial Aubergine #24162E
Royal Plum         #3B2348
Regent Violet      #8C6F99
Champagne Gold     #D8B56A
Antique Brass      #B89452
Rose Bronze        #C58F78
```

## Dark Product Surfaces

```text
Canvas             #0B0910
Sidebar            #0F0D12
Surface 1          #121017
Surface 2          #18141D
Surface 3          #211B27
Elevated           #2A2231
Field              #100E14
```

## Dark Text

```text
Primary            #F5F1E8
Secondary          #C7BFCB
Muted              #938A98
Disabled           #655E69
```

## Light Product Surfaces

```text
Canvas             #F6F2EA
Sidebar            #F1EBE2
Surface 1          #FFFCF7
Surface 2          #F0EAE0
Surface 3          #E8E0D6
Elevated           #FFFFFF
Field              #FBF8F2
```

## Dark Primary CTA

```text
Fill               #D8B56A
Text               #0B0910
```

## Light Primary CTA

```text
Fill               #4A2B58
Text               #F5F1E8
```

## Dark Semantic Foregrounds

```text
Success            #79D3A7
Warning            #F0C36A
Danger             #F28C94
Information        #8BB9E7
Review/Intelligence#C3A4D2
Pending            #BEC5CC
```

---

# 43. Working Name

The CMS system may be referred to internally as:

## **Polynovea CMS — Imperial Operations**

with theme pair:

- **Imperial Night** — dark product theme;
- **Imperial Ivory** — light product theme.

The name is for internal design-system clarity and does not need to appear in the customer-facing UI.

---

# 44. Canonicality

This document is the source of truth for future Polynovea CMS product UI work unless superseded by a newer explicitly versioned design-system document.

Where current implementation conflicts with this specification, the implementation should be treated as **migration debt**, not as precedent.

When uncertain:

1. prefer semantic tokens over raw colors;
2. prefer tonal hierarchy over borders;
3. prefer readability over decorative subtlety;
4. prefer explicit operational meaning over brand color;
5. prefer calm product surfaces over visual spectacle;
6. preserve dark/light theme portability.

---

**End of Polynovea CMS Design System v1**
