# Mobile companion build — iPhone-landscape standalone

**Date:** 2026-05-10
**Status:** Drafted (pending user review, then implementation plan)
**Scope:** `packages/ui` (new entrypoint + mobile-only modules + new build target). Engine and shared types unchanged.

## Problem

Students who use the desktop simulator during workshops want to play with it on their phones in their free time. The current `cgmsim-v4-standalone.html` is built for ≥1400px viewports — on a phone the chart and instructor panel either squish into illegibility or force horizontal scrolling. Touch targets are small, modals don't fit, and the form-heavy panels weren't designed for one-thumb operation.

The goal is to ship a **second** standalone HTML file, optimized for iPhone-landscape, that students can open from a shared link and use without an instructor. It is not a full port of the desktop UX — it's a deliberately reduced sandbox.

## Goals

1. Produce `dist/cgmsim-v4-mobile.html` — a single self-contained file, built independently from the desktop standalone, sharing the simulator engine and canvas renderer untouched.
2. Support **MDI-only** therapy (LIVE submode + PRESCRIPTION submode) — the two basic teaching modes for student self-practice.
3. Layout: edge-to-edge canvas with a floating "+" action button (Layout C from brainstorming).
4. Touch-first input model — custom in-DOM numeric keypad (no native iOS keyboard taking over the screen), bottom sheets for actions and settings, gesture support on the canvas.
5. Reuse the case definitions, engine, and canvas renderer without forking.

## Non-goals (cut from v1)

- AID and Pump therapy modes.
- Premix Novomix scenario, Prednisone scenario.
- JSON file export/import (no save/load).
- Comparison run (Run A vs Run B).
- Patient physiology editing — true ISF / true CR / true DIA / weight stay locked to the case template. Only the case is selectable.
- Light theme — dark only.
- Scheduled long-acting morning/evening times — student injects whenever they decide.
- Sliding-scale tier editing in PRESCRIPTION mode (chips are read-only in v1; defer to v2).
- Persistent always-visible throttle slider — replaced by a compact speed pill (tap-to-pause; long-press opens a slider sheet on demand).
- Basal / IOB / COB strip overlays under the chart — overlay area is too narrow on a phone; the IOB/COB pills at the top carry the same info numerically.
- Portrait-orientation support — students must rotate to landscape.

## Architecture

### Code reuse boundaries

| Module | Treatment |
|---|---|
| `packages/simulator/` | Untouched. Full reuse. |
| `packages/shared/` | Untouched. Full reuse. |
| `packages/ui/src/canvas-renderer.ts` (exports `CGMRenderer`) | Reused as-is. The renderer already adapts to its container's dimensions. Mobile passes a smaller `<canvas>` container, calls `setRendererTheme('dark')`, and uses `setZoom(360)` for the 6h default. |
| `packages/ui/src/inline-simulator.ts` | Reused as-is. |
| `packages/ui/src/time24.ts` | Reused as-is. |
| `packages/ui/src/storage.ts` | Subset reuse — keep `cgmsim.ui-prefs` and `cgmsim.case` helpers; do NOT import the JSON file export/import code paths. |
| `packages/ui/src/onboarding/cases.ts` | Reused as-is — same case definitions feed the mobile case picker. |
| `packages/ui/src/onboarding/icons.ts` | Reused as-is — same `patientFigureHTML(size, px)` for the silhouettes. |
| `packages/ui/src/main.ts` | NOT imported by mobile. Desktop entrypoint, stays desktop-only. |
| `packages/ui/index.html` | NOT modified. Stays desktop-only. |

### New files

```
packages/ui/
├── index-mobile.html                  ← second root document
├── vite.mobile.config.ts              ← parallel Vite config
├── src/
│   └── mobile/
│       ├── mobile.ts                  ← entrypoint (parallels main.ts)
│       ├── mobile-layout.ts           ← top/bottom overlay rendering, pill chips
│       ├── mobile-action-sheet.ts     ← + sheet, picker → input pad
│       ├── mobile-keypad.ts           ← in-DOM numeric keypad component
│       ├── mobile-settings-sheet.ts   ← ☰ sheet
│       ├── mobile-prescription-sheet.ts ← prescription editor sub-sheet
│       ├── mobile-onboarding.ts       ← first-launch case picker
│       ├── mobile-gestures.ts         ← pinch zoom, two-finger pan, tap-to-pause
│       └── mobile-styles.css          ← all mobile-only styles, dark-only
```

### Build target

- New npm script `build:mobile` in `packages/ui/package.json`:
  - Runs Vite with `--config vite.mobile.config.ts`.
  - That config points `build.rollupOptions.input` at `index-mobile.html`, applies `vite-plugin-singlefile`, and outputs to `dist/`.
  - Post-build step renames `dist/index-mobile.html` → `dist/cgmsim-v4-mobile.html` (mirrors the existing desktop pattern).
- Root `package.json` `build:mobile` shortcut forwards to `packages/ui` (mirrors the existing `build:standalone` shortcut).
- `npm run build` (root) gets a step added so it produces both files.
- Independent builds: building one does not rebuild the other. Touching simulator code requires rebuilding both standalones — CLAUDE.md gets a sentence to that effect.

### Bundle size budget

- Desktop standalone: ~130 kB raw / ~35 kB gzipped.
- Mobile target: ≤100 kB raw / ≤30 kB gzipped. Smaller because: no AID UI, no Pump panel, no comparison run, no premix/prednisone, no light-theme CSS, no JSON import/export. If the build comes in over budget, audit before shipping.

## Layout — main "play" screen (Layout C)

Edge-to-edge canvas with floating overlays. No persistent panels.

### Top overlays (drawn over the canvas)

- **BG chip**: centered ~48px from top edge. Same Nightscout-style chip as desktop but font ~52px instead of 72px. Zone-coloured (TIR green / amber / red), flashes on update.
- **IOB pill**: top-left, semi-transparent rounded chip. Format `IOB 1.2 U`. Same hex as desktop overlay.
- **COB pill**: top-right symmetrical to IOB.
- **Hamburger ☰**: top-right corner past the COB pill, 44×44 tap target, ~20px icon. Opens settings sheet.
- **Sim-time + sun/moon**: small text directly below the BG chip.

### Bottom overlays

- **Speed pill**: bottom-left. ~88×44. Single-tap toggles pause/play. Long-press (500ms) opens speed selector sheet (slider snapped to ladder `[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 3600]`).
- **Floating + button**: bottom-right. 56×56 circle, primary blue (#1f6feb), drop shadow. Opens action sheet.

### Default settings

| | Desktop | Mobile |
|---|---|---|
| Default zoom | 12h | **6h** |
| Default display unit | mmol/L | mmol/L (same) |
| Default theme | dark | dark (same — only option) |
| Default throttle | ×360 | ×360 (same) |
| Default therapy mode | MDI / LIVE | MDI / LIVE (same) |

## Action sheet (+ button)

Two-step bottom sheet. Half-height for the picker, ~80% height for the input pad.

### Step 1 — picker

Three big tiles, color-coded to match canvas markers:

| Tile | Border | Icon | Label |
|---|---|---|---|
| Meal | amber `#fbbf24` | 🍞 | grams |
| Rapid bolus | sky-blue `#60a5fa` | 💉 | units |
| Long-acting | teal `#14b8a6` | 💉 | units + type |

Tap outside or pull down to dismiss.

### Step 2 — input pad (per action)

Custom in-DOM keypad — explicitly NOT the iOS native keyboard (which would cover half the screen).

- **3×4 grid**: digits 0-9, decimal point, backspace.
- **Display**: large landing area showing current value with units.
- **Right side**: action-specific options.
- **Confirm button**: full-width primary button at bottom-right of the sheet.

#### Per-action input panes

**🍞 Meal**
- Number pad → grams (integer).
- **Absorption selector**: segmented control `slow / normal / fast`. Maps to existing `Meal.absorptionTime` and gastric-emptying parameters in the case.
- Fires immediately when confirmed.

**💉 Rapid bolus**
- Number pad → units (decimal, 0.1 step).
- Analogue is read from the case template (`patient.rapidAnalogue` — Aspart / Lispro / Fiasp). Not user-editable on mobile.
- Fires immediately.

**💉 Long-acting**
- **Type selector**: segmented control `Glargine U100 / Glargine U300 / Detemir / Degludec` (matches the desktop `LongActingType` set, excluding internal `NovomixSlow`).
- Number pad → units (decimal, 0.5 step).
- Fires immediately as a one-shot. The mobile build does NOT support scheduled morning/evening LA injections — every injection is "now". This trades the dose/time scheduling concept for a simpler "you inject when you decide" model.

**Engine extension required:** the current `InlineSimulator` only schedules long-acting via `setTherapyParam({ longActingMorning, longActingEvening })`. To support one-shot injection without abusing the schedule, add a new method `InlineSimulator.injectLongActingNow(type: LongActingType, units: number): void`. It pushes an `ActiveLongActing` directly into state with peak/duration computed from current `patient.weight` (matching existing stamping semantics from `LONG_ACTING_PROFILES`), and emits a `SimEvent { kind: 'longActing', simTimeMs }`. Existing scheduled-LA paths are untouched — desktop behaviour does not change.

## Settings sheet (☰ button)

Slides in from the right at ~55% width. Chart remains visible behind it (no scrim, just the panel). Compact rows.

| Row | Control | Persisted to |
|---|---|---|
| Patient case | tap row → reopens onboarding screen | `cgmsim.mobile.case` |
| MDI submode | segmented `LIVE` / `PRESCR` | `cgmsim.mobile.submode` |
| Edit prescription | tap row → prescription sub-sheet (greyed out in LIVE) | `cgmsim.mobile.prescription` |
| Display unit | segmented `mmol/L` / `mg/dL` | `cgmsim.mobile.ui-prefs.displayUnit` |
| AR2 forecast | segmented `on` / `off` | `cgmsim.mobile.ui-prefs.ar2` |
| True-glucose overlay | segmented `on` / `off` | `cgmsim.mobile.ui-prefs.trueGlucose` |
| Restart simulation | tap row → confirm dialog → reset | not persisted |

### Prescription sub-sheet (PRESCRIPTION mode only)

Wider sub-sheet (~62% width), reachable from "Edit prescription".

- **Eating / Fasting** segmented control at the top.
- **5 mealtime slots** (07:00 / 11:00 / 13:00 / 17:00 / 20:00) — time and grams are protocol-fixed (read-only); only `bolusUnits` is editable, via ±stepper (1 U increments).
- **Sliding-scale tiers** displayed as 3 read-only chips (>8 → N U, >12 → N U, >16 → N U). Editing deferred to v2.

Same firing rules and forward-only semantics as desktop's `InlineSimulator.checkPrescription` — no engine changes.

## Onboarding — first-launch case picker

Single screen, shown when `cgmsim.mobile.case` is absent in localStorage.

- **Header**: "CGMSIM v4 — Mobile" / "Pick a patient to get started".
- **Three figure cards** (lean / average / larger): same `patientFigureHTML` SVG silhouettes, smaller. Each card shows weight + true ISF as meta text.
- **"Start sim →" button**: primary blue, bottom-centered. Disabled until a card is selected.
- Two taps total on first launch.
- Reachable later via Settings → "Patient case". Mid-session case switching shows confirm: "Switching cases starts a new simulation. Continue?" then resets the sim with the chosen case.

No therapy-mode picker (always MDI), no prednisone toggle, no third step.

## Gestures (canvas)

- **Pinch zoom** → snaps to ladder `3h / 6h / 12h / 24h`. Same constraint as desktop wheel-zoom.
- **Two-finger pan deferred to v2.** Originally listed for v1, but conflicts with the canvas's `touch-action: none` gesture handling and would require either an explicit `setPanOffset` API on `CGMRenderer` or a non-trivial gesture re-architecture. Pinch-zoom + the renderer's auto-follow-live behaviour cover the common navigation needs; revisit after real-device testing.
- **Single-tap on chart** → toggle pause/play. Acts as a backup for the speed pill.
- **Tap on or near a marker** (meal / bolus / LA / SMB) → small popover showing the value and timestamp. Hit-testing uses a generous radius (~16px from the marker centre) since markers themselves are 3–20px. Same data the desktop renders on hover. Auto-dismiss after 2s or on next tap. (Novomix and prednisone markers are not in v1 since those scenarios are cut.)

## Persistence

localStorage only. Mobile-specific keys, separate from desktop so the two builds can't fight over schema:

| Key | Purpose |
|---|---|
| `cgmsim.mobile.case` | Selected case id. |
| `cgmsim.mobile.submode` | LIVE or PRESCRIPTION. |
| `cgmsim.mobile.prescription` | Prescription dose values. |
| `cgmsim.mobile.ui-prefs` | displayUnit, ar2, trueGlucose, lastZoom. |

**No `panel-overrides`** — mobile doesn't expose true-ISF / true-CR / true-DIA / weight editing.

**No mid-edit form-state mirrors** — there are no large forms to mirror.

**No `localStorage` available** (private browsing, disabled): sim still runs; nothing persists. No banner — too noisy.

## Error handling / edge cases

- **Portrait orientation**: full-screen message "Rotate your device to landscape" with a phone-rotation icon. Re-orientation listener flips back to the sim automatically.
- **Viewport <480px wide in landscape** (older phones below iPhone SE): same rotation/unsupported message.
- **iOS Safari quirks**: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">` so iOS doesn't double-tap-zoom. `-webkit-tap-highlight-color: transparent` to suppress the grey tap flash.
- **No service worker**, no PWA manifest in v1 — single HTML file, period. Could be added later.

## Testing

- **Engine**: existing 171 vitest tests in `packages/simulator/src/*.test.ts(.js)` cover all the math. No new engine tests — engine code is not changing.
- **UI**: hand-tested in iOS Safari (real device + Xcode iOS Simulator) and Chrome DevTools mobile emulation. No automated UI tests — same discipline as desktop.
- **Build verification** (definition of "ready to ship"):
  1. `npm run build:mobile` exits 0.
  2. `dist/cgmsim-v4-mobile.html` is a single file ≤100 kB raw / ≤30 kB gzipped.
  3. Opens in a desktop browser at iPhone-landscape dimensions (852×393) without errors.
  4. Smoke scenario: pick "Average adult" case → run 4h sim at ×360 → meal 45g normal absorption → bolus 4U → long-acting 20U Glargine U100 → toggle PRESCRIPTION → verify prescription firing → toggle LIVE → restart sim → all without console errors.
  5. Same scenario passes on a real iPhone in iOS Safari.

## Open questions / deferred to v2

- Sliding-scale tier editing.
- Service worker + PWA manifest for "add to home screen" install.
- Portrait-mode redesign.
- Premix and prednisone scenarios.
- Session import (teacher-shared scenarios).
- iPad layout (currently the same code will likely run on iPad in landscape but at oversized proportions — could refine).
- Two-finger pan on the canvas (see "Gestures" — deferred from v1).

## Implementation order (sketch — full plan via writing-plans)

1. Vite mobile build target (empty `index-mobile.html` → smoke test).
2. `mobile.ts` entrypoint that wires up the existing `InlineSimulator` + `CanvasRenderer` to a full-viewport canvas.
3. Top + bottom overlay chrome (BG chip, IOB/COB pills, hamburger, speed pill, + button) — non-interactive first.
4. Onboarding screen + localStorage gating.
5. Action sheet (picker + per-action input panes + custom keypad).
6. Settings sheet (case switch, submode toggle, display unit, overlay toggles, restart).
7. PRESCRIPTION submode wiring + prescription sub-sheet editor.
8. Canvas gestures (pinch, two-finger pan, tap-to-pause, marker popovers).
9. Portrait/unsupported-viewport guard.
10. Real-device smoke testing + bundle size check.
