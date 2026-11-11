# Homepage – scroll story (issue #85)

The public homepage explains the whole Consyrium process as one continuous 3D scene that changes with the
scroll position. The text of every chapter is semantic HTML outside the canvas; the scene is decorative
(`aria-hidden`) and labelled "Illustration – not live data". Nothing on the page starts an AI call, a build or a
GitHub action.

## How it works

- **One scene, one canvas** (`components/landing/story-scene.ts`, three.js, loaded on demand) sits in a sticky
  stage behind the chapters. Desktop: chapters on the left, scene shifted right (`setViewOffset`). Mobile: scene
  in the upper part, chapter card at the bottom, fewer stars and lower pixel ratio.
- **Chapter cards** are frosted glass: `rgb(6 12 26 / 0.6)` with `backdrop-blur-md`, so the light streams stay
  visible behind the text while the blur keeps it readable (raised from 0.82 on 27 Oct 2026).
- **Scroll → progress**: `components/landing/process-story.tsx` turns the chapter under the middle of the
  viewport into a progress value `chapter + fraction`. Each chapter holds its scene for the first 45 % and then
  blends to the next (`components/landing/story-timeline.ts`, tested). Native scrolling only – no scroll
  jacking, no forced playback; wheel, touch, keyboard and scrolling back work as usual.
- **Chapter navigation**: anchor links (`#prepare`, `#independent-thinking`, …) in a rail (desktop) and a chip
  row (mobile); the active chapter is marked with `aria-current`.
- **Motion**: idle motion (orbit, surfaces, pulses) can be paused; the render loop stops when the tab or the
  stage is hidden; pixel ratio ≤ 1.75; all GPU resources are disposed on unmount.
- **Fallback**: reduced motion, no WebGL 2 or a load error → the same chapters as a static, numbered process
  story without the canvas.
- **Libraries**: three.js only (already used by the sign-in scene, #84). GSAP/ScrollTrigger and Motion were
  checked and not added – the scroll mapping is a few lines and needs no extra runtime.

## Storyboard

| #   | Chapter (anchor)                               | Scene                                                                                            | Text (summary)                                                                                     | Transition to next                                             |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 0   | Intro (`#top`)                                 | Original C mark in a glass core, three lit model spheres orbiting slowly, stars                  | Debate. Decide. Deliver. – what Consyrium does; CTAs                                               | Spheres leave the orbit and take their places; a brief appears |
| 1   | Preparation (`#prepare`)                       | Brief card in front of the core; a "your key" chip under every model; budget bar                 | Project, question, models, perspectives, own provider keys, hard budget; no AI credits             | Brief copies fly to the models                                 |
| 2   | Independent Thinking (`#independent-thinking`) | Each model inside a sealed bubble with its own hidden proposal                                   | Same brief, independent work, sealed until all are in                                              | Bubbles open                                                   |
| 3   | Open Council (`#open-council`)                 | Proposals A, B, C side by side in front; question pulses between the models                      | Reveal at once, equal footing, compare alternatives                                                | Proposals return to their models                               |
| 4   | 12 Minds Council (`#twelve-minds`)             | Four role satellites per model (architecture, security, cost, critic, …)                         | Roles test every proposal; 12 perspectives ≠ 12 models                                             | One satellite turns amber                                      |
| 5   | Minority Review (`#minority-review`)           | Highlighted security objection linked to two evidence chips; camera moves closer                 | Dissent checked against evidence and kept on record                                                | Objection resolves into the proposals                          |
| 6   | Consensus Round (`#consensus-round`)           | A and C move together into "Hybrid A + C"; B stays with a documented difference                  | Revisions, hybrid option, open differences stay                                                    | Report assembles in the centre                                 |
| 7   | Final Verdict (`#final-verdict`)               | Decision report: recommendation, scores, evidence, minority position                             | Reproducible verdict; nothing happens yet                                                          | A gate ring appears in front of the report                     |
| 8   | Human approval (`#approval`)                   | Amber gate "Awaiting your approval" turns green "Approved by you" while scrolling                | You decide: approve, alternative, more debate, reject; critical security objection blocks approval | Report becomes a plan                                          |
| 9   | Execution Council (`#build`)                   | Pipeline: tasks → code in sandbox → tests → reviews → draft PR, with a flowing line; camera pans | Optional build after approval; GitHub draft PR; merge and deploy stay your decisions               | Camera pulls back                                              |
| 10  | Closing (`#start`)                             | Whole path at once: core, models, report, pipeline                                               | From your question to a reasoned decision – optionally to reviewed code; BYOK; CTAs                | –                                                              |

All numbers, names and results in the scene are illustrative and labelled as such.

## Verification (26.10.2026, local, Chromium via Playwright)

- 1440 × 900: every chapter screenshotted (`previews/homepage/desktop-00-top.jpg` … `desktop-10-start.jpg`);
  scrolling down to "Start" and back to "Intro" updates the active chapter; keyboard: focusing the chapter link
  "Minority Review" and pressing Enter jumps there (`#minority-review`), PageDown continues; deep link `#approval`
  opens the approval scene; Pause sets `aria-pressed`; "Start a Decision" leads to sign-in when signed out.
- 390 × 844 with touch: touch scrolling moves through the chapters, no horizontal overflow
  (`previews/homepage/mobile-*.jpg`).
- Reduced motion and WebGL disabled: static story with all 11 chapters, no canvas
  (`previews/homepage/static-reduced-motion.jpg`).
- No page or console errors in these runs. Recording of the whole scroll story:
  `previews/homepage/homepage-scroll-story.webm`. Before: `previews/v2/landing-desktop.jpg`, `landing-mobile.jpg`.
- Not checked: Safari and Firefox, real touch devices, low-end GPUs.

## Polish after the external review (26.10.2026)

- **Mobile header**: signed in, "Start a Decision" was cut off at 390 px. Narrow screens now show "Dashboard"
  and "Start" (accessible name stays "Start a Decision"); checked at 390 and 360 px, signed in and out
  (`previews/homepage/mobile-header-signed-in-390-360.jpg`).
- **Readable labels**: texts in the scene are drawn on top (no depth test), so spheres never cover role labels;
  role labels sit outward from their model; card and pill fonts are larger, ×1.3 on phones.
- **Dramaturgy** – each key moment has its own signature, driven by the scroll position (plays backwards too):
  Open Council – sealed bubbles burst into sparks and the models flare; Minority Review – the rest dims, amber
  spotlight and pulsing ring around the objection; Final Verdict – light rays from every model into the report,
  which shows illustrative score bars; Approval – the gate turns green, "✓ Approved by you" and a ring of light.
  The stage background takes a colour mood per chapter.
- **Running example**: one question – "Which database architecture should our SaaS product use?" – runs through
  every chapter as a marked "Example" (`STORY_CHAPTERS[].example`, tested).
- **Interactive plasma core and wave**: the logo core is a glass plasma ball (own shader, in the style of
  "Crystalized Ball" from React Bits – no code copied) whose filaments bend towards a nearby pointer and light a
  contact spot on the glass; sparks rise around it. The background wave is stronger on the homepage
  (`RibbonField intensity={1.9} interactive`) and bends towards the pointer. Touch releases the pointer when
  lifted; reduced motion keeps the static story.
- Previews: `plasma-core-idle-hover.jpg`, `wave-follows-pointer.jpg`, `plasma-core-interaction.webm`, updated
  chapter screenshots and `homepage-scroll-story.webm`.

## Delivery instead of a mandatory build (#163, 27 Oct 2026)

The tagline is **Debate. Decide. Deliver.** The hero says that the decision goes where the user works (report, own
tools, or – with a connected GitHub repository – a reviewed pull request). The navigation item "Build" became
"Delivery" (`#delivery`): a section "Your decision, where you work" lists the targets from
`components/landing/delivery-targets.ts` with their status (Available / With a connected repository / Planned).
The pull-request pipeline stays as "Optional: from verdict to pull request"; Phase 7 is labelled "optional, with
GitHub". Update a target's status in the PR that ships it.

## Polish of 11 Nov 2026 (live check of the renamed site)

- The core's caption ("Decision") steps aside in the chapters where a card stands in front of the core (brief, proposal B,
  hybrid) – it showed half-covered before.
- 12 Minds: a role label above its model slides beside its dot instead of rising into the model's name.
- The page ribbons (`RibbonField`, `calmBelow="overview"`) ease down to about a third once the reading sections below the
  scroll story are on screen, so strands no longer run through card text.
- Dashboard activity network: the layout follows the number of models (`slotsFor`): alternately left and right, evenly
  spread, texts on the outer side; two slow orbits around the decision and twinkling stars (off with reduced motion).
  Demo fixtures for three and six models are in the gallery at `/design`.
