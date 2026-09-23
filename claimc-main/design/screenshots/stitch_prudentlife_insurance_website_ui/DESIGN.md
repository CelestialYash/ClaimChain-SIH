---
name: Prudent Editorial Modern
colors:
  surface: '#fcf9f2'
  surface-dim: '#dcdad3'
  surface-bright: '#fcf9f2'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3ec'
  surface-container: '#f0eee7'
  surface-container-high: '#ebe8e1'
  surface-container-highest: '#e5e2db'
  on-surface: '#1c1c18'
  on-surface-variant: '#444748'
  inverse-surface: '#31312c'
  inverse-on-surface: '#f3f0e9'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1b'
  on-primary-container: '#858383'
  inverse-primary: '#c9c6c5'
  secondary: '#5b6056'
  on-secondary: '#ffffff'
  secondary-container: '#dfe4d7'
  on-secondary-container: '#61665c'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1c1c16'
  on-tertiary-container: '#86847c'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c9c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474646'
  secondary-fixed: '#dfe4d7'
  secondary-fixed-dim: '#c3c8bc'
  on-secondary-fixed: '#181d15'
  on-secondary-fixed-variant: '#43483f'
  tertiary-fixed: '#e6e2d9'
  tertiary-fixed-dim: '#cac6be'
  on-tertiary-fixed: '#1c1c16'
  on-tertiary-fixed-variant: '#484740'
  background: '#fcf9f2'
  on-background: '#1c1c18'
  surface-variant: '#e5e2db'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.015em
  stat-metric:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  card-title:
    fontFamily: Plus Jakarta Sans
    fontSize: 19px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 25.6px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  label-caps:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  button:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  margin: 3rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system establishes a high-trust, modern editorial aesthetic tailored for personal insurance, wealth preservation, and institutional coverage. The brand personality balances understated heritage and contemporary Scandinavian clarity: disciplined, empathetic, transparent, and quietly confident. 

Rather than relying on sterile corporate blues or overly technical motifs, the system leverages warm tactile neutrals, deep ink framing, and delicate botanical accents to demystify complex policies. Structural framing evokes editorial print design—anchored by high-contrast navigation and footer bars that cradle warm parchment sections and crisp white cards. The resulting interface feels enduring rather than ephemeral, replacing anxiety with poise and deliberate clarity.

## Colors

The palette is anchored by architectural black and organic, warm undertones. It rejects generic stark whites and synthetic grays in favor of layered, parchment-inspired surfaces.

### Core Roles
- **Primary Ink (`#0A0A0A`):** Used for top navigation headers, footer grounding bars, high-priority pill action buttons, key quantitative stat numbers, and prominent headline typography.
- **Warm Canvas Neutral (`#F7F4ED`):** The primary page canvas and default full-width section background across overview tiers, testimonial bands, and quick-access flows.
- **Card Surface (`#FFFFFF`):** Reserved for elevated interactive entities such as agent contact modules, account overviews, and policy product cards to achieve tactile contrast against the cream ground.
- **Secondary Tinted Neutral (`#EDE9E0`):** Used for conversion framing, such as final advisory banner modules and inline quote summary blocks.
- **Secondary Sage Accent (`#E7ECDF`):** A soft, calming green applied to expansive environmental sections (e.g., dual home & auto insurance showcases) to reduce visual fatigue.

### Categorical Pastel Tints (Badges & Chips)
- **Lavender (`#E6DFF4`):** Advisory, premium rider tiers, and life policies.
- **Mint (`#DCE9DA`):** Active status, verified agents, and property protection.
- **Blush (`#F6E1D8`):** Claims notifications, renewal alerts, and auto-protection badges.

### Typographic Contrast & Structural Dividers
- **Headings (`#111111`):** Near-black for crisp, legible letterforms with zero harsh glare.
- **Body & Captions (`#6B6A62`):** Warm mineral gray providing balanced legibility at text sizes.
- **On-Dark Canvas (`#FFFFFF`):** Pure white for primary text over ink containers.
- **On-Dark Muted (`#B8B8B0`):** Subtle gray for secondary metadata within ink containers.
- **Structural Dividers:** Hairline `1px solid #E3E0D6` applied systematically between cards and sections.

## Typography

Typography relies entirely on Plus Jakarta Sans to maintain a single, cohesive geometric grotesque voice throughout data tables, marketing sections, and policy forms.

- **Scale Rationale:** The core typographic hierarchy centers on fixed ratios that prioritize readability over ornament. Primary display headlines scale from 48px desktop down to a fluid 32px mobile adaptation.
- **Statistical Authority:** The dedicated `stat-metric` token (36px Bold) pairs directly with ink color tokens to state policy coverage values, deductible options, and company ratings without requiring oversized graphic iconography.
- **Rhythmic Body Text:** General paragraphs are pinned between 15px and 16px with a strict 1.6 relative line-height (`24px` to `25.6px`), mitigating eye strain during lengthy policy disclosures.
- **Card Anchors:** The 19px semibold level functions as the key entry point across modular grids, balancing distinction against adjacent interactive chips and labels.

## Layout & Spacing

The layout is built on a responsive 12-column grid system bounded by a max-width of 1280px for standard content arrays and edge-to-edge full-bleed bands for background sections (`#E7ECDF`, `#EDE9E0`, and `#0A0A0A`).

- **Desktop (1024px+):** 12 columns with a fixed 24px (`1.5rem`) gutter and generous 48px (`3rem`) page margins. Product comparison clusters and stat callouts utilize 3-column (4 cards) or 4-column (3 cards) allocations.
- **Tablet (768px - 1023px):** Reflows to an 8-column layout with 16px (`1rem`) gutters and 32px margins. Product groupings reflow to 4-column pairs.
- **Mobile (< 768px):** A single 4-column grid with 16px gutters and 20px (`1.25rem`) screen edges. Cards span 4 columns with horizontal scroll options for categorical pastel chips.
- **Section Pacing:** Full-width bands use vertical internal padding scaled to `4rem` (mobile) and `6rem` (desktop) to give policy descriptions breathing room.

## Elevation & Depth

This design system avoids heavy shadows, skewing instead toward tonal layering paired with crisp boundary lines. Depth is tactile, flat, and architectural:

- **Hairline Boundary Tiers:** Structural separation is primarily achieved through crisp `1px solid #E3E0D6` borders applied directly over `#FFFFFF` cards resting on the `#F7F4ED` canvas.
- **Zero Heavy Drop Shadows:** Standard drop shadows are omitted entirely. To indicate hover and active touch states on card modules, elevate using a micro offset: `box-shadow: 0 4px 12px rgba(10, 10, 10, 0.04)`.
- **Architectural Dark Framing:** Deep `#0A0A0A` blocks at the top and bottom of the viewport ground the interface, creating natural planar depth without simulated lighting layers.

## Shapes

The design system employs explicit, purpose-driven radii calibrated across distinct component scales:

- **Pill Geometry (`border-radius: 999px`):** Reserved exclusively for high-intent interactive buttons, filter toggles, and metadata tags/chips.
- **Media & Hero Framing (`border-radius: 24px`):** Applied to photographic portraiture of advisors, lifestyle imagery, and diagrammatic customer journey assets.
- **Container Surface Elements (`border-radius: 18px`):** Applied uniformly to all card formats—including agent profile cards, insurance tier cards, and quote calculation cards.
- **Form Inputs (`border-radius: 10px`):** Applied to interactive fields, date pickers, dropdown selectors, and policy numerical inputs.

## Components

### Buttons
- **Primary Pill:** High-contrast `#0A0A0A` fill with `#FFFFFF` text, `border-radius: 999px`, zero outline. Padding: `12px 28px`. Hover: subtle lightness reduction (`#262626`).
- **Secondary Pill:** `#FFFFFF` fill with `#0A0A0A` text and `1px solid #E3E0D6` border. Hover: canvas background (`#F7F4ED`).
- **Ghost/Tertiary:** Transparent fill, `#111111` semibold text with an inline icon; underline transitions on interaction.

### Chips & Badges
- **Status & Category Chips:** Capsule form (`border-radius: 999px`) with padding `6px 14px`. Typography set in `12px` semibold.
- **Palette Assignments:**
  - Lavender (`#E6DFF4`): Life, Advisory, and Umbrella policies.
  - Mint (`#DCE9DA`): Property, Active status, and Instant Claims.
  - Blush (`#F6E1D8`): Auto, Notifications, and Urgent Action items.
- Text color inside pastel chips remains `#111111` to preserve accessible contrast.

### Cards
- **Specification:** Pure `#FFFFFF` surface resting on `#F7F4ED` or `#E7ECDF` section canvases. Bounded by a `1px solid #E3E0D6` border with a uniform `18px` radius. Internal padding: `24px` (mobile) to `32px` (desktop).
- **Sub-types:**
  - *Agent Cards:* Feature circular or 24px-rounded portraits, 19px card titles, and mint verified-status chips.
  - *Account/Product Cards:* Top row contains a category pastel chip, followed by a 19px bold title, 15px body copy, and a primary pill button at the base.

### Input Fields
- **Specification:** Pure `#FFFFFF` background, `border-radius: 10px`, framed by a `1px solid #E3E0D6` hairline. Height: `48px`. Padding: `0 16px`.
- **Text & Placeholder:** Input value `#111111`, placeholder text `#6B6A62` (opacity `0.7`).
- **Focus State:** `1.5px solid #0A0A0A` with no offset outline or glow rings.

### Checkboxes & Radio Buttons
- **Shape & Dimensions:** 20px squares (`4px` radius) for checkboxes; 20px circles for radio options. Both feature `1.5px solid #E3E0D6` borders.
- **Active Selection:** Filled with `#0A0A0A` using crisp `#FFFFFF` check/dot glyphs.

### Lists & Data Displays
- **Specification:** Rows partitioned by `1px solid #E3E0D6` horizontal rules. Key metrics leverage the 36px bold stat token in ink `#0A0A0A`, backed by 12px uppercase label metadata.