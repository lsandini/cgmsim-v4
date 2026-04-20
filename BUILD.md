# Build Guide

## Setup (once)

```bash
npm install
```

## Development (live reload)

```bash
npm run dev
```

Opens at http://localhost:5173. Edits to any `.ts` file hot-reload automatically.

## Build the standalone HTML

```bash
cd packages/ui && npm run build:standalone
```

Output: `packages/ui/dist/cgmsim-v4-standalone.html` — open directly in any browser, no server needed.

## Where to edit

| Area | File |
|------|------|
| Simulation physics | `packages/simulator/src/` (deltaBG, insulinProfiles, carbs, egp, iob, pid, g6Noise) |
| Canvas rendering | `packages/ui/src/canvas-renderer.ts` |
| UI logic (buttons, panels) | `packages/ui/src/main.ts` |
| HTML layout and CSS | `packages/ui/index.html` |
| Type definitions | `packages/shared/src/index.ts` |

## Other commands

```bash
npm run typecheck   # Type-check all packages
npm run test        # Unit tests (packages/simulator)
```
