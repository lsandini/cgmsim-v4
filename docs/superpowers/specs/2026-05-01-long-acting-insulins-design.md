# Long-acting MDI insulins — v3-faithful PK + dual-slot scheduling

**Date:** 2026-05-01
**Status:** Approved (pending implementation plan)
**Scope:** `packages/simulator` (PK model) + `packages/ui` (MDI panel) + `packages/shared` (types)

## Problem

The v4 MDI long-acting model is a heavy simplification of the v3 `cgmsim-lib` model:

- Only one daily injection (single `longActingType` / `longActingDose` / `longActingInjectionTime` triple in `TherapyProfile`).
- Three insulins available — Glargine, Degludec, Detemir — each with a fixed `{peak, dia}` constant pair.
- No distinction between Lantus (Glargine U100) and Toujeo (Glargine U300), even though their PK is meaningfully different.
- No dose- or weight-dependent duration, which is the clinically most important behavior of Detemir and the differentiator between U100 and U300 glargine.

Practical consequences: the simulator can't reproduce common MDI regimens (split BID basal, Toujeo's flatter profile vs. Lantus, Levemir's dose-dependent duration) and can't model the most current standard of care for adult basal therapy (Toujeo).

## Goals

1. Port v3 `drug.js` long-acting PK formulas faithfully, including dose- and weight-dependent duration where v3 has it.
2. Support up to two daily injections (morning + evening), each with its own insulin choice, dose, and time.
3. Replace the current always-on auto-applying form with an explicit Set / Unset gesture so the instructor can deliberately schedule, lock, and clear basal regimens.
4. Drop NPH (not present in v4 anyway, and obsolete for the teaching context).

## Non-goals

- IndexedDB migration of pre-existing saved sessions (single-user dev environment, no saved sessions exist).
- Adding any long-acting beyond the four named insulins.
- Mid-sim weight changes affecting already-injected doses (PK params are stamped at injection time and immutable thereafter — by design).
- Changing the rapid-acting analogue model, pump basal, AID controller, or any other simulator subsystem.
- Bolus-style "inject one shot now" UI for long-actings (out of scope; the daily-recurring schedule is the only mechanism).

## PK model (v3-faithful)

`packages/simulator/src/insulinProfiles.ts` — `LONG_ACTING_PROFILES` becomes a function-based table, ported verbatim from v3 `node_modules/@lsandini/cgmsim-lib/dist/drug.js:14-44`. All durations are minutes, all peaks are minutes.

| Insulin | `duration(units, weight_kg)` (min) | `peak(duration)` (min) |
|---|---|---|
| `GlargineU100` (Lantus) | `(22 + 12 * units / weight) * 60` | `duration / 2.5` |
| `GlargineU300` (Toujeo) | `(24 + 14 * units / weight) * 60` | `duration / 2.5` |
| `Detemir` (Levemir) | `(14 + 24 * units / weight) * 60` | `duration / 3` |
| `Degludec` (Tresiba) | `42 * 60` (constant, dose-independent) | `duration / 3` |

Worked examples (20 U into a 70 kg patient):

- Lantus: dur ≈ 1525 min (25.4 h), peak ≈ 610 min (10.2 h)
- Toujeo: dur ≈ 1680 min (28.0 h), peak ≈ 672 min (11.2 h) — explicitly longer and flatter than Lantus
- Levemir: dur ≈ 1251 min (20.9 h), peak ≈ 417 min (7.0 h)
- Tresiba: dur = 2520 min (42.0 h), peak = 840 min (14.0 h)

The biexponential math in `packages/simulator/src/utils.ts` (`getExpTreatmentActivity`, `getExpTreatmentIOB`) already takes `peak` and `duration` as input parameters and is unchanged.

### Stamping pattern

When an injection fires, the simulator computes `peak` and `duration` from the dose plus the patient's *current* `weight` and stamps both onto the `ActiveLongActing` record. The PK parameters are then immutable for the lifetime of that depot. This matches the existing v4 pattern for `ActiveBolus.dia` (stamped from `patient.dia` at bolus time) and is functionally equivalent to v3's `getTreatmentExpParam` evaluating duration/peak once when assembling the treatments array.

## Data shape

### `packages/shared/src/index.ts`

```ts
export type LongActingType =
  | 'GlargineU100'   // Lantus (U100)
  | 'GlargineU300'   // Toujeo (U300)
  | 'Detemir'        // Levemir
  | 'Degludec';      // Tresiba

export interface LongActingSchedule {
  type: LongActingType;
  units: number;
  /** Minute of day (0..1439). Morning slot: 0..719. Evening slot: 720..1439. */
  injectionMinute: number;
}

export interface ActiveLongActing {
  id: string;
  simTimeMs: SimTimeMs;
  units: number;
  type: LongActingType;
  /** Stamped at injection time from v3 PK formulas + patient.weight. Minutes. */
  peak: number;
  duration: number;
}
```

### `TherapyProfile` changes

Replace the three flat fields:

```ts
// removed
longActingType: LongActingType;
longActingDose: number;
longActingInjectionTime: number;

// added
longActingMorning: LongActingSchedule | null;   // null = unset
longActingEvening: LongActingSchedule | null;
```

Default values for both slots: `null` (nothing scheduled). The instructor must explicitly configure and Set each slot they want active.

## Scheduling logic (`packages/ui/src/inline-simulator.ts`)

`checkLongActingDose()` is replaced with a two-slot version. State adds `lastMorningDay` and `lastEveningDay` (both initialized to `-1`), replacing the single `lastLongActingDay`.

Per tick, for each non-null slot:

```
slot = therapy.longActing{Morning|Evening}
if slot !== null
   and minuteOfDay >= slot.injectionMinute
   and simDay !== lastDayForThisSlot:
       fire injection (push into activeLongActing with stamped peak/duration)
       lastDayForThisSlot = simDay
```

**Stamping at fire time:** the injection record's `peak` and `duration` come from `LONG_ACTING_PROFILES[slot.type]` evaluated against `slot.units` and the *current* `state.patient.weight`.

**On Unset / re-Set:** clearing a slot does not retract already-injected `ActiveLongActing` records; they decay naturally over their stamped duration. Only future daily firings stop. This matches reality — once injected, insulin can't be pulled back out.

**Expiry filter** (`worker.js:84` / `inline-simulator.ts:166` equivalent) uses each record's stamped `d.duration` instead of looking up the profile constant.

## UI (`packages/ui/index.html` + `packages/ui/src/main.ts`)

The current `#section-mdi` block (3 panel-rows: type / dose / time) is replaced by **two `<div class="long-acting-row">` blocks** — Morning and Evening. Each row contains, in order:

```
[ Insulin dropdown ]  [ Dose input ]  [ Time input ]  [ Set / Unset btn ]
```

### Insulin dropdown

Same options in both rows, default-selected option is **Toujeo**:

```html
<option value="GlargineU300">Glargine U300 (Toujeo)</option>
<option value="GlargineU100">Glargine U100 (Lantus)</option>
<option value="Detemir">Detemir (Levemir)</option>
<option value="Degludec">Degludec (Tresiba)</option>
```

### Time inputs

Native HTML5 time pickers, constrained by slot:

- Morning: `<input type="time" min="00:00" max="11:59">`, default value `08:00`
- Evening: `<input type="time" min="12:00" max="23:59">`, default value `22:00`

Browsers honor `min`/`max` for `type=time`. `onTherapyChange` additionally guards on the TS side (rejects any minute-of-day outside the slot's window) to prevent paste-bypass from corrupting state.

### Dose input

Number input, `min="1"`, `max="80"`, `step="1"`, default `20`. Same in both rows.

### Set / Unset button — state machine

A single button per row, label and visual state derived from whether the corresponding therapy slot is `null` (Unset) or non-null (Active).

| State | Button label | Visual | Form controls | Click action |
|---|---|---|---|---|
| Unset | "Set" | gray border, neutral fill | enabled | validate inputs → write `LongActingSchedule` to therapy slot → transition to Active |
| Active | "Unset" | green border, slight green tint | disabled (read-only) | clear therapy slot to `null` → transition to Unset |

**Validation on Set:** dose ≥ 1 U; time within slot's window. Failure shows a brief shake animation + tooltip; the schedule is not written.

**Re-Set workflow:** to change an active schedule, the user must press Unset first (which writes `null` to the slot), edit values, then press Set again. Editing while Active is impossible — the controls are disabled.

### Visibility

Same as today — the entire long-acting section lives inside `#section-mdi` and is shown only when `mode === 'MDI'`. Pump and AID modes hide it.

### State sync

`onTherapyChange` is rebuilt to:
- Read both rows independently and emit `setTherapyParam({ longActingMorning, longActingEvening, ... })`.
- For each row, derive button state from whether the slot is `null` and toggle disabled state on the row's form controls accordingly.
- On simulator load (or session restore), inflate row state from the current therapy slots so an Active slot shows as green/locked.

## Tests (`packages/simulator/src/physics.test.ts`)

**New tests:**

- `LONG_ACTING_PROFILES.GlargineU300.duration(20, 70)` returns `1680` and `peak(1680) === 672`
- `LONG_ACTING_PROFILES.GlargineU100.duration(20, 70)` < `GlargineU300.duration(20, 70)` (Toujeo is longer)
- `Detemir.duration(10, 70)` < `Detemir.duration(40, 70)` (Levemir's defining clinical behavior — duration grows with dose)
- `Degludec.duration(10, 70) === Degludec.duration(40, 70)` (dose-independent constant)
- `calculateLongActingActivity` with a mixed `[Toujeo morning, Tresiba evening]` array sums correctly using each record's stamped peak/duration

**Removed tests:** any assertion against the old fixed `{peak: 360, dia: 24}` Glargine constants.

## Build sequence (per CLAUDE.md mandate)

```
npm run typecheck
npm test
npm run build:standalone
```

The standalone HTML is the primary deliverable; the `.ts` sources alone are not sufficient.

The `.js` mirror files in `packages/simulator/src/` are kept hand-synced with `.ts` per the v4 architecture rule (Vite resolves them directly at runtime). UI `.js` mirrors are gitignored and not used at runtime.

## Files touched

| File | Change |
|---|---|
| `packages/shared/src/index.ts` | Replace `LongActingType` union; add `LongActingSchedule`; add `peak`/`duration` to `ActiveLongActing`; replace 3 flat `longActing*` fields in `TherapyProfile` with two nullable slots |
| `packages/simulator/src/insulinProfiles.ts` + `.js` | Rewrite `LONG_ACTING_PROFILES` as function-based v3-faithful table |
| `packages/simulator/src/iob.ts` + `.js` | `calculateLongActingActivity` / `IOB` use `d.peak` / `d.duration` instead of profile lookup |
| `packages/simulator/src/physics.test.ts` + `.js` | Update / add tests per above |
| `packages/simulator/src/worker.ts` + `.js` | Mirror inline-simulator scheduling changes; expiry filter uses stamped duration |
| `packages/ui/src/inline-simulator.ts` | Two-slot scheduling: `lastMorningDay` + `lastEveningDay`; stamp peak/duration at injection from `patient.weight` and `LONG_ACTING_PROFILES[type]`; expiry filter uses stamped duration |
| `packages/ui/src/main.ts` | Rebuild MDI section binding: per-row Set/Unset toggle, validation, state sync, button visual state |
| `packages/ui/index.html` | Replace 3 `panel-row` blocks in `#section-mdi` with two `long-acting-row` blocks; add `.long-acting-row` rules + Set / Unset / disabled visual states to the inline `<style>` block (CSS lives there, ref `index.html:529`) |
| `packages/ui/dist/cgmsim-v4-standalone.html` | Rebuilt artifact |

## Open questions

None. All design choices resolved during brainstorming on 2026-05-01.
