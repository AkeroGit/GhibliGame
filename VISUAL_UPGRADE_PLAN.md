# Kettle Hill — Visual Upgrade Plan

## Goal

Move Kettle Hill from a polished single-scene prototype to a small, memorable cozy world: a place players want to wander through, photograph, and return to. The game stays original-IP, hand-modelled, Three.js + TypeScript + Vite, with a single-file production build.

## What is weak today

- The tea house is attractive but is still the only meaningful destination.
- The playable world feels smaller than the terrain grid because the paths and landmarks stop early.
- The character is now readable, but still needs stronger silhouette, posing and contextual animation.
- The scene has mood systems (golden hour, flowers, petals, glow), but not enough authored composition or discovery payoff.

## North-star art direction

- **Shape language:** round, hand-built, slightly imperfect silhouettes; no generic primitives as hero objects.
- **Colour:** calm sea/indigo/leaf greens, punctuated by warm windows, vermilion gates and one accent colour per place.
- **Lighting:** warm key + cool fill, visible long shadows, soft cloud shadows, light sources that imply a lived-in world.
- **Composition:** every destination gets a strong silhouette, a path reveal, a framed view, and a small soundless story told by props.
- **Player fantasy:** a tea-keeper walking between beautiful places, collecting ingredients and small moments—not rushing or failing.

## Execution order

### Phase 1 — World expansion vertical slice (in progress)

Add two authored destinations beyond the tea house and connect them with paths:

1. **Bamboo Shrine:** vermilion torii, mossy offering stones, firefly pockets, wind-bent bamboo, and a framed sea view.
2. **Moonbridge Stream:** a hand-built arched footbridge over a shallow stream, stepping stones and a waterwheel.

Acceptance gate: the aerial view clearly shows more than one destination; the player can walk to the first new landmark; each place has a distinct silhouette and a grounded path.

### Phase 2 — Composition and discovery

- Replace the current generic camera presets with reveal shots for the shrine, bridge, cove and tea house.
- Add sightline landmarks: torii on a ridge, bridge glint in a valley, tea-house smoke from a distance.
- Add authored foreground framing and remove repeated grass-card patterns in hero shots.
- Add a clean screenshot mode and keep the player visible only in gameplay shots.

Acceptance gate: each place reads in a five-second screenshot without explanation.

### Phase 3 — Player hero pass

- Refine the tea-keeper proportions, face, hands and idle pose.
- Add contextual animations: greet at the shrine, pause at the bridge, hold a gathered herb, sit at the tea house.
- Add a simple interaction prompt and a first collectible herb loop.

Acceptance gate: the character remains appealing in close-up, gameplay distance and movement.

### Phase 4 — Living world pass

- Add stream animation, bamboo sway, shrine ribbons, birds, butterflies and water reflections.
- Give each place one ambient event: falling bamboo leaves, bridge fireflies, cove foam, tea-house steam.
- Keep all particles seeded and quality-tiered.

Acceptance gate: a still image shows life; a ten-second capture shows gentle change rather than noise.

### Phase 5 — Material and lighting pass

- Add contact darkening under bridge/shrine/props, moss and damp rock variation, and selective tile/wood highlights.
- Tune sunset, noon and night separately; protect shoji readability from bloom.
- Test desktop and low-quality modes before adding density.

Acceptance gate: no floating props, bare rectangles, black foliage, clipped emissives or shader errors.

### Phase 6 — Playable cozy loop

- Walk, gather, brew and serve one tea recipe.
- Add a tiny tea-house journal that records discovered places and ingredients.
- Add optional async letters only after the single-player loop is satisfying; moderation and safety are required for multiplayer.

Acceptance gate: a first-time player can discover a place, gather something, return home and see a visible change.

## Working method

- Implement one destination at a time, not a procedural blob of landmarks.
- Render a dedicated review shot after each destination.
- Run `npx tsc --noEmit`, `npm run build`, `node scripts/shots.mjs docs/shots`, and `node scripts/playtest.mjs` before each milestone commit.
- Commit and push each coherent slice. Never claim visual quality from a successful build alone.
- Use `?q=low` as a fallback; validate frame rate on a real laptop or phone because headless Chromium uses SwiftShader here.

## Current slice

The first implementation is the **Bamboo Shrine** and its connecting path. The bridge follows after the shrine has passed grounding and visual review.
