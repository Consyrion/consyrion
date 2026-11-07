# Consyrion – futuristic glassmorphism design system

Implements issue #67 within the master brief #58. Style decisions here override older mockups (#13–#16, #35);
functional behaviour of the screens #37–#46 is unchanged.

## Principles

- **Serious tool first.** Futuristic intelligence lab + premium enterprise SaaS. Glow marks state (active,
  running, selected) – it is never decoration on dense content. Code, debates, tables and reports sit on quiet
  panels (`glass-quiet`).
- **Truthful UI.** Every number on the dashboard comes from the workspace (projects, sessions, token usage,
  provider key status, database reachability). Fixtures exist only in the component gallery and carry a
  “Demo data” badge. Nodes of the council network pulse only while a real request is in flight; the landing
  hero is captioned “Illustration of a council session – not live data”.
- **BYOK only** (#30): the landing page and dashboard state that users pay providers directly and Consyrion
  sells no AI credits.
- **Motion is optional.** Everything is readable and usable without animation.

## Sources and licence review

| Reference                                                                                                                             | Used for                                                                     | Licence check (26 Oct 2026)                                     | Decision                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Owner's reference screenshot (“Glassmorphism Dashboard UI”)                                                                           | Mood: ink navy, frosted panels, cyan/emerald/violet/magenta accents, ribbons | Third-party brand, not ours                                     | Visual language only. No brand, copy, logo, layout or chart data copied. The screenshot is not in the repo. |
| [React Bits – Electric Logo](https://reactbits.dev/animations/electric-logo) ([source](https://github.com/DavidHDev/react-bits))      | Idea of electric sparks running along a logo outline                         | MIT + Commons Clause; component is WebGL (`ogl`, ~36 KB source) | Not imported. Original SVG/CSS implementation (`ElectricLogo`) – no third-party code, no extra dependency.  |
| [Velocity Dashboard](https://ai-develops.github.io/velocity-dashboard/) ([source](https://github.com/AI-Develops/velocity-dashboard)) | Soft animated grid, neon accents, sidebar structure                          | Repository has **no licence** (all rights reserved)             | Inspiration only; nothing copied.                                                                           |

No images, fonts or other assets from third parties are included. All brand assets are generated from
`src/components/brand/geometry.ts`.

## Brand

- **Mark:** an open council ring shaped like a “C” with seven nodes (the seven canonical phases), a verdict
  node in the centre and an execution line leaving the ring through its opening (decision → build).
- **Wordmark:** `CONSYRION` in the display face, letter-spaced, kept as live text.
- **Assets:** `apps/web/src/app/icon.svg` (favicon), `apps/web/public/brand/consyrion-mark.svg`,
  `apps/web/public/brand/consyrion-logo.svg`. Regenerate with `node scripts/brand-assets.ts` (in `apps/web`);
  a test fails if they drift from the geometry.
- **Electric Logo** (`ElectricLogo`): dashed bright strokes travel along the ring (`stroke-dashoffset`
  keyframes with a seamless whole-period travel), an animated `feTurbulence` + `feDisplacementMap` filter
  makes them crackle, a blurred halo adds glow. Modes: `ambient` (hero), `intro` (one 2.6 s run, then on
  hover/focus – navbar/sidebar), `hover` (footer, gallery).
- **Electric Lockup** (`ElectricLockup`, mark + CONSYRION name) on the home hero and the sign-in/sign-up/
  invitation pages, closest to the React Bits reference: the letters and the mark are drawn as a lit outline
  (dark body, gradient halo with a gentle flicker, crackling core via animated turbulence) and short
  lightning arcs leap off the edges (midpoint-displacement bolts sampled from the ring path and the
  text bounds, ≤ 4 at a time, ~11 updates/s). Server render, reduced motion and hidden tabs show the static
  glowing outline without arcs.

## Tokens (`apps/web/src/app/globals.css`)

| Token                        | Dark (default, also on a light OS)               | Light (theme toggle only) | Role                  |
| ---------------------------- | ------------------------------------------------ | ------------------------- | --------------------- |
| `--bg` / `--bg-2`            | `#060B15` / `#09111F`                            | `#F4F7FC` / `#EAF0F9`     | page background       |
| `--surface` / `--surface-2`  | `#101A2B` / `#162236`                            | `#FFFFFF` / `#EEF2FA`     | panels, inputs        |
| `--glass` / `--glass-line`   | `rgb(16 26 43 / .62)` / `rgb(148 186 255 / .14)` | white 72 % / navy 12 %    | frosted panels        |
| `--primary`                  | `#00D8FF` electric cyan                          | `#0369A1`                 | actions, active state |
| `--success`                  | `#24E0B5` mint/emerald                           | `#047857`                 | completed, verified   |
| `--accent` / `--accent-text` | `#8B5CF6` / `#B9A2FF` violet                     | `#6D28D9`                 | secondary emphasis    |
| `--magenta`                  | `#D946EF`                                        | `#A21CAF`                 | selective sparks only |
| `--warning` / `--danger`     | `#FBBF24` / `#FF7A8A`                            | `#92400E` / `#B91C1C`     | states                |
| `--text` / `--muted`         | `#E8EEFC` / `#9AA9C6`                            | `#0B1220` / `#4A5675`     | text                  |

Utilities: `glass`, `glass-quiet`, `neon-ring`, `neon-ring-violet`, `text-gradient`. Radii 12–16 px,
1 px translucent borders, one shadow elevation. Numbers use tabular figures.

**Contrast:** `src/lib/design-tokens.test.ts` checks every text role (text, muted, primary, success, warning,
danger, accent-text) on every opaque surface in both themes for WCAG AA (≥ 4.5:1). It caught the light-mode
warning colour (4.38:1), which was darkened to `#92400E`.

**Fonts:** system stacks only (no web-font download): body `ui-sans-serif, -apple-system, Segoe UI, Inter…`,
display `Avenir Next, Segoe UI Variable Display…`.

## Components (`apps/web/src/components`)

| Component                            | File                             | Notes                                                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConsyrionMark`, `ConsyrionWordmark` | `brand/consyrion-logo.tsx`       | static, server-safe, accessible name or decorative                                                                                                                                                                                          |
| `ElectricLockup`                     | `brand/electric-lockup.tsx`      | client; logo + name as electric outline with leaping arcs                                                                                                                                                                                   |
| `ElectricLogo`                       | `brand/electric-logo.tsx`        | client; static until hydrated, off for reduced motion / hidden tab                                                                                                                                                                          |
| `GlassPanel`, `NeonBorder`           | `ui/glass.tsx`                   | `Card` and `EmptyState` use the same surfaces, so every screen (#37–#46) inherits the style                                                                                                                                                 |
| `AmbientBackground`                  | `fx/ambient-background.tsx`      | light fields, drifting grid, canvas ribbons                                                                                                                                                                                                 |
| `SidebarNav`                         | `app-shell.tsx`                  | glass sidebar, logo, cyan active item, avatar initials                                                                                                                                                                                      |
| `LiveMetricCard`, `Sparkline`        | `dashboard/live-metric-card.tsx` | `demo` badge, `live` dot only for running values                                                                                                                                                                                            |
| `WorkflowStepper`, `stepStatesFor`   | `dashboard/workflow-stepper.tsx` | seven phases, states derived from real session phase/status                                                                                                                                                                                 |
| `CouncilNetwork`                     | `dashboard/council-network.tsx`  | used in Independent Thinking (#39) with real participant states; nodes float gently (links follow), lean towards a nearby pointer and grow under it, the centre swells under it; pulses only for working models; static with reduced motion |
| `LandingPage`, `HeroCouncil`         | `landing/`                       | public home at `/`                                                                                                                                                                                                                          |
| `AuthShell`                          | `auth-shell.tsx`                 | sign-in, sign-up, invitation                                                                                                                                                                                                                |

Component gallery: **`/design`** (public, `noindex`, all values demo fixtures).

## Animation policy

- Decorative motion: ambient ribbons (24 fps cap, device-pixel ratio ≤ 1.5), grid drift (48 s), Electric
  Logo, hero phase walk-through (2.4 s per step).
- State motion: pulse/flow on council nodes only while a request is running; “Live” dot only when sessions run.
- `prefers-reduced-motion: reduce` → global CSS rule disables all animations; `ElectricLogo`, `HeroCouncil`
  and `AmbientBackground` render a single still frame.
- Hidden tab (`visibilitychange`) or off-screen canvas (`IntersectionObserver`) → animation stops.
- Server render is always the static variant (no hydration mismatch, logo visible without JS).
- No video, no WebGL, no flashing: nothing changes brightness faster than 3×/s at full contrast.

## UI states

| State                    | Treatment                                            |
| ------------------------ | ---------------------------------------------------- |
| Empty                    | `EmptyState` (quiet dashed glass) with a next action |
| Loading                  | quiet panel with skeleton bars, `aria-busy`          |
| Error                    | `Alert` danger (role alert)                          |
| Warning / low confidence | `Alert` warning (role status)                        |
| Success                  | `Alert` success                                      |
| Running                  | cyan `neon-ring` step, pulsing node, “Live” dot      |
| Failed                   | danger step/node, failure reason shown               |
| Offline / database down  | dashboard “System” card shows “unavailable”          |
| Focus                    | 2 px `--focus` outline on every interactive element  |

## Screens

| Screen                         | Change                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Landing `/`                    | new: electric logo in navbar, electric logo + name lockup in the hero, “Debate. Decide. Deliver.”, CTAs (Start a Decision → `/projects/new`, See How It Works → `#how`, Connect Your AI Keys → `/settings/providers`), seven stages, human gate, BYOK, GitHub build flow |
| Sign-in / sign-up / invitation | `AuthShell`: ambient background, brand panel with ambient Electric Logo (desktop), neon-bordered glass card; email/password, Google and GitHub buttons unchanged                                                                                                         |
| Dashboard (workspace overview) | real metrics, recent sessions with stepper + token budget bar, provider key status, system status                                                                                                                                                                        |
| #37–#46                        | inherit glass cards, buttons, badges and sidebar; #39 Independent Thinking adds the council network                                                                                                                                                                      |

Not implemented (no backend yet, so no fake UI): global search, worker health beyond database reachability.

## Verification (26 Oct 2026)

| Check                 | Command / method                                                      | Result                                                                      |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Unit/component tests  | `pnpm --filter @consyrion/web test`                                   | 81 passed (59 token contrast + motion policy, 17 design-system, 5 existing) |
| Whole repo tests      | `pnpm -r test`                                                        | 214 passed, 1 skipped (Docker sandbox test, runs in CI)                     |
| Typecheck / lint      | `pnpm -r typecheck`, `pnpm lint`                                      | clean                                                                       |
| Production build      | `pnpm --filter @consyrion/web build`                                  | succeeds; `/design`, `/icon.svg` static                                     |
| Browser, no JS errors | Playwright (Chromium) on `/`, `/design`, `/sign-in`, desktop + mobile | 0 page errors                                                               |
| Reduced motion        | Playwright `reducedMotion: "reduce"`                                  | Electric Logo off on all instances                                          |
| Keyboard              | Tab through landing                                                   | skip link first, visible focus outline on every stop                        |
| Basic a11y            | one `h1`, named images/links, no horizontal overflow at 360 px        | pass                                                                        |

## Previews (`docs/design/previews/`, real screenshots of the running app)

- `landing-desktop.jpg`, `landing-mobile.jpg`, `landing-desktop-reduced-motion.jpg`
- `design-gallery-desktop.jpg`, `design-gallery-mobile.jpg`
- `dashboard-mobile-empty-workspace.jpg` (fresh local test workspace)
- `sidebar-mobile-open.jpg`, `sign-in-desktop.jpg`, `sign-in-mobile.jpg`, `sign-up-desktop.jpg`, `sign-up-mobile.jpg`

## Version 2 – design concepts from #67/#71 (26 Oct 2026)

Concept images supplied by the owner (sample data, kept as references only – not used as UI backgrounds):
`docs/design/concepts/concept-dashboard.jpg`, `concept-council-room.jpg`, `concept-mobile.jpg`.

| Area                             | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in (#67 comment “Planeten”) | `ConsyrionOrbitalLogo` (`components/brand/orbital-logo.tsx`): original mark as the sun, three spheres (cyan/mint/violet) on tilted ellipses, orbits 28/38/52 s with start phases 0/120/240°, surface rotation 12/17/23 s on a separate clipped layer under fixed lighting, spheres pass in front of and behind the mark. requestAnimationFrame writes SVG attributes (no React state per frame), ~40 fps cap; pauses for hidden tab, off-screen element and the Pause button; reduced motion = static, distributed frame. `aria-hidden`; brand name stays as text. Form unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Dashboard (concept 1)            | Icon sidebar (`components/ui/icons.tsx`), content up to 1680 px, four metric links, council activity network (`dashboard/activity-network.tsx`: always alive – nodes tremble in place, small discharges crackle along the links and around the rings, sparks travel to the centre, all stronger for working models; nodes lean towards a nearby mouse pointer and crackle when it comes close, the hexagon swells and glows brighter under it and draws more current through every link (shared helper `dashboard/pointer-field.ts`); only working links carry the flow dashes; hover, focus or tap on a model opens a card with its real figures – state, full model id, requests, failed requests, input/output tokens, perspectives, failure reason; paused off-screen and in hidden tabs, static with reduced motion), “Your next action” (first in DOM/mobile), provider key status, recent sessions table (providers, stage, status, token budget, updated), decision process stepper. All values from the workspace. |
| Council Room (concept 2)         | New first session tab (`session/council-room.tsx`): independent voices network (models = votes, perspectives = roles) with an HTML list for screen readers/mobile, objections & evidence with topic filter, proposal cards (score / recommended once evaluated, hidden before the reveal), approval banner. Phase tabs keep the detailed screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Mobile (concept 3)               | Bottom navigation Home/Projects/Decisions/Settings (menu keeps the rest), next action before other panels, compact council list instead of the large network, horizontally scrolling phase tabs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Not copied on purpose            | Search field and “Healthy/Online” provider labels from the images (no backing data – the dashboard shows verified key checks instead); separate “reserved” token meter (the server reports one counter that includes reservations while running).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Verification (local): web tests 87 passed (incl. orbital logo, activity network, voice states); smoke test of 56 page/theme/viewport combinations without errors, overflow, broken links or low-contrast text (it caught the violet badge text, fixed with `--accent-text`); screenshots and a 7 s animation recording in `docs/design/previews/v2/` (`sign-in-orbital.webm`). Data in the dashboard/council screenshots is a local test workspace with a clearly labelled DEMO session from scripted test models.

## v3 – Sign-in stage after the design concept (PR #78)

References: the design concept image (headline, core with spokes, three marbled spheres, feature row, glass
form) and a Gemini clip (silk light ribbons, sphere motion). PR #77 proposed an MP4 loop; the page draws the
look live instead, so it stays sharp, loops without a seam and ships no video file.

- **Always-dark stage**: `.stage-dark` in `globals.css` scopes the dark tokens to the auth subtree, so sign-in,
  sign-up and invitations look the same in both themes.
- **`RibbonField`** (`components/fx/ribbon-field.tsx`): one fixed full-page canvas – four bundles of 28-strand
  silk ribbons sweeping across the page, 240 particles riding them, a seeded star field. Max 30 fps, stops when
  the tab is hidden, one still frame for reduced motion, calmer below 768 px.
- **Sign-in/sign-up since 06.11.26: `AuthScene`** (`components/auth-scene.tsx`): the first chapter of the landing page's
  3D scene (`createStoryScene(canvas, { framing: "center", stars: false })`) – same spheres, model names, plasma core
  and pointer reaction as the landing page; Pause button; reduced motion = still frame. `ConsyrionOrbitalLogo` below
  stays as the fallback without WebGL 2.
- **`ConsyrionOrbitalLogo`** (`components/brand/orbital-logo.tsx`, #84): the original mark as the sun in a glowing
  core; three spheres (cyan, mint, violet) on a slow, continuous, tilted orbit (48 s per turn, `orbitAngle` /
  `orbitState`, tested). On the far side they pass behind the core, on the near side in front of it, and they
  grow when near. Energy spokes link them to the core; pulses run inward. Decorative only, never shown as a
  running council.
- **Real 3D spheres** (`components/brand/orbital-spheres-3d.ts`): three.js (WebGL 2), loaded on demand. Two
  canvases – behind and in front of the SVG core – give real occlusion; an orthographic camera matches the SVG
  view box, so logo and scene keep the same centre at every size. Shader: marbled surface turning on a tilted
  axis, light coming from the logo ("sun") plus a soft fill, specular highlight, fresnel rim and a limited
  additive halo. Pixel ratio capped at 2, render loop paused when hidden, resources disposed on unmount.
- **Fallbacks**: without WebGL the SVG spheres orbit with the same geometry (`data-spheres="svg"`); with reduced
  motion everything is one still frame and the Pause button is not shown. The server render is always the SVG.
- **Mobile**: the same single scene, compact above the form (no headline or feature row), no horizontal overflow.
- **Layout**: brand top left, headline "Many perspectives. / One clear decision.", feature row (independent
  perspectives, own keys, build after approval), glass form card up to 600 px with a gradient border.
- **Form**: "Welcome back", 56 px fields with a focus glow, password show/hide (`PasswordField`, aria-pressed),
  gradient sign-in button, Google/GitHub buttons with their logos (accessible names stay "Continue with …").

Previews: `previews/v3/` – 1440 px (`sign-in-dark-1440.png`, orbit frames a/c, `sign-in-error.png`,
`sign-in-reduced-motion.png`, `sign-in-no-webgl.png`), 390 px (`sign-in-mobile-390.png`) and the recording
`sign-in-orbit.webm`. Before: `previews/v2/sign-in-desktop.jpg`, `sign-in-mobile.jpg`.

## Homepage scroll story (#85)

The public homepage explains the whole process as one scroll-driven 3D scene – storyboard, technique and
verification in [homepage-story.md](homepage-story.md).

## Design follow-ups #79–#83 (dashboard, Council Room, mobile)

Built after the concept images in #71 with real data only; examples come from the labelled DEMO session.

- **App shell**: large mark + wordmark, neon active state, six main entries (Dashboard, Projects, Decisions, AI
  providers, Integrations, Settings – the settings pages share tabs in `settings/layout.tsx`), workspace card and
  a compact user row. The sidebar always uses the dark tokens (`stage-dark`), also in the light theme. Mobile:
  header with menu button, bottom navigation with an active bar.
- **Dashboard (#82)**: tinted metric cards; the main visualisation and the next action are the only highlighted
  panels (cyan contour, limited glow); the next action is a real primary button. No search field – the concept
  draws one, the product has no search yet.
- **Council network (#79)**: `ActivityNetwork` – nebula, silk ribbons per model (only the core strand moves while
  a request is in flight), lit nodes with provider glyphs and worded states, original mark in the hexagon.
- **Council Room (#79/#80)**: `VoicesNetwork` – original mark in a lit core, lit model nodes with a worded status
  chip, arcs between the models, four role chips per model with a status dot and a connector; long role names
  are shortened only beyond 30 characters (full text in `<title>` and in the list). Below 1600 px the network
  spans the full width so chips stay readable; objections follow in two columns.
  Every model floats gently in place and leans towards a nearby mouse pointer, growing and glowing brighter
  under it; the core does the same. Paused off-screen and in hidden tabs, static with reduced motion.
- **Empty state (#81)**: `EmptyCouncil` – original mark with dashed, inactive orbits and empty slots (no model
  state, no motion) and the real next setup step (keys → project → council).
- **Mobile (#83)**: "Your council", full-width start button, two key numbers first, next action at ~350 px, the
  compact `LiveCouncilCompact` card (brand core, lettered models, states in text, token use), then the other two
  numbers, providers and session cards. Council Room: `CompactNetwork` plus model cards with expandable roles.
- Fixed on the way: the phase tab bar let its screen-reader texts widen the page at 360 px (now `relative`).

Previews (1440 × 900 and 390 × 844, same DEMO data): `previews/followups/before-*.jpg` and `after-*.jpg`.
