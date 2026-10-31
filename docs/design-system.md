# Design system

The storefront's look is art-directed with two skills: **tasteskill v2** (Leonxlnx/taste-skill, art direction and a no-template house style) and **Emil Kowalski's design-engineering skills** (emilkowalski/skill, motion and interaction polish). This file records the decisions so every screen follows the same rules.

## Direction: the page is the object

STOREFRONT's printed artefact is the **receipt** (and its cousin, the swing tag). This shop's one claim no competitor can make is that a pricing optimizer, not the customer, finds the lowest total, and it shows its working as receipt lines.

> On this site, **the receipt the pricing optimizer prints** becomes **the shop's paper**: money is always set as receipt lines, and money saved is always struck with the brass highlighter.

- **The live thing** (home page): _Build a look_. Tap three to five real pieces, and a receipt prints beside them, priced live by `POST /pricing/quote` with the bundles the optimizer chose and the brass "You save" line. Without JavaScript it is a plain link to the catalogue.
- **Artefacts are filled shapes with real edges.** Receipts are `bg-card` paper on the grey ground with perforated top/bottom edges (`.edge-perforated`, `.edge-perforated-b`); swing tags are `.edge-notched`. Never an outlined rectangle.
- **The photograph stays the product.** Catalogue and product pages are photograph-led; the paper carries the prices, the facts and the sums.

## Tokens

| Role                | Value                                     | Tailwind                                        |
| ------------------- | ----------------------------------------- | ----------------------------------------------- |
| Ground (newsprint)  | `#e8e8e3`                                 | `bg-background`                                 |
| Paper (receipt)     | `#f6f6f4`                                 | `bg-card`                                       |
| Tone step           | `#dcdcd6`                                 | `bg-secondary` / `bg-muted`                     |
| Ink                 | `#181715`                                 | `text-foreground`, `bg-primary`                 |
| Secondary text      | `#63625c`                                 | `text-muted-foreground` (notes only, not body)  |
| Brass highlighter   | `#bfb21a`, ink on top                     | `bg-brass`, `.highlight` (money saved only)     |
| Field (inverted)    | ink ground, paper text                    | `bg-primary text-primary-foreground`            |
| Back office surface | `[data-surface='ledger']` scope           | white cards, near-white ground, `text-chart`    |

**Type:** Schibsted Grotesk only (variable, via `next/font`). Display: weight 800, tracking -0.05em, leading ≤ 0.9 (`text-display-xl`, `text-display-lg`, `text-display-md`). Text: 16-18px at weight 400, leading 1.5. Money uses the face's proportional figures: its tabular figures give commas and decimal points a digit's width, so prices read as monospace. `tabular-nums` belongs only in data-table columns that must align digit for digit (the back office). No monospace outside real code blocks, even on receipts.

**Shape:** square corners. **Shadows:** only on things that float (menus, dialogs, the cart drawer, toasts).

## House rules (tasteskill)

1. Headlines two lines or fewer at every width; one `h1` per page that says what it is.
2. No eyebrows: no small label or pill above a heading. No tiny uppercase letter-spaced labels anywhere.
3. No thin rules or 1px outlined boxes on pages: separate with space, a tone step or a change of scale. (Real tables and form fields may have lines.)
4. No gradients (a neutral scrim under text on a photo is the one exception), no glass/backdrop blur, no shadows at rest, no glows.
5. No icon-topped feature cards, no rows of identical cards, no emoji, no decorative shapes, no index numbering (01/02/03).
6. Equal outer margins at every width; no section huddled on one side with the other half empty; no blank stretch taller than half a screen.
7. Body text in full ink at 16px or more; grey is for secondary notes.
8. Proof is never invented: no fake reviews, press, customer counts or logos.

## Motion (Emil Kowalski)

- Curves: `ease-out` = `cubic-bezier(0.23, 1, 0.32, 1)` for entering and UI feedback; `ease-in-out` = `cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement; `ease-drawer` = `cubic-bezier(0.32, 0.72, 0, 1)` for sheets. Never `ease-in`.
- UI motion under 300ms: press 150ms, popovers 150ms, dialogs 200ms, drawer 300ms; exits faster than entrances.
- Every pressable thing scales to 0.97 on `:active`. Nothing animates from `scale(0)`; start at 0.95 or higher with opacity.
- Popovers grow from their trigger (`origin-[var(--radix-…-transform-origin)]`); dialogs stay centred.
- Name the transitioned properties; never `transition: all`. Animate `transform` and `opacity` only.
- Hover styles are gated to devices that can hover (`future.hoverOnlyWhenSupported`).
- Interruptible UI uses transitions, not keyframes. Never animate keyboard-driven or high-frequency actions.
- `prefers-reduced-motion`: keep fades, drop travel.
- Pages (not app screens) get one entrance per section: heading, then text, then picture, 60-90ms apart, rising 16-24px. Content is never hidden if the script fails. App screens (the back office) have no entrances; motion there is feedback only.

## Back office (tasteskill app screens, achromatic ledger)

Wrap the admin shell in `data-surface="ledger"`. Colour goes on data, not chrome: the chrome is ink and greys, the one data hue (`text-chart`/`bg-chart`, deep brass) marks each screen's main data element, and status pills are pale tint plus dark text of the same hue. KPIs are type, not tiles (no icon circles, no sparklines). Tables: sentence-case grey headers, no zebra stripes, numbers right-aligned in tabular figures, a grey dash for missing values, real zeros printed. One h1 per screen (a noun, about 24px), an optional one-line finding beneath it, and the screen's most frequent job one click away.
