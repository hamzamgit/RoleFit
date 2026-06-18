# RoleFit — Design System

RoleFit is a premium, autonomous hiring/job-matching product. The UI must feel
like a **modern Apple product**: light, airy, breathing, restrained, crafted —
**not** generic "AI dashboard" slop. Every surface and control has real depth.

## Brand & Personality
- **Voice:** calm, confident, precise. Minimal copy.
- **Feel:** Apple macOS/iOS premium + **Liquid Glass** (frosted translucent
  surfaces with blur, hairline borders, soft layered shadows, subtle highlights).
- **Anti-patterns:** loud gradients, neon, emoji spam, dense clutter, flat gray
  boxes, monospace/condensed/UPPERCASE chrome, low-contrast washed text.

## Color
Light base; glass reads against a soft cool canvas.
- **Canvas:** `#f5f5f7` (soft cool off-white) with a faint cool mesh so frosted
  glass has depth to blur. Vertical wash `#fbfbfd → #f3f3f6`.
- **Ink / primary text:** `#1d1d1f` (graphite near-black).
- **Secondary text:** `#6e6e73`. **Tertiary:** `#8e8e93`.
- **Surfaces (glass):** translucent white `rgba(255,255,255,0.62)` (cards),
  `0.78` (popovers/dialogs), `0.55` (secondary) — always with backdrop-blur.
- **Primary action:** graphite `#1d1d1f` button, white text (Apple dark button).
- **Accent (links, focus, active):** Apple system blue `#0071e3`.
- **Status:** success `#1d8a3f`, warning `#b25000`, destructive `#d70015`
  (tuned for light backgrounds).
- **Hairline border:** `rgba(29,29,31,0.10)`.

## Typography
- **Family:** Apple system stack — `-apple-system, "SF Pro Display",
  "SF Pro Text", "Inter", system-ui, sans-serif`. **No** condensed/pixel/display
  brand faces. **No** uppercase or wide letter-spacing on buttons/badges/titles.
- **Tracking:** tight, ~`-0.011em` body, `-0.02em` headings.
- **Base size:** 15px. **Line-height:** 1.55.
- **Scale:** page title 1.3rem/600 · section 1.05rem/600 · body 15px/400 ·
  secondary 13–14px · caption 11–12px.
- **Mono** (`SF Mono`/`JetBrains Mono`) ONLY for code, job descriptions, raw
  config values — never for UI chrome.

## Shape & Elevation
- **Radius:** cards/panels 16px, controls 12–14px, pills/chips full.
- **Elevation (3 tiers, layered ambient + key shadow):**
  - e1: `0 1px 2px rgba(29,29,31,.05), 0 1px 1px rgba(29,29,31,.04)`
  - e2: `0 1px 2px rgba(29,29,31,.05), 0 6px 16px -6px rgba(29,29,31,.12)`
  - e3: `0 2px 4px rgba(29,29,31,.05), 0 14px 32px -10px rgba(29,29,31,.18)`
- **Glass treatment:** `backdrop-filter: blur(20px) saturate(180%)`, translucent
  fill, 1px hairline, inset top highlight `inset 0 1px 0 rgba(255,255,255,.18)`,
  diffuse shadow.

## Motion
- 0.18–0.22s ease. Cards **hover-lift** (−1px + shadow grows e2→e3). Buttons
  **press** (translateY 0 + inset shadow). Focus = Apple-blue glow ring
  `0 0 0 3px rgba(0,113,227,.18)`. Honor `prefers-reduced-motion`.

## Icons
- **Phosphor Icons**, `regular` weight default, `fill`/`duotone` for active or
  emphasis states. 16–20px, aligned to text.

## Components
- **Sidebar (glass):** RoleFit wordmark top, calm pill nav rows (sentence case,
  16px icon, 2px Apple-blue active rail + filled active bg). 5 items only:
  Maestro, Applicants, Jobs, Matches, Applications.
- **Top header (glass):** bold high-contrast page title + right-aligned actions.
- **Cards:** frosted glass, e2 resting, hover-lift, 16px radius, generous padding.
- **Buttons:** primary = graphite w/ inset highlight + e2 + press; secondary =
  glass; ghost/icon = minimal. Never uppercase.
- **Inputs/textarea:** translucent, inset depth, Apple-blue focus glow.
- **Badges/chips:** soft elevated pills, sentence case.
- **Tabs/filters:** pill chips; active = filled glass + ring.
- **Tables (Jobs):** solid card, sticky blurred header, comfortable cells,
  calm hover, subtle row separators.
- **Kanban (Applications):** distinct soft glass lanes, clear headers + count
  pills, draggable cards on glass.
- **States:** every list has a refined empty (icon + one line + dashed glass
  panel) and skeleton loading — never bare "Loading…".

## Screens (generate on-brand)
1. **Maestro** — agent chat: sessions rail, message stream (agent w/ collapsible
   "Thinking", tables/code), suggestion chips, glass composer.
2. **Applicants** — profile cards (persona, model, tags, background, skills).
3. **Jobs** — shared pool table w/ qualify flag, filters, free-source buttons,
   requirements panel, expandable rows w/ qualify trace.
4. **Matches** — per-seeker match cards: score ring, criteria bars, rationale,
   gap chips, feedback, generation buttons.
5. **Applications** — kanban: Shortlisted → Applied → Interview → Offer → Rejected.
