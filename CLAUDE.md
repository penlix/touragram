# Touragram

A personal learning project. A phone web app that uses the camera and GPS to
identify landmarks and points of interest the user points it at, anywhere.

## Stack

- Frontend: plain HTML, CSS, JavaScript. No frameworks, no build step. The
  point is to understand fundamentals before adding tools.
- Backend: one Vercel serverless function (`api/identify.js`) that calls the
  Claude API and the Wikimedia API. This is the only part with an npm
  dependency (`@anthropic-ai/sdk`); Vercel runs `npm install` on deploy.

## Architecture

Frontend pages (each a standalone HTML file at the project root):
- `index.html` — welcome screen. GO button → capture.
- `capture.html` — the core screen. A live back-camera feed; tapping the
  shutter freezes the frame and runs identification. It's a small state
  machine: live → loading → results (a carousel of landmark cards) or empty
  ("No landmarks found"). Tapping a card opens a bottom sheet with the
  landmark's photos, name, and description.
- `styleguide.html` — internal design-system reference (tokens, type,
  buttons). Working reference only; not linked publicly. The written
  design-system documentation is `docs/design-system.md`.
- `prototype.html` — early visual reference, not production.

Styles live in `styles/`, assembled by `styles/main.css`:
`tokens/` (primitives + semantic), `base/` (reset, elements), `layouts/`
(screen, carousel), `components/` (button, card, sheet).

On a snap, `capture.html` captures the frame to a canvas, downscales it (long
edge 1568px) to a base64 JPEG, and POSTs it with the GPS coordinates to
`/api/identify`.

## Backend: api/identify.js

A Vercel serverless function. Receives `POST { image (base64 jpeg), lat, lng }`
and:
1. Calls the Claude API (model in the `MODEL` constant, currently
   `claude-sonnet-4-6`) with the image plus a GPS hint. Uses **tool use /
   structured output** — the model is forced to call a `report_landmarks` tool
   whose schema is the data contract, so the response is validated structured
   data, not free text to parse. (We previously hit repeated bugs parsing free
   text; tool use eliminated that class of bug.)
2. For each landmark with a `wikipediaTitle`, enriches it with photos from the
   **Wikimedia API** (keyless; we send a User-Agent header as etiquette): the
   article's lead image plus a filtered gallery of real photographs.
3. Returns `{ landmarks: [{ name, description, wikipediaTitle, photos }] }`.

Behavior contract: 200 with an array (empty = nothing confidently identified),
500 on genuine errors (so real failures show up in the Vercel logs). Photo
lookups are failure-soft — one failing lookup yields `photos: []` for that
landmark without sinking the rest.

### lib/identify-logic.js

The pure logic — the bug-prone decision-making — is extracted into
`lib/identify-logic.js`: a module that imports nothing and has no network or
side effects (URL/filename parsing, the photo filter, dedupe/cap, the GPS hint,
reading the tool-use result). `api/identify.js` imports these and keeps only
the thin fetch wrappers and the request handler. Two reasons it lives in `lib/`
not `api/`: Vercel routes every file under `api/` (a helper or test there would
deploy as a broken endpoint), and keeping it import-free means the tests run
with nothing installed.

## Testing

- Node's built-in runner: `node:test` + `node:assert`. Zero dependencies.
- `npm test` runs them (`node --test`). Tests live in `lib/*.test.js`.
- Only the pure logic in `lib/` is unit-tested; the network calls themselves
  aren't (that's verified by testing the deployed function on the phone).
- Convention: when we fix a bug in the pure logic, add a regression test that
  would have caught it. (Example: the blocklist bug where the photo filter
  matched "wikimedia" in the host URL and rejected every real photo — now has a
  test asserting a real upload.wikimedia.org photo is kept.)

## Environment & deploy

- The Claude API key is set as the `ANTHROPIC_API_KEY` environment variable in
  the Vercel dashboard (never in the repo or sent to the browser). The
  serverless function reads it via `process.env.ANTHROPIC_API_KEY`.
- The function only works **deployed**: it needs the env var and the Vercel
  runtime, and the camera/GPS need HTTPS. It can't be run or tested on
  localhost — localhost snaps fall through to the empty state.
- Deploy flow: push to `main` → Vercel auto-deploys → test on the phone over
  HTTPS. The deployed URL is the only place the full flow works.
- `.gitignore` excludes `node_modules/` and `.DS_Store`. `.vercelignore`
  excludes `*.test.js` so tests aren't deployed.

## Design system

Before adding a screen, know these conventions (the styles live in `styles/`,
assembled by `styles/main.css`: `tokens/`, `base/`, `layouts/`, `components/`):

- Dark theme only. There is no light or paper variant — don't introduce one.
- Two token tiers: `tokens/primitives.css` (raw values — colours, space, type
  scale, radius) and `tokens/semantic.css` (named roles mapping to primitives,
  e.g. surface/ink/accent). Use semantic tokens in components.
- Don't invent new tokens without justification. Reach for an existing token
  first; add one only when nothing fits, and say why.
- Buttons use a liquid-glass treatment (`components/button.css`): `primary` and
  `ghost` variants, built with an SVG displacement filter for the glass
  refraction plus a backdrop-blur fallback for iOS Safari (which doesn't render
  the filter reliably). Sizes sm/md/lg; `data-shape="circle"` for round
  icon/text buttons.
- Screens use the bottom-actions pattern (`layouts/screen.css`): a centered
  primary circular action with secondary actions beside it (e.g. a ghost close
  to the left, share to the right). Page content sits above it.
- `styleguide.html` is the living reference for the design system. When you add
  a new component or token, add it to `styleguide.html` in the same change, so
  the reference stays current and doesn't go stale as the app grows. (It's an
  internal working page, not linked publicly; `docs/design-system.md` is the
  written companion.)

## Assets

App icons live in `assets/`, all derived from a single 1024x1024 master
designed in Figma (`assets/icon-1024.png` — the master, not referenced by the
web):

- `favicon-16.png`, `favicon-32.png` — the browser-tab favicon.
- `apple-touch-icon.png` (180x180) — the iOS home-screen icon.
- `icon-192.png`, `icon-512.png` — exported for a future web app manifest
  (Android/Chrome install icon), which is NOT wired up yet. They're
  intentionally present, not dead files; adding the manifest is a deferred,
  one-step follow-up.

## Page conventions

When creating a new HTML page in this project:

- In `<head>`, include `<meta name="robots" content="noindex">`. Every page
  carries it so the site stays out of search results (paired with a permissive
  `robots.txt` that allows crawling so the tag is actually seen). A new page
  without it would silently become indexable.
- In `<head>`, include the icon link tags (favicon + apple-touch-icon):
  ```
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  ```
- At the bottom of `<body>`, include these site-wide scripts:
  1. The Vercel Analytics script: `<script defer src="/_vercel/insights/script.js"></script>`
  2. Any other site-wide scripts added in the future.

This is the current solution for shared snippets in a plain-HTML-no-build-step
project. As the project grows, we may migrate to a templating tool to handle
this automatically.

## How to work with me

- I read code comfortably but write it less so, so favor explanation and don't
  assume modern-JS fluency.
- Explain code when you write it. Walk through what each piece does in terms a
  beginner with an HTML/CSS background can follow.
- Do not accept code I cannot read back. If I ask "what does this do" and I
  still seem unclear, explain it again differently. Try a new angle or analogy,
  not the same words.
- Write in plain, direct prose. No em dashes. No filler.
- Ask before installing packages or running anything that changes the
  environment.

## Commits

- Make small commits, one meaningful change at a time.
- Use clear, imperative commit messages. "Add header", "Fix button alignment".
  Not "Added the header".
- Commit after each meaningful change rather than batching.
- Do not include Co-Authored-By trailers. Commit as me only.
- Show the proposed commit message before running anything. That's the moment
  to push back. After approval, `git add` and `git commit` may be run together
  as one step.
- `git push` always needs its own separate approval. It is effectively
  irreversible.
- Read-only inspection (`git status`, `git diff`, `git log`) does not need
  approval.
