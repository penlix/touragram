# Touragram Design System

A small, custom design system built for this app from plain CSS, with no
framework and no UI library. It exists so the screens stay visually consistent
and so styling decisions are made once, in tokens, rather than re-guessed per
screen. This documents the real decisions behind it.

## Direction: dark only

The app is dark-themed, and only dark-themed. There is no light or paper
variant, by choice. Touragram is a camera app: the screens sit over a live
camera feed or photos, and a dark, near-black surface keeps the focus on the
imagery and the glass UI floating on top. A light theme would fight the camera
viewfinder and the glass treatment, so it was never built. New screens are
expected to stay dark.

## Tokens: two tiers

All design values live in CSS custom properties, split into two tiers:

- **Primitives** (`styles/tokens/primitives.css`) hold the raw values: the
  colour ramp, the spacing scale, the type scale, radii, motion. These are the
  vocabulary, not used directly in components.
- **Semantic** (`styles/tokens/semantic.css`) holds named roles that map onto
  primitives: `--surface-base`, `--ink-primary`, `--accent-default`, and so on.
  Components reference these.

The point of the split: a component asks for `--ink-primary`, not for a
specific hex. If the palette changes, the primitive moves and every component
follows. The colour direction of the app has already been re-pitched once this
way (an earlier muted palette swapped wholesale for the current one) by editing
primitives alone.

### Colour

The neutral ramp runs dark to light, cool-tinted:

| Token | Value | Role |
| --- | --- | --- |
| `--color-neutral-0` | `#10141C` | page background (near-black, blue-cool) |
| `--color-neutral-1` | `#465775` | raised surface (dusk blue) |
| `--color-neutral-2` | `#5B6C5D` | borders (granite) |
| `--color-neutral-3` | `#B5B6C2` | secondary ink |
| `--color-neutral-4` | `#E8E4DC` | primary ink (warm cream) |

Accent is coral: `--color-accent-default: #EF6F6C`, with a lighter `#F38986`
for hover. Feedback colours: danger `#B83A3A` (deliberately darkened to
separate it from the coral accent), success `#59C9A5` with a brighter `#56E39F`
for hover.

Semantic mapping: `--surface-base` / `--surface-raised` for backgrounds,
`--ink-primary` / `--ink-secondary` for text, `--accent-default` /
`--accent-hover` for the primary action, `--accent-ink` (the cream) for content
sitting on an accent surface, `--border-default`, and `--feedback-*` for status.

### Typography

One family: a system sans stack (`--font-sans`). The project started with a
serif display face for the wordmark and dropped it; sans-only is simpler and
reads cleanly at every size on a phone. A modular size scale runs `--text-xs`
(0.75rem) through `--text-5xl` (3.75rem); weights are
regular/medium/semibold/bold; line-heights and letter-spacing (`--tracking-*`,
including a tight `-0.04em` for large display text) are tokenised too.

### Space, radius, motion

Spacing is a single scale (`--space-1` ... `--space-9`) used for padding, gaps,
and layout rhythm; `--space-5` (1.5rem) is the standard screen margin. Radii run
`--radius-sm` to `--radius-full` (the pill/circle). Motion is two durations
(`--duration-fast`, `--duration-base`) and one easing curve (`--ease-out`).

## The liquid-glass buttons

The signature element. Buttons are translucent glass that refracts whatever is
behind them (camera feed, photo, gradient), in two variants:

- **primary**: a warm coral-tinted glass, for the main action (the shutter, GO).
- **ghost**: a near-neutral, more transparent glass, for secondary actions
  (close, share).

Each button is built in three layers: the element itself holds the content; a
`::after` layer at the back carries the tint, a backdrop blur, and an **SVG
displacement filter** (`feTurbulence` + `feDisplacementMap`) that bends the
backdrop for the liquid refraction; a `::before` layer on top adds a bright rim
highlight. `overflow: hidden` clips the refraction to the button shape.

iOS Safari renders the SVG displacement filter unreliably, so there's a
documented fallback: an `@supports (-webkit-touch-callout: none)` block (which
matches iOS WebKit) drops the displacement and uses a heavier plain
backdrop-blur glass instead. The effect is richest on Chromium and degrades to
clean frosted glass on iOS rather than breaking. Press feedback is a subtle
scale-down plus a brief tint warm-up; there is no hover-lift, since the app is
touch-first.

## Components and layouts

Styles are assembled by `styles/main.css` in tiers: `tokens/`, then `base/`
(reset, element defaults), then `layouts/`, then `components/`.

- **button** (`components/button.css`): the glass treatment above. Sizes
  sm/md/lg; `data-variant` (primary/ghost); `data-shape="circle"` for round
  icon/text buttons.
- **card** (`components/card.css`): a glass card (landmark results, photo
  thumbnails). Reuses the same glass construction as the button.
- **sheet** (`components/sheet.css`): the bottom sheet that slides up for
  landmark detail, with a drag-to-dismiss handle.
- **screen** (`layouts/screen.css`): the full-viewport screen frame and the
  **bottom-actions** pattern, a centred primary circular action with secondary
  actions placed beside it.
- **carousel** (`layouts/carousel.css`): the horizontal scroll-snapping row
  used for result cards and the photo gallery.

## Principles

- **Style through semantic tokens.** Components reference semantic roles, not
  raw hex or pixel values. Change happens in one place.
- **Don't invent tokens without justification.** Reach for an existing token
  first; add a new one only when nothing fits, and record why.
- **Extract on the rule of three.** A pattern is allowed to live inline until a
  third use earns it a shared component or layout (this is how the carousel and
  sheet became their own files).
- **Touch-first.** Interactions are designed for a phone: press states over
  hover, generous tap targets, safe-area-aware spacing.

The live, interactive reference for these tokens and components is the internal
`styleguide.html` page (not linked publicly).
