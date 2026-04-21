# CGMSIM v4

Standalone browser-based glycaemic teaching simulator for diabetes education sessions. Fourth generation of the CGMSIM platform (cgmsim.com). NOT clinical software — generates only synthetic data for teaching.

## Project structure

npm workspaces monorepo:

- `packages/simulator/` — Physiological engine: deltaBG, insulin PD profiles, carb absorption, IOB/COB, PID controller, G6 noise model. No browser dependencies; unit-testable in Node.
- `packages/ui/` — Vite SPA: Canvas renderer, instructor panel, throttle control, IndexedDB persistence. Vanilla TypeScript (no React).
- `packages/shared/` — TypeScript type definitions only (message types, patient/therapy interfaces). No runtime code.
- `cgmsim-v4-standalone.html` — Self-contained single-file build (output of `build:standalone` in packages/ui). This is the primary deliverable for teaching sessions.

## Commands

```bash
npm run dev          # Vite dev server (packages/ui)
npm run build        # Build all packages (shared → simulator → ui)
npm run test         # Vitest unit tests (packages/simulator)
npm run typecheck    # TypeScript strict check across all packages
```

Within packages/ui:
```bash
npm run build:standalone   # Produces the single-file HTML via inline.mjs
```

## Key architecture decisions

- All glucose computations in **mg/dL** internally. mmol/L conversion at display layer only (÷ 18.0182).
- Simulation tick = **1 simulated minute**. One CGM reading per tick. 60 CGM values per simulated hour.
- The simulation engine runs inline (not in a WebWorker) in the standalone build, but uses the same SimulationEngine class.
- PID controller receives the **noisy CGM value**, not true glucose — this is intentional and pedagogically important.
- Two-layer parameter model: patient physiology (ground truth) vs therapy profile (programmed settings). The mismatch between them is what creates teaching scenarios.
- G6 noise model is stateful (AR(2) + Ziggurat RNG). State must be serialized for save/restore and comparison runs.
- Comparison runs use two independent SimulationEngine instances with identical initial state but divergent parameters.

## Physiological model origin

Core functions ported from `@lsandini/cgmsim-lib` (v3 npm package). Nightscout integration removed. The long-term goal is to extract `packages/simulator` as a shared dependency between v3 and v4.

## Development environment

- WSL2 Ubuntu on Windows
- Node.js (check .nvmrc or nvm)
- VS Code with Claude Code

## What NOT to do

- Do not add React or any UI framework — the vanilla TS approach is intentional.
- Do not add server-side dependencies for the core teaching tool (it must work from a single HTML file).
- Do not add real patient data connectors — this is synthetic-only by design and regulatory boundary.
- Do not modify the physiological model without explicit discussion — the model is shared heritage with v3.

## Current state (as of 2026-04-21)

- CGM trace rendered as **dots** (not a line), radius scales with zoom, ATTD zone colours.
- Zoom levels: **3h / 6h / 12h / 24h**. Scroll wheel and pinch snap to these four levels.
- Throttle slider: 9 stops `[×0.25, ×0.5, ×1, ×5, ×10, ×50, ×100, ×600, ×3600]`, default ×10.
- All `TICK_MINUTES` constants in `packages/simulator/src/*.js` are set to **1**. The `.js` files must be kept in sync with the `.ts` sources — Vite resolves the `.js` imports directly (no `.js` stale files in `packages/ui/src/`).

## Upcoming work (next priorities)

1. **Basal profile overlay** — Display the scheduled basal rate as a step-chart on the canvas. Highlight temp basal overrides. In AID mode, show the PID-driven rate.
2. **IOB display rework** — The current blue filled-area overlay needs a more prominent, readable treatment. IOB is the most important teaching variable. COB (orange) is fine as-is.
3. **Math audit** — Go through every simulator function (`deltaBG`, `carbs`, `iob`, `egp`, `pid`, `g6Noise`) and verify formulas match the original `@lsandini/cgmsim-lib` v3. Goal: eventually extract `packages/simulator` as a shared dependency between v3 and v4.
