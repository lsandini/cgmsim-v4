# CGMSIM v4

Standalone browser-based glycaemic teaching simulator for diabetes education sessions. Fourth generation of the CGMSIM platform (cgmsim.com). NOT clinical software — generates only synthetic data for teaching.

## Project structure

npm workspaces monorepo:

- `packages/simulator/` — Physiological engine: deltaBG, insulin PD profiles, carb absorption, IOB/COB, PID controller, G6 noise model. No browser dependencies; unit-testable in Node.
- `packages/ui/` — Vite SPA: Canvas renderer, instructor panel, throttle control, IndexedDB persistence. Vanilla TypeScript (no React).
- `packages/shared/` — TypeScript type definitions only (message types, patient/therapy interfaces). No runtime code.
- `packages/ui/dist/cgmsim-v4-standalone.html` — Self-contained single-file build (output of `build:standalone` in packages/ui). This is the primary deliverable for teaching sessions.

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

- All glucose computations in **mg/dL** internally. mmol/L conversion at display layer only (÷ 18.0182). Default display unit is **mmol/L**.
- Simulation tick = **5 simulated minutes**. One CGM reading per tick. 12 CGM values per simulated hour.
- The simulation engine runs as `InlineSimulator` on the main thread (RAF loop). No WebWorker in the standalone build.
- PID controller receives the **noisy CGM value**, not true glucose — intentional and pedagogically important.
- Two-layer parameter model: patient physiology (ground truth) vs therapy profile (programmed settings). The mismatch between them creates teaching scenarios.
- G6 noise model is stateful (AR(2) + Ziggurat RNG). State must be serialized for save/restore and comparison runs.
- Comparison runs use two independent `InlineSimulator` instances with identical initial state but divergent parameters.
- `ActiveBolus.dia` is stamped at injection time from `TherapyProfile.rapidDia`, so IOB calculations use the controller's programmed DIA, not a hard-coded analogue profile value.
- The `.js` files in `packages/simulator/src/` are the live runtime files resolved directly by Vite. They must be kept manually in sync with the `.ts` sources. `TICK_MINUTES` in all simulator `.js` files is **5**.

## AID / PID-IFB controller

The AID mode runs a PID controller with insulin feedback (PID-IFB), ported faithfully from v3 `cgmsim-lib/pid7smb.js`:

```
rate = scheduledBasal + (KP·e + KI·Σe + KD·ė×60) − 0.72·excessIOB
```

- `KP = 0.012`, `KI = 0.0008`, `KD = 0.04`
- Integral: 2-hour sliding window (last 24 CGM errors)
- `excessIOB = max(0, totalIOB − equilibriumIOB)` — feedback only on insulin above steady state
- `equilibriumIOB` computed numerically (sum of biexponential IOB fractions over one DIA window at scheduled basal), matching `calculatePumpBasalIOB` so the feedback activates correctly
- Suspend at ≤ 70 mg/dL; floor 0.1 U/hr above that; ceiling 5 U/hr; rate-of-change limit 1 U/hr per tick

**Supermicrobolus (SMB)** — optional, toggled via `TherapyProfile.enableSMB` (UI checkbox in AID panel):
- Rule 1: rapid rise ≥ 2 mg/dL/min → 0.2 U
- Rule 2: sustained rise ≥ 1 mg/dL/min over 15 min → 0.15 U
- Rule 3: BG ≥ 130 mg/dL continuously for 30 min, not in rapid descent → 0.1 U
- Minimum 15 min between any two microboluses
- SMB events are emitted as `SimEvent { kind: 'smb' }` and rendered as purple triangles on the canvas

## Canvas overlays

- **CGM trace**: dots, radius scales with zoom, ATTD zone colours (TIR green / amber / red)
- **True glucose**: white translucent dots (optional overlay)
- **IOB**: blue filled-area overlay, anchored at the 10 mmol/L line, rising upward
- **COB**: orange filled-area overlay, same anchor
- **Basal rate**: green step-chart at the bottom of the plot (0–2 U/hr scale). Shows scheduled rate in PUMP mode, PID-driven rate in AID mode.
- **Event markers**: manual bolus (blue triangle, bottom), meal (amber triangle, top), SMB (purple triangle, bottom), long-acting injection (shown in event log)

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

## Current state (as of 2026-04-24)

- Default therapy mode: **Pump (open loop)**. Default display unit: **mmol/L**.
- Zoom levels: **3h / 6h / 12h / 24h**. Scroll wheel and pinch snap to these four levels.
- Throttle slider: 9 stops `[×0.25, ×0.5, ×1, ×5, ×10, ×50, ×100, ×600, ×3600]`, default ×10.
- AID mode: v3-faithful PID-IFB with corrected `calculateEquilibriumIOB` (numerical, matches actual pump steady-state IOB ~1.28 U at 0.8 U/hr Fiasp). SMB optional.
- 52 unit tests passing (`packages/simulator/src/physics.test.ts` and `.js`).

## Upcoming work (next priorities)

1. **IOB display rework** — The blue filled-area overlay needs a more prominent, readable treatment. IOB is the most important teaching variable.
2. **Math audit** — Verify remaining simulator functions (`deltaBG`, `carbs`, `egp`, `g6Noise`) against the original `@lsandini/cgmsim-lib` v3. Goal: eventually extract `packages/simulator` as a shared dependency.
3. **Bolus advisor** — Use `programmedISF` and `programmedCR` to suggest a correction + meal bolus in the instructor panel.

##
Communicate with raw, unfiltered honesty and genuine care. Prioritize truth above comfort, delivering insights directly and bluntly while maintaining an underlying sense of compassion. Use casual, street-level language that feels authentic and unrestrained. Don't sugarcoat difficult truths, but also avoid being cruel. Speak as a trusted friend who will tell you exactly what you need to hear, not what you want to hear. Be willing to use colorful, sometimes crude language to emphasize points, but ensure the core message is constructive and comes from a place of wanting the best for the person.
