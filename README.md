# Rainy Stay

A quiet, photographic rainy-room experience. Four real camera compositions show one coherent forest lodge: bed, window, sofa and tea table. This is a deliberate viewpoint-based experience, not a free-walking 3D simulation.

## Run locally

No runtime packages, build step, accounts, or external asset hosts are required.

- `npm run dev` serves this folder at http://localhost:4173 (Python 3).
- Open the page through HTTP; ES modules are not intended to run from a file URL.
- `npm run check` checks JavaScript syntax.
- `npm test` runs geometry/asset invariants, modeled app-state regressions and stubbed-Web-Audio tests.
- `node tests/audio-browser-test.cjs` is an optional native Chromium audio smoke test if Playwright and Chromium are available. It is not a physical iPhone test.

## Experience

- Choose a place in the bottom navigation, or use Left/Right arrow keys.
- Drag the room horizontally to look around the crop on a portrait screen. The position stays where you leave it and is remembered separately per place.
- Touch the small points attached to real objects: lamp, TV, curtain, mug and duvet.
- The duvet action crossfades a matched photographic state. Steam begins at the cup rim. Rain is clipped to the glass, excluding window frames and furniture.
- The TV contains a small, original animated night landscape. Its on/off state also controls the TV audio path.
- “그냥 쉬기” hides the interface. The return control and Escape restore it; hidden controls are inert.
- Reduced-motion preferences disable moving rain/steam and animated transitions.

## Sound

Sound starts only after a click/tap. A single Web Audio context mixes three independent long rain textures, stochastic drops, and an original evolving ambient TV score. Viewpoint changes adjust distance, stereo direction and filtering; sliders control rain, TV and master volume.

The iPhone playback-session hint (`navigator.audioSession.type = 'playback'`) is preserved. Backgrounding or interruptions pause sound, and returning requires another tap. This avoids unexpected audio when changing tabs. A browser’s silent-switch/output behavior must be tested on a real device; desktop emulation cannot prove it.

## Assets and implementation

- `assets/*.webp`: original AI-generated photographic scene assets, approximately 1.4 MB total.
- `assets/provenance.json`, `prompts.json`: generation/encoding provenance.
- `assets/scenes.json`: measured source-image coordinates.
- `assets/scene-masks.js`: production masks and actions.
- `scenes.js`: place copy and shared cover/pan geometry.
- `app.js`: navigation, real controls and restrained canvas atmosphere.
- `audio.js`: original synthesized sound engine. No audio recordings or third-party footage.

Coordinates are normalized to the source image and pass through the same cover/pan transform as the photograph, keeping physical effects anchored across viewport sizes. AI-generated views can contain small texture/prop variations; this is a crafted photographic viewpoint experience rather than a geometrically exact 3D room.

## Verification boundary

The local staging pass ran syntax checks, image inspection, asset/geometry tests and mocked audio lifecycle tests. Native Chromium launching was blocked by the execution environment’s socket restriction; the supported cloud browser also could not access localhost. Those checks do not establish browser rendering, touch interaction or audible quality. Complete the review in an authorized hosted preview, then check an actual iPhone before claiming iPhone playback is verified.

Hosted-preview checklist:
- 390×844, 320×568, 844×390 and desktop layout; no clipped controls.
- Four scenes; fast repeated navigation; Back/Forward; resize and portrait panning.
- Bed → window → bed → duvet; TV screen/audio toggle; mug steam anchoring.
- Enter/exit rest mode, keyboard focus and resumed hotspot accessibility.
- Sound start, stop, sliders, interruption, background/return, and explicit resume.
- Reduced motion, failed asset loading, and retry.
