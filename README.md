# Kettle Hill

A cozy 3D exploration prototype about a tea house above the sea.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Controls

Start the exploration prototype with:

```text
/?play=1
```

- `WASD` or arrow keys: walk
- Click the canvas: capture the mouse
- Move the mouse: orbit the camera
- `R`: reset the camera behind the player
- `Shift`: sprint
- Tap/drag on a touch screen: move; tap: interact placeholder

The default page is a cinematic style-test view. Useful style-test parameters:

- `?day=0.27` dawn
- `?day=0.5` noon
- `?day=0.745&cam=sea` dusk
- `?day=0.95` night
- `?cam=aerial` island overview
- `?q=low` lower graphics load

## Checks

```bash
npm run typecheck
npm run build
node scripts/playtest.mjs
node scripts/shots.mjs docs/shots
```

The build is a single self-contained `dist/index.html`. The generated screenshots are review artifacts, not game source.

## Project direction

The current milestone is the 3D style test plus the first behind-player movement prototype. The next development slice is to improve the playable camera framing and add the first interactive tea-house destination before expanding into gathering and brewing.


## Next milestone

See [VISUAL_UPGRADE_PLAN.md](VISUAL_UPGRADE_PLAN.md) for the authored world-expansion and visual-upgrade roadmap.
