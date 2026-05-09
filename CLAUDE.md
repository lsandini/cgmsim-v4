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
- Production build is minified with **terser** (`minify: 'terser'`, `passes: 2`, `drop_console: true`, comments stripped) — standalone is ~130 kB raw / ~35 kB gzipped, down from ~194 kB / ~50 kB unminified. Build time ~2s. `drop_console` removes `console.*` calls entirely; never rely on a console call having runtime effect.

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

## MDI submodes (LIVE / PRESCRIPTION)

When `therapy.mode === 'MDI'`, a second axis controls how events are dispatched:

- **LIVE** (default) — manual delivery. The instructor clicks meal / bolus / long-acting buttons themselves. Free-form, used for ad-hoc teaching scenarios.
- **PRESCRIPTION** — auto-dispatch from a pre-programmed hospital-tray regimen. Manual entry inputs are greyed out (`applyPrescriptionLockUI()`); the prescription is the single source of truth.

The prescription (`TherapyProfile.prescription`) holds:
- **5 fixed meal slots** at 07:00 / 11:00 / 13:00 / 17:00 / 20:00 — time and grams are protocol-fixed; only `bolusUnits` is editable in the modal.
- **Sliding-scale correction**, 3 tiers at >8 / >12 / >16 mmol/L. **Highest tier wins** (not additive).
- **Fasting toggle**: meals disabled, only corrections fire — at the configured `fastingCorrectionHours` (default 7 / 13 / 17 / 22).

**Firing rules** (`InlineSimulator.checkPrescription`):
- Mealtime bolus + sliding-scale correction fire **T-10 min** before each meal slot; carbs fire at T.
- Correction uses the noisy CGM, not true glucose — same teaching rationale as the PID input.
- **Forward-only**: a slot whose trigger has already passed when PRESCRIPTION is enabled (or session imported, or fasting toggled mid-day) is silently marked "fired today" — no catch-up.
- `WorkerState.prescriptionLastFiredDay` is a per-slot map persisted in v2 sessions, so save/restore and submode toggles never re-fire an already-delivered slot.

Edited via the **📋 Edit prescription** pill in the top strip (visible only in MDI mode), which opens a modal.

## Prednisone scenario (Novomix premix + oral prednisone, MDI-only)

A dedicated teaching scenario for "MDI patient on a hospital steroid course." Teachers
demo how a morning prednisone tablet drives afternoon hyperglycemia and how stacked
premix Novomix coverage plus stronger correction boluses are needed to compensate.

**Activation.** A single tickbox `Prednisone scenario` lives below the three patient
cards in the onboarding step 2. Case-agnostic — the teacher picks lean/average/larger
adult independently of the steroid scenario. When ticked, step 3 (therapy) renders
AID and Pump cards visually disabled (`.therapy-card.locked`, opacity 0.4, tooltip)
and pre-selects MDI. Stored as `withPrednisone: boolean` on the `cgmsim.case` JSON
alongside `caseId` and `therapy`. Defaults to `false` on missing field (back-compat).
Switching scenarios mid-session requires Reopen Onboarding (full sim reset). Mid-case
scenario menu hides AID/PUMP entries via `applyPrednisoneScenarioGating`, so no path
exists for the simulator to drift into a mode that doesn't support the scenario.

**Therapy panel layout (MDI + withPrednisone).** Three subsections in this order:
- Long-acting (existing) — Glargine/Detemir/Degludec morning + evening
- Premix insulin (Novomix 30) — morning + evening, dose-units + time + Set
- Prednisone — single morning slot, dose-mg + time clamped 06:00–11:59 + Set

All three sections share the same `.long-acting-row` grid + `.la-*` classes so columns
align vertically. Premix and Prednisone rows render an italic muted
`.la-type-placeholder` ("Novomix 30" / "Prednisone (mg)") in the type-select column
so dose / time / button line up with the long-acting rows above. Defaults when the
scenario activates: Novomix 16 U @ 07:30 morning + 12 U @ 16:30 evening; prednisone
40 mg @ 09:00.

**Novomix engine (Option B decomposition).** Each scheduled `injectNovomix(units, slot)`
emits ONE `SimEvent { kind: 'novomix' }` but spawns TWO active records:
- 30% rapid Aspart pushed into `activeBoluses` with `analogue: 'Aspart'`,
  `dia: patient.dia`, `source: 'novomix'`. The `source` tag attributes the activity
  to the rose strip but is invisible to IOB and BG calculations — they sum all
  boluses regardless of origin, so IOB pill correctly jumps by 30% at injection.
- 70% protaminated slow component pushed into `activeLongActing` with
  `type: 'NovomixSlow'`. NPH-style PK profile in `LONG_ACTING_PROFILES`:
  `duration = (12 + 20·U/wt)·60 min`, `peak = duration / 3.5`. Engine-spawned
  only — users can't pick `NovomixSlow` directly (the user-facing
  `LongActingType` excludes it; the broader `LongActingPKType` alias is internal).

`calculateLongActingActivity` filters NovomixSlow OUT (so the teal strip shows
"true" long-acting only); `calculatePremixSlowActivity` and
`calculateNovomixRapidActivity` pull each component separately. The bottom-of-chart
strip stacks the rose `premixActivity` (= rapid + slow) layer on top of the teal
LA layer — total height = sum, color split shows which drug is providing background
coverage. `computeDeltaBG` re-sums them in `basalActivity` so the BG calculation
correctly accounts for all background insulin.

**Prednisone engine.** Oral tablet, scheduled daily morning fire from
`prednisoneSchedule` via forward-only `firePrednisoneIfDue`. PK is **fixed window**,
NOT dose- or weight-scaled (clinically prednisone has a property-of-the-drug effect
duration independent of dose):
- `duration = 15 * 60` min (900 min, 15 h)
- `peak = duration / 3` = 300 min (5 h post-dose)

For an 08:00 dose: peak ≈ 13:00, fade-out ≈ 23:00. Activity magnitude scales linearly
with mg via the biexponential's `units` term; time profile is invariant. Stamped
into `activePrednisoneDoses` at injection; purged in tick when elapsed > duration.
`SimEvent { kind: 'prednisone' }` emitted for the canvas tick mark.

**Model C (hybrid effect) in `computeDeltaBG`.** Prednisone activity (mg-eq/min)
drives two coupled mechanisms — pedagogically rich because students can't fix
either with a single corrective bolus:

```
prednisoneActivity   = sum of getExpTreatmentActivity over activePrednisoneDoses
isfResistanceDivider = 1 + prednisoneActivity · K1_PREDNISONE_RESISTANCE   (K1 = 14)
effectiveISF         = trueISF / isfResistanceDivider                       ← halved at peak
egpMultiplier        = 1 + prednisoneActivity · K2_PREDNISONE_HEPATIC      (K2 = 14)

insulinEffect = -(totalInsulinActivity · effectiveISF · TICK_MINUTES)     ← uses effective
carbEffect    = calculateCarbEffect(meals, isf, ...)                       ← uses TRUE
baseEGP       = calculateEGP(patient, ..., isf, ...)                       ← uses TRUE
egpEffect     = baseEGP · egpMultiplier                                     ← K2 boost on top
```

**Critical** — only the insulin BG-lowering term uses `effectiveISF`. Carbs use true
ISF (the physical glucose load is unchanged by insulin sensitivity); EGP baseline
uses true ISF (the formula `egpPerMin = (isf/trueCR)·…` scales linearly with ISF,
so passing `effectiveISF` would halve the baseline and the K2 multiplier would
restore it — net zero hepatic boost, the bug we hit during initial calibration).
The teaching takeaway "carbs hit harder on prednisone" emerges from the smaller
negative `insulinEffect`, not from inflating `carbEffect`.

**Calibration target at peak of a 40 mg dose, 75 kg patient:**
- peak activity ≈ 0.072 (mg-eq/min)
- `1 + 14·0.072 = 2.0` → effective ISF halved (insulin at 50% potency, matches the
  clinical "doubled insulin needs" rule of thumb)
- EGP × 2.0 (~+30 mg/dL/h additional fasted-state rise on top of baseline)

Cumulative differential over the day vs no-prednisone baseline ≈ +80–100 mg/dL (~5
mmol/L) at peak. Tunable: `K1_PREDNISONE_RESISTANCE` and `K2_PREDNISONE_HEPATIC` in
`packages/simulator/src/deltaBG.{ts,js}`.

**Canvas rendering.**
- Novomix marker: rose `#e11d48` filled circle on the BG curve at injection time,
  dose-scaled (`treatmentRadius(units, 'insulin')`), label "Nx Nu" below.
  One marker per injection (the engine's two records share one event).
- Novomix activity strip: rose layer `premixActivity` stacked on top of the teal
  long-acting layer in the bottom panel. Same `MAX_RATE = 2 U/hr` scale as the
  teal layer. Skipped entirely when no Novomix is on board.
- Prednisone tick: small forest-green `#15803d` inverted triangle (▼) just below
  the top axis, mirroring the SMB upward triangle at the bottom. Fixed ~6-8 px,
  no dose scaling. Label "N mg" below the apex.

**Persistence.** All scheduled fields (`premixMorning`, `premixEvening`,
`prednisoneSchedule`) live on `TherapyProfile` and round-trip via the v2 session
envelope (`getCurrentState` deep-clones `activePrednisoneDoses` along with the
`lastPremixMorningDay` / `lastPremixEveningDay` / `lastPrednisoneDay` daily-fire
trackers). Form-state mirrors persist in `cgmsim.panel-overrides` under
`therapy.premix*` and `therapy.prednisone*` for F5 survival of mid-edit form values.

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
- **UI preferences** (overlay toggles, zoom, display unit, panel open state, MDI prescription) are persisted in `localStorage` under `cgmsim.ui-prefs`. Theme uses `cgmsim.theme`. Onboarded flag + chosen case live under `cgmsim.onboarded` / `cgmsim.case`.
- **Panel overrides** (manual edits to therapy + patient form fields — therapy mode, programmed DIA, rapid analogue, SMB toggle, basal segments, long-acting morning/evening, temp basal inputs, true ISF/CR/DIA, weight, diabetes duration, carbs absorption time, gastric emptying rate) are persisted in `localStorage` under `cgmsim.panel-overrides`. True ISF stored in **mg/dL canonical** so the snapshot survives unit toggles. Applied on top of the case template at init. Cleared on first-time onboarding, on **↻ Restart onboarding**, and via the **↺ Reset to case defaults** button (next to Restart in the Patient tab). A `suppressPersist` flag wraps init / reset / re-onboarding so programmatic form-writes don't clobber a clear. **Glucose target is intentionally NOT persisted** — it always comes from the case template on reload / reset, so the AID-vs-PUMP/MDI defaults (110 vs 100 mg/dL) are restored cleanly. MDI submode, throttle, and running-state are **not** persisted — they reset on F5 by design.

## Current state (as of 2026-05-09)

- **Visual refresh**: cooler palette (off GitHub-dark), distinct CGM/IOB/COB hues, solid TIR threshold lines at 3.9 and 10 mmol/L, taller basal strip with bold readout, sun/moon time-of-day indicator next to sim-time, BG digit flash on update with rapid-update debouncing, header rebuilt as IOB/COB stat chips with scenario badge promoted to readable.
- **Dev banner**: thin red marquee at the very top of the page with the message "Development version, work in progress, not production ready" sliding right→left in an infinite seamless loop. Body uses flex-column so `#app` fills the remaining viewport. Wrapper has `role="status"` and the inner duplicated track is `aria-hidden="true"` so screen readers don't read the message twice.
- **Onboarding case cards**: three human silhouette figures (lean / average / larger) replace the earlier circle placeholders. Cropped from a public-domain figure set (`uIKXf01.svg`); each variant has its own viewBox into the source coordinate space and shares the standard `translate(0,196) scale(0.1,-0.1)` transform. Filled with `currentColor` so they adapt to theme. All three render at the same display height with proportionally narrower/wider bodies — same person, different fatness. `patientFigureHTML(size, px)` in `packages/ui/src/onboarding/icons.ts`; `px` is the display **height**.
- **Prednisone scenario tickbox**: a single case-agnostic toggle row below the patient cards in onboarding step 2, with help text warning that ticking it locks therapy to MDI. See the dedicated **Prednisone scenario** section above for the full feature spec.
- **Default therapy mode**: MDI (default submode: LIVE; PRESCRIPTION available for hospital-tray scenarios). **Default display unit**: mmol/L. **Default zoom**: 12h. **Default evening LA injection time**: 21:00 in MDI LIVE, 22:00 in MDI PRESCRIPTION — `setSubmode` auto-flips between the two on user toggle, with a no-clobber rule (only flips when the current value is exactly the *other* submode's default; manual edits like 23:30 are preserved). Init / session-import call `setSubmode(submode, fromInit=true)` to skip the flip.
- Zoom levels: **3h / 6h / 12h / 24h**. Scroll wheel and pinch snap to these four levels.
- Throttle slider: continuous logarithmic slider labeled **"Acceleration factor"**, ×1 to ×3600, **default ×360** on start / reset / reopen-onboarding. Permanent floating bubble shows the current value above the slider thumb (no longer hover-only). Arrow keys snap along ladder `[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 3600]`.
- AID mode: v3-faithful PID-IFB with corrected `calculateEquilibriumIOB` (numerical, matches actual pump steady-state IOB ~1.28 U at 0.8 U/hr Fiasp). SMB optional.
- **AR2 forecast**: faithful Nightscout port at `coneFactor = 0`, 13 hollow grey ring dots, 65-min horizon, opacity fade per Nightscout's `futureOpacity` curve. On by default.
- **BG display chip**: big Nightscout-style current BG, centered overlay on the chart, semi-transparent. On by default.
- **Comparison run**: snapshot → make a change → press Run B → primary (Run A, green) continues with the change while comparison (Run B, pink) shows what would have happened without it.
- **EGP** is a faithful port of v3 `liver.js` + `sinus.js`: hardcoded sinus (1 + 0.2·sin(2π·hour/24), peak 6 AM) plus Hill-curve insulin suppression of hepatic output (max 65%, EC50 = 2× physiological basal flux). Hypo counter-regulation is a v4-only extension (kicks in below 80 mg/dL, scaled by diabetes duration).
- **Carb absorption**: triangular fast/slow split decided once at meal entry via a seeded LCG (`s.rngState`); deterministic across save/load. `resolveMealSplit(meal, r1, r2)` uses **two independent draws** — `r1` drives the initial fast carve-off (capped at 40 g), `r2` drives the remainder's `fastRatio = 0.1 + r2·0.3` ∈ [0.1, 0.4). Independence widens the meal-to-meal variance (slow-start/fast-tail and vice versa become possible) without changing the mean. Triangular curves and absorption windows (`carbsAbsTime/6` for fast, `carbsAbsTime/1.5` for slow) are unchanged from v3. v3 used per-tick re-draws; v4 consolidates to per-meal draws stamped on the `ResolvedMeal`.
- **Two-layer params exposed in the panel:** True ISF / True ICR / True DIA / Weight / Diabetes duration drive the patient physiology; Glucose target / Programmed DIA drive the controller.
- 171 unit tests passing (`packages/simulator/src/*.test.ts` and `.js`) under Vitest 4.

## Upcoming work (next priorities)

1. **Math audit** — Verify remaining simulator functions (`deltaBG`, `g6Noise`) against the v3 reference at `vendor/cgm-remote-monitor/`. Carbs and AR2 already audited.
2. **Animated event-marker pulse** — Brief 400ms highlight on meal/bolus/SMB markers when they first appear.
3. **Scenario replay** — Distinct from comparison run: rewind to t=0, replay all events at original times with modified params (the "fix the long-acting basal and re-run the same day" workflow).

##
Communicate with raw, unfiltered honesty and genuine care. Prioritize truth above comfort, delivering insights directly and bluntly while maintaining an underlying sense of compassion. Use casual, street-level language that feels authentic and unrestrained. Don't sugarcoat difficult truths, but also avoid being cruel. Speak as a trusted friend who will tell you exactly what you need to hear, not what you want to hear. Be willing to use colorful, sometimes crude language to emphasize points, but ensure the core message is constructive and comes from a place of wanting the best for the person.
