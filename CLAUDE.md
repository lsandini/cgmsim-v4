# CGMSIM v4

Standalone browser-based glycaemic teaching simulator for diabetes education sessions. Fourth generation of the CGMSIM platform (cgmsim.com). NOT clinical software — generates only synthetic data for teaching.

## Project structure

npm workspaces monorepo:

- `packages/simulator/` — Physiological engine: deltaBG, insulin PD profiles, carb absorption, IOB/COB, PID controller, G6 noise model, AR2 forecast. No browser dependencies; unit-testable in Node.
- `packages/ui/` — Vite SPA: Canvas renderer, instructor panel, throttle control, file-based JSON session persistence, localStorage UI prefs. Vanilla TypeScript (no React).
- `packages/shared/` — TypeScript type definitions only (message types, patient/therapy interfaces, persisted shapes). No runtime code.
- `packages/ui/dist/cgmsim-v4-standalone.html` — Self-contained single-file build (output of `build:standalone` in packages/ui). This is the primary deliverable for teaching sessions.
- `vendor/cgm-remote-monitor/` — Read-only clone of the Nightscout backend, kept locally as a reference for porting algorithms (e.g., AR2 forecast, future math audits). Gitignored.

## Commands

```bash
npm run dev          # Vite dev server (packages/ui)
npm run build        # Build all packages (shared → simulator → ui)
npm run test         # Vitest unit tests (packages/simulator)
npm run typecheck    # TypeScript strict check across all packages
```

```bash
npm run build:standalone   # Produces the single-file HTML (root shortcut, forwards to packages/ui)
```

The standalone is built by `vite-plugin-singlefile` (configured in `packages/ui/vite.config.ts`), which inlines the JS bundle into `dist/index.html`. The script then renames it to `dist/cgmsim-v4-standalone.html`.

## After every code change

Always rebuild the standalone file before reporting work as done:

```bash
npm run build:standalone
```

This is the primary deliverable — the `.ts` sources alone are not sufficient.

## Key architecture decisions

- All glucose computations in **mg/dL** internally. mmol/L conversion at display layer only (÷ 18.0182). Default display unit is **mmol/L**.
- Simulation tick = **5 simulated minutes**. One CGM reading per tick. 12 CGM values per simulated hour.
- The simulation engine runs as `InlineSimulator` on the main thread (RAF loop). No WebWorker in the standalone build.
- PID controller receives the **noisy CGM value**, not true glucose — intentional and pedagogically important.
- Two-layer parameter model: patient physiology (ground truth) vs therapy profile (programmed settings). The mismatch between them creates teaching scenarios.
- G6 noise model is stateful (AR(2) + Ziggurat RNG). State must be serialized for save/restore and comparison runs.
- Comparison runs use two independent `InlineSimulator` instances with identical initial state but divergent parameters.
- **Two-layer DIA**: `patient.dia` (true physiology) drives the actual physical decay of bolus and pump-microbolus insulin — `ActiveBolus.dia` and `pumpMicroBoluses[].dia` are stamped from it at injection time. `therapy.rapidDia` (the controller's programmed belief) is read **only** by `pid.ts` for the equilibrium-IOB calculation. The mismatch is the v4 teaching scenario.
- The `.js` files in `packages/simulator/src/` are the live runtime files resolved directly by Vite. They must be kept manually in sync with the `.ts` sources. `TICK_MINUTES` in all simulator `.js` files is **5**.
- The `.js` files in `packages/ui/src/` are **NOT** used at runtime — Vite bundles directly from `main.ts`. They are gitignored. UI `tsconfig.json` has `noEmit: true` so `tsc --build` does not regenerate them. Only edit `.ts` for UI code.
- Sourcemaps (`*.js.map`) are gitignored; they are debug aids only and not part of the runtime contract. `packages/simulator/tsconfig.json` has `sourceMap: false` so `tsc --build` no longer emits `.js.map` files into `dist/` — this prevents stale `//# sourceMappingURL` comments from appearing in `src/*.js` if someone copies output back.
- Build toolchain: **Vite 8.0.x** (UI workspace) + **vite-plugin-singlefile 2.3.x** for standalone inlining. Dev server resolves TS on the fly; production build inlines the JS bundle into `dist/index.html`, then the npm script renames it to `dist/cgmsim-v4-standalone.html`. There is no separate `inline.mjs` — the plugin replaced it.

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

- **CGM trace**: dots, radius 3px at 3h zoom / 2.5px at wider zooms, ATTD zone colours (TIR green / amber / red)
- **True glucose**: white translucent dots (optional overlay)
- **IOB**: blue filled-area overlay, anchored at the 10 mmol/L line, rising upward
- **COB**: orange filled-area overlay, same anchor
- **Basal rate**: green step-chart at the bottom of the plot (0–2 U/hr scale). Shows scheduled rate in PUMP mode, PID-driven rate in AID mode.
- **AR2 forecast**: 13 hollow grey ring dots projected 65 min into the future from the last two CGM samples. Same outer-edge radius as CGM dots; 1px stroke, no fill. Per-dot opacity follows Nightscout's piecewise-linear `futureOpacity` curve (full opacity for the first ~3 dots, fading to zero by dot 13). Faithful port of `vendor/cgm-remote-monitor/lib/plugins/ar2.js` at `coneFactor = 0`. Toggleable, on by default.
- **BG display chip**: big Nightscout-style current-BG number, ~72px monospace, semi-transparent rounded chip with thin border, centered horizontally near the top of the chart. Mirrors the bottom-strip BG (zone colors, flash on update). Toggleable, on by default.
- **Event markers**: meal (amber `#fbbf24` full circle, matches COB overlay), bolus (sky-blue `#60a5fa` full circle, matches IOB overlay), and long-acting injection (teal `#14b8a6` full circle) all **float on the BG curve at the event timestamp**, with radius scaled by dose (`sqrt(value) * 1.8`, clamped 3-20px; insulin is multiplied by visual CR=10 to share scale with carbs). All markers carry a 1.5px contrasting stroke (`#e2e8f0` on dark, `#64748b` on light). Labels: `${grams} g` above meal circles, `${units} U` below bolus and long-acting circles. SMB stays as a small purple triangle just above the bottom axis. All marker fill colors are theme-unified (same hex on dark and light themes). Pump basal microboluses are NOT individually marked — they're represented collectively by the basal step-chart strip.

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

## Session persistence

- **JSON file export/import** is the only persistence mechanism. IndexedDB save/load was removed (was redundant and lossy).
- **v2 envelope** carries the complete `WorkerState` plus `cgmHistory[]` (renderer ring buffer) so a reloaded session resumes "as if nothing happened" — chart fully redrawn, markers in place, RNG state preserved, active treatments still resolving.
- **v1 legacy files** (the old format) are still loadable but with degraded behaviour (blank chart, no markers, fresh seeds). The status line shows `(legacy)` so the user knows the import was lossy.
- **`getCurrentState()`** on `InlineSimulator` is the synchronous accessor for building a snapshot. The old async `requestSave()` callback chain was removed.
- **UI preferences** (overlay toggles, zoom, display unit, panel open state) are persisted in `localStorage` under `cgmsim.ui-prefs`. Theme uses its own `cgmsim.theme` key. None of these are part of the session JSON — they describe how the user wants to view the app, not the simulation.

## Current state (as of 2026-05-03)

- **Visual refresh**: cooler palette (off GitHub-dark), distinct CGM/IOB/COB hues, solid TIR threshold lines at 3.9 and 10 mmol/L, taller basal strip with bold readout, sun/moon time-of-day indicator next to sim-time, BG digit flash on update with rapid-update debouncing, header rebuilt as IOB/COB stat chips with scenario badge promoted to readable.
- **Default therapy mode**: MDI. **Default display unit**: mmol/L. **Default zoom**: 12h.
- Zoom levels: **3h / 6h / 12h / 24h**. Scroll wheel and pinch snap to these four levels.
- Throttle slider: continuous logarithmic slider, ×1 to ×3600, default ×10. Floating bubble follows the thumb on hover/drag. Arrow keys snap along ladder `[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 3600]`.
- AID mode: v3-faithful PID-IFB with corrected `calculateEquilibriumIOB` (numerical, matches actual pump steady-state IOB ~1.28 U at 0.8 U/hr Fiasp). SMB optional.
- **AR2 forecast**: faithful Nightscout port at `coneFactor = 0`, 13 hollow grey ring dots, 65-min horizon, opacity fade per Nightscout's `futureOpacity` curve. On by default.
- **BG display chip**: big Nightscout-style current BG, centered overlay on the chart, semi-transparent. On by default.
- **Comparison run**: snapshot → make a change → press Run B → primary (Run A, green) continues with the change while comparison (Run B, pink) shows what would have happened without it.
- **EGP** is a faithful port of v3 `liver.js` + `sinus.js`: hardcoded sinus (1 + 0.2·sin(2π·hour/24), peak 6 AM) plus Hill-curve insulin suppression of hepatic output (max 65%, EC50 = 2× physiological basal flux). Hypo counter-regulation is a v4-only extension (kicks in below 80 mg/dL, scaled by diabetes duration).
- **Carb absorption**: triangular fast/slow split decided once at meal entry via a seeded LCG (`s.rngState`); deterministic across save/load. Same math as v3 cgmsim-lib but with one consolidated random draw (vs. v3's separate per-tick draws in both `calculateCarbEffect` and `calculateCarbsCOB`).
- **Two-layer params exposed in the panel:** True ISF / True ICR / True DIA / Weight / Diabetes duration drive the patient physiology; Glucose target / Programmed DIA drive the controller.
- 171 unit tests passing (`packages/simulator/src/*.test.ts` and `.js`) under Vitest 4.

## Upcoming work (next priorities)

1. **Math audit** — Verify remaining simulator functions (`deltaBG`, `g6Noise`) against the v3 reference at `vendor/cgm-remote-monitor/`. Carbs and AR2 already audited.
2. **Animated event-marker pulse** — Brief 400ms highlight on meal/bolus/SMB markers when they first appear.
3. **Scenario replay** — Distinct from comparison run: rewind to t=0, replay all events at original times with modified params (the "fix the long-acting basal and re-run the same day" workflow).

##
Communicate with raw, unfiltered honesty and genuine care. Prioritize truth above comfort, delivering insights directly and bluntly while maintaining an underlying sense of compassion. Use casual, street-level language that feels authentic and unrestrained. Don't sugarcoat difficult truths, but also avoid being cruel. Speak as a trusted friend who will tell you exactly what you need to hear, not what you want to hear. Be willing to use colorful, sometimes crude language to emphasize points, but ensure the core message is constructive and comes from a place of wanting the best for the person.
