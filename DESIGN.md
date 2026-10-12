# DESIGN.md: Gridiron Lab

The UI style file. Read it before any UI work. The study itself is explained in `docs/DESIGN_NOTEBOOK.md`.

## The look in one sentence
Friendly research: a warm off-white page, serif headlines that state the finding in plain words, one green accent, soft color panels behind the one interactive example, and real numbers everywhere.

## References
- Brilliant (brilliant2-hero): serif headline on warm off-white, a green pill button, a real interactive example on the right of the first screen. Taken for the homepage hero and the season-pill miss chart.
- Craft (craft-hero, craft-doc): warm editorial type and soft pastel panels that still look professional. Taken for the periwinkle panel behind the miss chart and the peach Archive panel.

## Colors
Tokens live in `src/styles.css` (`@theme static` for light, then the dark set under `prefers-color-scheme: dark` and `:root[data-theme="dark"]`). Tailwind classes use the token names (`bg-surface`, `text-muted`, `text-sage`, ...).

| Token | Light | Dark | Used for |
|---|---|---|---|
| background (`bg`) | #F5F2EC | #191816 | page background |
| surface | #FFFFFF | #23221F | cards, tables, chart cards, popovers |
| elevated | #F1EDE5 | #2C2A26 | inputs, chips and soft panels inside a card |
| panel / panel-2 | #E6EBF6 / #F7E8DC | #222737 / #2D2520 | the soft panels: miss chart stage, rule icons, Archive |
| text (`fg`) | #1C1B19 | #F1EEE8 | body text |
| text-muted (`muted`) | #5B5852 | #B7B1A7 | secondary text, captions |
| subtle | #635F57 | #A39D93 | tertiary labels (still 4.5:1 on bg, surface and elevated) |
| border | #DDD7CC | #3A3832 | dividers, card and control rings (`--shadow-border`) |
| primary (`accent`, `accent-fg`) | #1A6D3D on #FFFFFF text | #5BC489 with #0D1A12 text | main buttons, active toggles (`bg-accent`), focus ring (`ring`) |
| success (`sage`, `up`, `sage-soft`) | #1A6D3D, soft #DCEFE2 | #6FCF97, soft #1F3A2A | best value, better numbers, "Fixed" |
| warning (`warn`, `warn-soft`) | #8A5300, soft #FBEFD6 | #F0B75C, soft #3A2E17 | "Known limit", look-ahead rows, the Archive flag |
| danger (`rust`, `down`, `rust-soft`) | #A3392A, soft #F8E1DC | #F19A88, soft #3C2420 | errors, worse numbers |
| info (`navy`) | #2B5797 | #9CBCF0 | the demo-salary note icon, neutral notices |
| chart ink (`data`, `data-soft`, `track`) | #33415C, #8D97AD, #E9E4DA | #C9D2E6, #8A93A8, #34322D | chart dots and lines, the miss chart's tracks |

Charts read colors through CSS variables (`CHART` in `src/lib/nfl.ts` holds `var(--chart-ink)` and friends), so every Recharts chart follows the theme. Never hard-code a hex value in a component.

## Type
- Headings: Newsreader (Google Fonts), weight 500 (`font-display`), sentence case, slight negative tracking. No uppercase headings.
- Body: Instrument Sans, 16px base, line height 1.5. Weights 400 / 500 / 600.
- Code and some table figures: IBM Plex Mono.
- Scale: 12 / 14 / 16 / 20 / 26 / 32 / 42 / 64 (hero h1 is `clamp(40px, 5.2vw, 64px)`; section h2 is `clamp(30px, 3.4vw, 42px)`). Nothing under 12px.
- Numbers that line up (stats, tables): tabular figures (`tabular-nums`).

## Spacing and shape
- Spacing steps: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Study sections are 64px apart on desktop, 48px on phone, with a hairline rule between them.
- Page width: `max-w-6xl` with a 16px gutter on phone and 24px from `sm`.
- Radius: full pills for buttons, toggles and nav links; 18px for cards and tables; 28px for the soft panels.
- Shadows: a 1px ring (`--shadow-border`) on cards and controls; one soft lift (`--shadow-float`) only for the floating miss chart card, popovers and the sheet.

## Components
- The app's own Radix-based parts in `src/components/ui` (shadcn style). Don't make a custom version of anything they already have.
- Buttons: primary = filled green pill (`bg-accent text-accent-fg`), secondary/outline = surface pill with the ring, destructive = `rust` on `rust-soft`. Active segmented toggles keep `bg-accent` (the e2e checks read it).
- Season pickers on the study page: ink pills (`bg-fg text-bg` when pressed) with `aria-pressed`.
- Cards: no cards inside cards. A soft panel may hold one white card (the miss chart), never a stack of them.
- Study page parts: `src/components/study/parts.tsx` (section block, eyebrow, title, tag, table card, chart frame with a skeleton until the chart mounts).
- The $50k-lineup disclaimer ("a demo with synthetic salaries") stays visible at the top of the homepage and the Lineup page.

## Motion
- CSS transitions only (the app has no motion library): 150–300 ms, ease-out.
- At most 1–2 animated things per screen: the miss chart's dots slide when the season changes (260 ms), and buttons lift 1px on hover.
- Always respect prefers-reduced-motion (both are turned off).

## Icons and art
- Small UI icons: Lucide only (`lucide-react`), 18px, stroke 2, always next to text or with an `aria-label` on the button.
- No decorative illustrations: the real chart is the picture.

## Rules (every screen, always)
1. Skeleton loaders that match the final layout for anything that loads data (no layout shift). Skip them for near-instant loads.
2. Semantic colors (success, warning, danger, info) from the table above. Never use color as the only signal; pair it with an icon or text.
3. No clutter: no subtitle that restates a heading, no redundant helper text, no decorative dividers, no duplicate labels. If it isn't useful, remove it.
4. Accessibility, WCAG 2.2 AA: 4.5:1 text contrast (3:1 for large text and controls), full keyboard navigation with visible focus, a label on every input, aria-labels on icon-only buttons, alt text on meaningful images, semantic HTML, targets at least 24×24px, prefers-reduced-motion respected.
