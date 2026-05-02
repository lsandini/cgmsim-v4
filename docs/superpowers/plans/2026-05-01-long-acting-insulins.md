# Long-acting MDI insulins — v3-faithful PK + dual-slot scheduling: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v4 single-row long-acting MDI form with two independent morning/evening slots backed by v3-faithful, dose- and weight-dependent PK formulas, including Glargine U300 (Toujeo) alongside U100 (Lantus).

**Architecture:** PK constants in `LONG_ACTING_PROFILES` become functions of `(units, weight)` evaluated at injection time and stamped onto each `ActiveLongActing` record (mirrors the existing `ActiveBolus.dia` stamping pattern). Therapy schema replaces the three flat `longActing*` fields with two nullable slots (`longActingMorning`, `longActingEvening`). UI rewritten as two rows with a Set/Unset toggle that locks form controls when active.

**Tech Stack:** TypeScript (strict), npm workspaces (`packages/shared`, `packages/simulator`, `packages/ui`), Vite 8 + vite-plugin-singlefile for the standalone, Vitest 4 for unit tests, vanilla TS UI (no framework).

**Spec:** `docs/superpowers/specs/2026-05-01-long-acting-insulins-design.md`

**Reference (v3 source):** `node_modules/@lsandini/cgmsim-lib/dist/drug.js:14-44`

**Working directory:** `/home/lorenzo/cgmsim-v4`

---

## Task 1: Update shared types (`@cgmsim/shared`)

**Files:**
- Modify: `packages/shared/src/index.ts:21` (LongActingType union)
- Modify: `packages/shared/src/index.ts:75-104` (TherapyProfile + DEFAULT_THERAPY_PROFILE)
- Modify: `packages/shared/src/index.ts:143-148` (ActiveLongActing interface)

**Note:** This task intentionally leaves the build broken — every consumer of `LongActingType`, `longActingType`, `longActingDose`, `longActingInjectionTime`, and `ActiveLongActing` will fail to compile until Tasks 2–7 land. That's expected and tracked.

- [ ] **Step 1: Replace `LongActingType` union at line 21**

Open `packages/shared/src/index.ts` and find:
```ts
export type LongActingType = 'Glargine' | 'Degludec' | 'Detemir';
```

Replace with:
```ts
export type LongActingType =
  | 'GlargineU100'   // Lantus (U100)
  | 'GlargineU300'   // Toujeo (U300)
  | 'Detemir'        // Levemir
  | 'Degludec';      // Tresiba
```

- [ ] **Step 2: Add `LongActingSchedule` interface above `TherapyProfile`**

Insert this block immediately above the `TherapyProfile` interface (around line 70):
```ts
export interface LongActingSchedule {
  type: LongActingType;
  /** Dose in units. */
  units: number;
  /** Minute of day (0..1439). Morning slot: 0..719. Evening slot: 720..1439. */
  injectionMinute: number;
}
```

- [ ] **Step 3: Replace the three flat `longActing*` fields in `TherapyProfile`**

In `TherapyProfile` (currently lines 81-86), find:
```ts
  /** MDI long-acting insulin type. */
  longActingType: LongActingType;
  /** MDI long-acting dose in units. */
  longActingDose: number;
  /** MDI injection time as minutes since midnight. */
  longActingInjectionTime: number;
```

Replace with:
```ts
  /** MDI long-acting morning slot (00:00–11:59). null = unset. */
  longActingMorning: LongActingSchedule | null;
  /** MDI long-acting evening slot (12:00–23:59). null = unset. */
  longActingEvening: LongActingSchedule | null;
```

- [ ] **Step 4: Update `DEFAULT_THERAPY_PROFILE`**

In `DEFAULT_THERAPY_PROFILE` (currently lines 99-101), find:
```ts
  longActingType: 'Glargine',
  longActingDose: 20,
  longActingInjectionTime: 22 * 60,
```

Replace with:
```ts
  longActingMorning: null,
  longActingEvening: null,
```

- [ ] **Step 5: Add `peak` and `duration` to `ActiveLongActing`**

In `ActiveLongActing` (currently lines 143-148), find:
```ts
export interface ActiveLongActing {
  id: string;
  simTimeMs: SimTimeMs;
  units: number;
  type: LongActingType;
}
```

Replace with:
```ts
export interface ActiveLongActing {
  id: string;
  simTimeMs: SimTimeMs;
  units: number;
  type: LongActingType;
  /** Stamped at injection time from v3 PK formulas + patient.weight. Minutes. */
  peak: number;
  /** Stamped at injection time. Total duration of action in minutes. */
  duration: number;
}
```

- [ ] **Step 6: Rebuild shared package types**

Run from repo root:
```bash
npm run -w @cgmsim/shared build
```

Expected: `tsc --build` produces a fresh `packages/shared/dist/index.d.ts` (and `.js`) reflecting the new shape. No errors expected — this is a pure type/value file with no consumers internal to `@cgmsim/shared`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/dist/
git commit -m "shared: dual-slot LongActingSchedule + GlargineU100/U300 split

Replace LongActingType {Glargine,Degludec,Detemir} with the four v3-faithful
variants {GlargineU100,GlargineU300,Detemir,Degludec}. Replace TherapyProfile's
three flat longActing* fields with two nullable slots (Morning, Evening) of
type LongActingSchedule. Stamp peak+duration onto ActiveLongActing records
so the PK params survive a mid-sim weight change.

Build is intentionally broken in simulator + UI packages until follow-up
tasks land.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Rewrite `insulinProfiles` with v3-faithful PK + add unit tests

**Files:**
- Modify: `packages/simulator/src/insulinProfiles.ts` (full rewrite of long-acting section)
- Modify: `packages/simulator/src/insulinProfiles.js` (manual mirror)
- Modify: `packages/simulator/src/physics.test.ts` (add new tests, drop old ones)
- Modify: `packages/simulator/src/physics.test.js` (manual mirror)

**Pattern reference:** v3 `node_modules/@lsandini/cgmsim-lib/dist/drug.js:14-44` for the formulas.

- [ ] **Step 1: Write the failing tests in `packages/simulator/src/physics.test.ts`**

Find any existing `describe`/`it` block that asserts old long-acting constants (search for `'Glargine'`, `LONG_ACTING_PROFILES.Glargine`, or similar) and **delete** those tests. Then add this new block at the end of the file:

```ts
import { LONG_ACTING_PROFILES } from './insulinProfiles.js';
import { calculateLongActingActivity, calculateLongActingIOB } from './iob.js';

describe('LONG_ACTING_PROFILES (v3-faithful PK)', () => {
  it('GlargineU300 (Toujeo) duration & peak for 20U / 70kg', () => {
    const dur = LONG_ACTING_PROFILES.GlargineU300.duration(20, 70);
    expect(dur).toBeCloseTo(1680, 6);                  // (24 + 14*20/70)*60
    expect(LONG_ACTING_PROFILES.GlargineU300.peak(dur)).toBeCloseTo(672, 6);
  });

  it('Toujeo lasts longer than Lantus for the same dose+weight', () => {
    const lantus = LONG_ACTING_PROFILES.GlargineU100.duration(20, 70);
    const toujeo = LONG_ACTING_PROFILES.GlargineU300.duration(20, 70);
    expect(toujeo).toBeGreaterThan(lantus);
  });

  it('Detemir duration grows with dose (Levemir clinical behavior)', () => {
    const small = LONG_ACTING_PROFILES.Detemir.duration(10, 70);
    const large = LONG_ACTING_PROFILES.Detemir.duration(40, 70);
    expect(large).toBeGreaterThan(small);
  });

  it('Degludec duration is dose-independent (always 42h)', () => {
    expect(LONG_ACTING_PROFILES.Degludec.duration(10, 70))
      .toBe(LONG_ACTING_PROFILES.Degludec.duration(40, 70));
    expect(LONG_ACTING_PROFILES.Degludec.duration(20, 70)).toBe(2520);
  });

  it('calculateLongActingActivity sums activity from mixed insulins', () => {
    // Two depots injected together (sim time 0), checked one hour later
    const nowMs = 60 * 60_000;
    const toujeoDur = LONG_ACTING_PROFILES.GlargineU300.duration(20, 70);
    const tresibaDur = LONG_ACTING_PROFILES.Degludec.duration(15, 70);
    const doses = [
      {
        id: 'la-1', simTimeMs: 0, units: 20, type: 'GlargineU300' as const,
        peak: LONG_ACTING_PROFILES.GlargineU300.peak(toujeoDur),
        duration: toujeoDur,
      },
      {
        id: 'la-2', simTimeMs: 0, units: 15, type: 'Degludec' as const,
        peak: LONG_ACTING_PROFILES.Degludec.peak(tresibaDur),
        duration: tresibaDur,
      },
    ];
    const activity = calculateLongActingActivity(doses, nowMs);
    expect(activity).toBeGreaterThan(0);

    // Sum of two activities should equal the activity of an array containing both
    const a1 = calculateLongActingActivity([doses[0]], nowMs);
    const a2 = calculateLongActingActivity([doses[1]], nowMs);
    expect(activity).toBeCloseTo(a1 + a2, 6);

    // IOB sanity: both depots should still hold most of their units after 1h
    const iob = calculateLongActingIOB(doses, nowMs);
    expect(iob).toBeGreaterThan(20); // 35 U injected, 1h elapsed → IOB > 20
    expect(iob).toBeLessThan(35);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
npm -w @cgmsim/simulator test -- --run physics.test.ts
```

Expected: tests fail to compile or fail at runtime — `LONG_ACTING_PROFILES.GlargineU300` is undefined, `LONG_ACTING_PROFILES.GlargineU100.duration` is not a function, etc.

- [ ] **Step 3: Rewrite `packages/simulator/src/insulinProfiles.ts`**

Open the file and find the existing `LONG_ACTING_PROFILES` block (lines 30-39):
```ts
export const LONG_ACTING_PROFILES: Record<LongActingType, InsulinProfile> = {
  /** Glargine U100 (Lantus/Basaglar): very flat, peak ~5–8 h, DIA 24 h */
  Glargine: { peak: 360, dia: 24 },
  /** Degludec (Tresiba): near-peakless, DIA ~42 h */
  Degludec: { peak: 600, dia: 42 },
  /** Detemir (Levemir): mild peak ~6–8 h, DIA 20 h */
  Detemir: { peak: 420, dia: 20 },
};
```

Also find the `InsulinProfile` interface (lines 12-17) and the surrounding context.

Replace from line 12 down through line 39 with:
```ts
export interface InsulinProfile {
  /** Time to peak activity (minutes). */
  peak: number;
  /** Duration of insulin action (hours). */
  dia: number;
}

/**
 * Long-acting PK profile: dose- and weight-dependent.
 * `duration(units, weight)` returns total activity duration in minutes.
 * `peak(duration)` returns time to peak activity in minutes (often a fixed ratio of duration).
 *
 * Formulas ported verbatim from v3 cgmsim-lib drug.js:14-44.
 */
export interface LongActingPKProfile {
  duration: (units: number, weightKg: number) => number;
  peak: (durationMin: number) => number;
}

// ── Rapid-acting analogues ───────────────────────────────────────────────────

export const RAPID_PROFILES: Record<RapidAnalogueType, InsulinProfile> = {
  /** Fiasp: faster onset, peak ~55 min, DIA ~5 h */
  Fiasp: { peak: 55, dia: 5 },
  /** Lispro (Humalog): peak ~75 min, DIA ~5 h */
  Lispro: { peak: 75, dia: 5 },
  /** Aspart (NovoRapid): peak ~75 min, DIA ~5 h */
  Aspart: { peak: 75, dia: 5 },
};

// ── Long-acting analogues (v3-faithful, dose- and weight-dependent) ──────────

export const LONG_ACTING_PROFILES: Record<LongActingType, LongActingPKProfile> = {
  /** Glargine U100 (Lantus). v3 GLA: dur = (22 + 12·U/wt)·60 min; peak = dur/2.5 */
  GlargineU100: {
    duration: (units, weightKg) => (22 + 12 * units / weightKg) * 60,
    peak: (dur) => dur / 2.5,
  },
  /** Glargine U300 (Toujeo). v3 TOU: dur = (24 + 14·U/wt)·60 min; peak = dur/2.5 — longer & flatter than Lantus. */
  GlargineU300: {
    duration: (units, weightKg) => (24 + 14 * units / weightKg) * 60,
    peak: (dur) => dur / 2.5,
  },
  /** Detemir (Levemir). v3 DET: dur = (14 + 24·U/wt)·60 min; peak = dur/3 — strongly dose-dependent. */
  Detemir: {
    duration: (units, weightKg) => (14 + 24 * units / weightKg) * 60,
    peak: (dur) => dur / 3,
  },
  /** Degludec (Tresiba). v3 DEG: dur = 42·60 min (dose-independent); peak = dur/3. */
  Degludec: {
    duration: () => 42 * 60,
    peak: (dur) => dur / 3,
  },
};
```

The `RapidAnalogueType` import at the top must remain (line 10). Remove `LongActingType` from the import since the new table doesn't reference it — wait, it does: `Record<LongActingType, ...>`. Keep it.

The full top-of-file should now look like:
```ts
import type { RapidAnalogueType, LongActingType } from '@cgmsim/shared';
```

- [ ] **Step 4: Mirror to `packages/simulator/src/insulinProfiles.js`**

Open `packages/simulator/src/insulinProfiles.js` and replace the file contents with the JS-equivalent (no type annotations, no `import type`):

```js
// ── Rapid-acting analogues ───────────────────────────────────────────────────
export const RAPID_PROFILES = {
    /** Fiasp: faster onset, peak ~55 min, DIA ~5 h */
    Fiasp: { peak: 55, dia: 5 },
    /** Lispro (Humalog): peak ~75 min, DIA ~5 h */
    Lispro: { peak: 75, dia: 5 },
    /** Aspart (NovoRapid): peak ~75 min, DIA ~5 h */
    Aspart: { peak: 75, dia: 5 },
};
// ── Long-acting analogues (v3-faithful, dose- and weight-dependent) ──────────
export const LONG_ACTING_PROFILES = {
    /** Glargine U100 (Lantus). v3 GLA: dur = (22 + 12·U/wt)·60 min; peak = dur/2.5 */
    GlargineU100: {
        duration: (units, weightKg) => (22 + 12 * units / weightKg) * 60,
        peak: (dur) => dur / 2.5,
    },
    /** Glargine U300 (Toujeo). v3 TOU: dur = (24 + 14·U/wt)·60 min; peak = dur/2.5 */
    GlargineU300: {
        duration: (units, weightKg) => (24 + 14 * units / weightKg) * 60,
        peak: (dur) => dur / 2.5,
    },
    /** Detemir (Levemir). v3 DET: dur = (14 + 24·U/wt)·60 min; peak = dur/3 */
    Detemir: {
        duration: (units, weightKg) => (14 + 24 * units / weightKg) * 60,
        peak: (dur) => dur / 3,
    },
    /** Degludec (Tresiba). v3 DEG: dur = 42·60 min (dose-independent); peak = dur/3. */
    Degludec: {
        duration: () => 42 * 60,
        peak: (dur) => dur / 3,
    },
};
```

(Preserve any leading file-level header comment that exists in the original `.js` — copy it back if needed.)

- [ ] **Step 5: Mirror the new tests to `packages/simulator/src/physics.test.js`**

Vitest can pick up either `.ts` or `.js` test files; per the v4 convention the simulator's `.js` mirror is also kept up to date. Open `physics.test.js` and:
1. Delete any tests asserting the old fixed Glargine constants (mirror what you did in `.ts`).
2. Append the JS-equivalent of the new test block (drop the `as const` casts and the explicit type annotations):

```js
import { LONG_ACTING_PROFILES } from './insulinProfiles.js';
import { calculateLongActingActivity, calculateLongActingIOB } from './iob.js';

describe('LONG_ACTING_PROFILES (v3-faithful PK)', () => {
    it('GlargineU300 (Toujeo) duration & peak for 20U / 70kg', () => {
        const dur = LONG_ACTING_PROFILES.GlargineU300.duration(20, 70);
        expect(dur).toBeCloseTo(1680, 6);
        expect(LONG_ACTING_PROFILES.GlargineU300.peak(dur)).toBeCloseTo(672, 6);
    });
    it('Toujeo lasts longer than Lantus for the same dose+weight', () => {
        const lantus = LONG_ACTING_PROFILES.GlargineU100.duration(20, 70);
        const toujeo = LONG_ACTING_PROFILES.GlargineU300.duration(20, 70);
        expect(toujeo).toBeGreaterThan(lantus);
    });
    it('Detemir duration grows with dose (Levemir clinical behavior)', () => {
        const small = LONG_ACTING_PROFILES.Detemir.duration(10, 70);
        const large = LONG_ACTING_PROFILES.Detemir.duration(40, 70);
        expect(large).toBeGreaterThan(small);
    });
    it('Degludec duration is dose-independent (always 42h)', () => {
        expect(LONG_ACTING_PROFILES.Degludec.duration(10, 70))
            .toBe(LONG_ACTING_PROFILES.Degludec.duration(40, 70));
        expect(LONG_ACTING_PROFILES.Degludec.duration(20, 70)).toBe(2520);
    });
    it('calculateLongActingActivity sums activity from mixed insulins', () => {
        const nowMs = 60 * 60_000;
        const toujeoDur = LONG_ACTING_PROFILES.GlargineU300.duration(20, 70);
        const tresibaDur = LONG_ACTING_PROFILES.Degludec.duration(15, 70);
        const doses = [
            { id: 'la-1', simTimeMs: 0, units: 20, type: 'GlargineU300',
              peak: LONG_ACTING_PROFILES.GlargineU300.peak(toujeoDur), duration: toujeoDur },
            { id: 'la-2', simTimeMs: 0, units: 15, type: 'Degludec',
              peak: LONG_ACTING_PROFILES.Degludec.peak(tresibaDur), duration: tresibaDur },
        ];
        const activity = calculateLongActingActivity(doses, nowMs);
        expect(activity).toBeGreaterThan(0);
        const a1 = calculateLongActingActivity([doses[0]], nowMs);
        const a2 = calculateLongActingActivity([doses[1]], nowMs);
        expect(activity).toBeCloseTo(a1 + a2, 6);
        const iob = calculateLongActingIOB(doses, nowMs);
        expect(iob).toBeGreaterThan(20);
        expect(iob).toBeLessThan(35);
    });
});
```

- [ ] **Step 6: Run tests — they should still fail because `iob.ts` hasn't been updated**

```bash
npm -w @cgmsim/simulator test -- --run physics.test.ts
```

Expected: the four `LONG_ACTING_PROFILES.*` tests pass (the new table is in place). The `calculateLongActingActivity` test fails because `iob.ts` still reads `profile.peak` and `profile.dia` as scalars (which are now `undefined` on the new function-based profile). Task 3 fixes this.

(If the test runner refuses to compile because of TS errors in `iob.ts`, that's also expected — note this and proceed; Task 3 fixes it.)

- [ ] **Step 7: Commit**

```bash
git add packages/simulator/src/insulinProfiles.ts \
        packages/simulator/src/insulinProfiles.js \
        packages/simulator/src/physics.test.ts \
        packages/simulator/src/physics.test.js
git commit -m "simulator: v3-faithful long-acting PK formulas

Replace fixed-constant LONG_ACTING_PROFILES with dose- and weight-dependent
duration/peak functions ported verbatim from v3 cgmsim-lib drug.js. Adds
GlargineU300 (Toujeo), drops generic 'Glargine' in favor of the explicit
GlargineU100 (Lantus) variant. New tests cover the four PK formulas plus
mixed-insulin activity summation.

iob.ts still references profile.peak/dia as scalars — fixed in next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Update `iob.ts`/`.js` to use stamped `peak`/`duration`

**Files:**
- Modify: `packages/simulator/src/iob.ts:61-91` (`calculateLongActingActivity`, `calculateLongActingIOB`)
- Modify: `packages/simulator/src/iob.js` (manual mirror)

- [ ] **Step 1: Rewrite `calculateLongActingActivity` and `calculateLongActingIOB` in `iob.ts`**

Open `packages/simulator/src/iob.ts` and find lines 61-91:
```ts
export function calculateLongActingActivity(doses: ActiveLongActing[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    doses.reduce((sum, d) => {
      const profile = LONG_ACTING_PROFILES[d.type];
      if (!profile) return sum;
      const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentActivity({
        peak: profile.peak,
        duration: profile.dia * 60,
        minutesAgo: minAgo,
        units: d.units,
      });
    }, 0),
  );
}

export function calculateLongActingIOB(doses: ActiveLongActing[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    doses.reduce((sum, d) => {
      const profile = LONG_ACTING_PROFILES[d.type];
      if (!profile) return sum;
      const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentIOB({
        peak: profile.peak,
        duration: profile.dia * 60,
        minutesAgo: minAgo,
        units: d.units,
      });
    }, 0),
  );
}
```

Replace with:
```ts
export function calculateLongActingActivity(doses: ActiveLongActing[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    doses.reduce((sum, d) => {
      const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentActivity({
        peak: d.peak,
        duration: d.duration,
        minutesAgo: minAgo,
        units: d.units,
      });
    }, 0),
  );
}

export function calculateLongActingIOB(doses: ActiveLongActing[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    doses.reduce((sum, d) => {
      const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentIOB({
        peak: d.peak,
        duration: d.duration,
        minutesAgo: minAgo,
        units: d.units,
      });
    }, 0),
  );
}
```

The `LONG_ACTING_PROFILES` import at line 13 may now be unused in this file (it was only used inside these two functions). Check — if no other reference remains in `iob.ts`, remove `LONG_ACTING_PROFILES` from the import statement at line 13:
```ts
import { RAPID_PROFILES } from './insulinProfiles.js';
```

- [ ] **Step 2: Mirror to `packages/simulator/src/iob.js`**

In `packages/simulator/src/iob.js`, locate the same two functions (lines 43-91 in the JS mirror — exact lines may vary slightly; search for `calculateLongActingActivity`).

Replace both function bodies with the JS-equivalent of the TS rewrite above (no type annotations):
```js
export function calculateLongActingActivity(doses, nowSimTimeMs) {
    return roundTo8Decimals(doses.reduce((sum, d) => {
        const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
        return sum + getExpTreatmentActivity({
            peak: d.peak,
            duration: d.duration,
            minutesAgo: minAgo,
            units: d.units,
        });
    }, 0));
}

export function calculateLongActingIOB(doses, nowSimTimeMs) {
    return roundTo8Decimals(doses.reduce((sum, d) => {
        const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
        return sum + getExpTreatmentIOB({
            peak: d.peak,
            duration: d.duration,
            minutesAgo: minAgo,
            units: d.units,
        });
    }, 0));
}
```

If `LONG_ACTING_PROFILES` import is now unused in `iob.js`, remove it from the import statement at line 11.

- [ ] **Step 3: Run tests — Task 2's mixed-insulin test should now pass**

```bash
npm -w @cgmsim/simulator test -- --run physics.test.ts
```

Expected: all five new `LONG_ACTING_PROFILES` tests in the new `describe` block pass. (Other existing tests in `physics.test.ts` should also still pass — no changes to bolus/pump-basal logic.)

- [ ] **Step 4: Commit**

```bash
git add packages/simulator/src/iob.ts packages/simulator/src/iob.js
git commit -m "simulator: use stamped peak/duration in long-acting IOB/activity

calculateLongActingActivity and calculateLongActingIOB now read d.peak and
d.duration directly from each ActiveLongActing record instead of looking up
the (now function-based) LONG_ACTING_PROFILES at every tick. Stamping happens
at injection time in the inline simulator (next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Update `worker.ts`/`.js` expiry filter

**Files:**
- Modify: `packages/simulator/src/worker.ts` (expiry filter — same code as `.js`)
- Modify: `packages/simulator/src/worker.js:84-89` (expiry filter)

**Note:** The worker is NOT used in the standalone build (per CLAUDE.md, `InlineSimulator` runs on main thread). This task keeps the worker code consistent so it doesn't bit-rot. The worker has no `checkLongActingDose` of its own — only the inline simulator schedules injections.

- [ ] **Step 1: Update worker.js expiry filter**

Open `packages/simulator/src/worker.js` and find lines 84-89:
```js
    s.activeLongActing = s.activeLongActing.filter((d) => {
        const profile = LONG_ACTING_PROFILES[d.type];
        if (!profile)
            return false;
        return (nowMs - d.simTimeMs) / 60_000 <= profile.dia * 60;
    });
```

Replace with:
```js
    s.activeLongActing = s.activeLongActing.filter((d) =>
        (nowMs - d.simTimeMs) / 60_000 <= d.duration
    );
```

The `LONG_ACTING_PROFILES` import at line 20 may now be unused in `worker.js`. Search the file — if not referenced elsewhere, simplify line 20 to:
```js
import { RAPID_PROFILES } from './insulinProfiles.js';
```

- [ ] **Step 2: Mirror to worker.ts**

Apply the equivalent change in `packages/simulator/src/worker.ts` (same line range, same edit). If `worker.ts` doesn't exist or is identical to `.js` aside from types, just verify and skip.

- [ ] **Step 3: Verify simulator package builds**

```bash
npm run -w @cgmsim/simulator typecheck 2>&1 | head -40
```

Expected: clean (no TypeScript errors). If errors mention old field names, re-check Task 1 was applied.

```bash
npm -w @cgmsim/simulator test -- --run
```

Expected: all tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/simulator/src/worker.ts packages/simulator/src/worker.js
git commit -m "simulator/worker: use stamped duration in long-acting expiry filter

Mirrors the iob.ts change. The worker isn't used in the standalone build
but kept consistent to avoid bit-rot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rewrite `inline-simulator.ts` scheduling logic

**Files:**
- Modify: `packages/ui/src/inline-simulator.ts:46` (SimEvent.longActing.insulinType type)
- Modify: `packages/ui/src/inline-simulator.ts:72` (lastLongActingDay → two trackers)
- Modify: `packages/ui/src/inline-simulator.ts:96` (initial values)
- Modify: `packages/ui/src/inline-simulator.ts:136-155` (checkLongActingDose)
- Modify: `packages/ui/src/inline-simulator.ts:166-169` (expiry filter)
- Modify: `packages/ui/src/inline-simulator.ts:338` (reset state)
- Modify: `packages/ui/src/inline-simulator.ts:36` (LONG_ACTING_PROFILES import — keep, used in stamping)

- [ ] **Step 1: Update the `SimEvent` discriminator for long-acting**

At line 46, find:
```ts
  | { kind: 'longActing'; simTimeMs: number; units: number; insulinType: string }
```

Change `insulinType: string` to use the new typed union:
```ts
  | { kind: 'longActing'; simTimeMs: number; units: number; insulinType: import('@cgmsim/shared').LongActingType; slot: 'morning' | 'evening' }
```

(The inline `import('@cgmsim/shared')` is fine here; `LongActingType` is also imported at the top of the file via `ActiveLongActing` — alternatively add `LongActingType` to the top-level type import block at lines 12-21 and use the bare name. Either works; the inline form keeps the diff smaller.)

The `slot` field is added so canvas markers and event log entries can distinguish morning vs evening doses.

- [ ] **Step 2: Replace `lastLongActingDay` with two trackers**

At line 72, find:
```ts
  lastLongActingDay: number;
```

Replace with:
```ts
  lastMorningDay: number;
  lastEveningDay: number;
```

At line 96, find:
```ts
    lastLongActingDay: -1,
```

Replace with:
```ts
    lastMorningDay: -1,
    lastEveningDay: -1,
```

At line 338 (inside `reset()`), find:
```ts
      rngState: randomSeed(), lastLongActingDay: -1, tempBasal: null, events: [],
```

Replace with:
```ts
      rngState: randomSeed(), lastMorningDay: -1, lastEveningDay: -1, tempBasal: null, events: [],
```

- [ ] **Step 3: Rewrite `checkLongActingDose` (lines 136-155)**

Find the entire `checkLongActingDose` method:
```ts
  private checkLongActingDose(): void {
    const s = this.s;
    if (s.therapy.mode !== 'MDI') return;
    const minuteOfDay     = (s.simTimeMs / 60_000) % (24 * 60);
    const simDay          = Math.floor(s.simTimeMs / (24 * 60 * 60_000));
    const injectionMinute = s.therapy.longActingInjectionTime;
    if (minuteOfDay >= injectionMinute && simDay !== s.lastLongActingDay) {
      s.lastLongActingDay = simDay;
      s.activeLongActing.push({
        id: `la-${s.simTimeMs}`, simTimeMs: s.simTimeMs,
        units: s.therapy.longActingDose, type: s.therapy.longActingType,
      });
      const ev: SimEvent = {
        kind: 'longActing', simTimeMs: s.simTimeMs,
        units: s.therapy.longActingDose, insulinType: s.therapy.longActingType,
      };
      s.events.push(ev);
      for (const h of this.eventHandlers) h([ev]);
    }
  }
```

Replace with:
```ts
  private checkLongActingDose(): void {
    const s = this.s;
    if (s.therapy.mode !== 'MDI') return;
    const minuteOfDay = (s.simTimeMs / 60_000) % (24 * 60);
    const simDay      = Math.floor(s.simTimeMs / (24 * 60 * 60_000));

    this.fireSlotIfDue('morning', s.therapy.longActingMorning, minuteOfDay, simDay);
    this.fireSlotIfDue('evening', s.therapy.longActingEvening, minuteOfDay, simDay);
  }

  private fireSlotIfDue(
    slot: 'morning' | 'evening',
    schedule: import('@cgmsim/shared').LongActingSchedule | null,
    minuteOfDay: number,
    simDay: number,
  ): void {
    if (schedule === null) return;
    const s = this.s;
    const lastDayKey = slot === 'morning' ? 'lastMorningDay' : 'lastEveningDay';
    if (minuteOfDay < schedule.injectionMinute) return;
    if (simDay === s[lastDayKey]) return;

    s[lastDayKey] = simDay;

    // Stamp PK params at injection time from current patient.weight
    const pk = LONG_ACTING_PROFILES[schedule.type];
    const duration = pk.duration(schedule.units, s.patient.weight);
    const peak = pk.peak(duration);

    s.activeLongActing.push({
      id: `la-${slot}-${s.simTimeMs}`,
      simTimeMs: s.simTimeMs,
      units: schedule.units,
      type: schedule.type,
      peak,
      duration,
    });

    const ev: SimEvent = {
      kind: 'longActing',
      simTimeMs: s.simTimeMs,
      units: schedule.units,
      insulinType: schedule.type,
      slot,
    };
    s.events.push(ev);
    for (const h of this.eventHandlers) h([ev]);
  }
```

- [ ] **Step 4: Update the expiry filter (lines 166-169)**

Find:
```ts
    s.activeLongActing = s.activeLongActing.filter(d => {
      const p = LONG_ACTING_PROFILES[d.type];
      return p !== undefined && (nowMs - d.simTimeMs) / 60_000 <= p.dia * 60;
    });
```

Replace with:
```ts
    s.activeLongActing = s.activeLongActing.filter(d =>
      (nowMs - d.simTimeMs) / 60_000 <= d.duration,
    );
```

- [ ] **Step 5: Confirm `LONG_ACTING_PROFILES` import is still needed**

The import at line 36:
```ts
import { RAPID_PROFILES, LONG_ACTING_PROFILES } from '../../simulator/src/insulinProfiles.js';
```

is now used by `fireSlotIfDue` only. Keep it as-is.

- [ ] **Step 6: Verify the file typechecks**

```bash
npm -w @cgmsim/ui exec -- tsc --noEmit -p tsconfig.json 2>&1 | head -40
```

Expected output: errors only in `main.ts` (which still uses old field names — fixed in Task 6). `inline-simulator.ts` itself should be clean.

If `inline-simulator.ts` has errors: re-check the property names match shared types (`longActingMorning`, `longActingEvening`, `LongActingSchedule.units`, `LongActingSchedule.injectionMinute`, `LongActingSchedule.type`).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/inline-simulator.ts
git commit -m "ui/inline-simulator: dual-slot long-acting scheduling + PK stamping

checkLongActingDose now iterates morning + evening slots independently, each
with its own lastDay tracker. fireSlotIfDue stamps peak and duration from the
v3 PK formulas + patient.weight at injection time, so the depot's decay is
deterministic from that point on. Expiry filter uses the stamped duration.
SimEvent.longActing now includes a typed insulinType and slot discriminator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Rewrite the MDI section markup in `index.html`

**Files:**
- Modify: `packages/ui/index.html:788-806` (`#section-mdi` block)
- Modify: `packages/ui/index.html` inline `<style>` block at line 7+ (add `.long-acting-row` rules near existing `.panel-row` rules around line 529+)

- [ ] **Step 1: Replace the `#section-mdi` markup**

Open `packages/ui/index.html` and find the existing block at lines 788-806:
```html
          <div class="panel-section" id="section-mdi">
            <h3>Long-acting (MDI)</h3>
            <div class="panel-row">
              <label>Insulin type</label>
              <select id="long-acting-type">
                <option value="Glargine">Glargine</option>
                <option value="Degludec">Degludec</option>
                <option value="Detemir">Detemir</option>
              </select>
            </div>
            <div class="panel-row">
              <label>Dose (U)</label>
              <input type="number" id="long-acting-dose" min="1" max="80" step="1" value="20" />
            </div>
            <div class="panel-row">
              <label>Injection time</label>
              <input type="time" id="long-acting-time" value="22:00" />
            </div>
          </div>
```

Replace with:
```html
          <div class="panel-section" id="section-mdi">
            <h3>Long-acting (MDI)</h3>
            <div class="long-acting-row" id="la-row-morning" data-slot="morning">
              <span class="la-row-label">Morning</span>
              <select class="la-type" data-default="GlargineU300">
                <option value="GlargineU300">Glargine U300 (Toujeo)</option>
                <option value="GlargineU100">Glargine U100 (Lantus)</option>
                <option value="Detemir">Detemir (Levemir)</option>
                <option value="Degludec">Degludec (Tresiba)</option>
              </select>
              <input type="number" class="la-dose" min="1" max="80" step="1" value="20" title="Dose (U)" />
              <input type="time" class="la-time" min="00:00" max="11:59" value="08:00" />
              <button type="button" class="la-set-btn">Set</button>
            </div>
            <div class="long-acting-row" id="la-row-evening" data-slot="evening">
              <span class="la-row-label">Evening</span>
              <select class="la-type" data-default="GlargineU300">
                <option value="GlargineU300">Glargine U300 (Toujeo)</option>
                <option value="GlargineU100">Glargine U100 (Lantus)</option>
                <option value="Detemir">Detemir (Levemir)</option>
                <option value="Degludec">Degludec (Tresiba)</option>
              </select>
              <input type="number" class="la-dose" min="1" max="80" step="1" value="20" title="Dose (U)" />
              <input type="time" class="la-time" min="12:00" max="23:59" value="22:00" />
              <button type="button" class="la-set-btn">Set</button>
            </div>
          </div>
```

- [ ] **Step 2: Add `.long-acting-row` CSS to the inline `<style>` block**

Open `packages/ui/index.html` and find the `.panel-row` rule (line 529, search `\.panel-row \{`). Insert this new block immediately after the existing `.panel-row` rules (the simplest insertion point is right before the next non-`.panel-row` selector — around line 555–565 — but anywhere in the `<style>` block works):

```css
    .long-acting-row {
      display: grid;
      grid-template-columns: 60px 1fr 50px 80px auto;
      gap: 6px;
      align-items: center;
      padding: 6px 8px;
      margin-bottom: 6px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-surface);
      transition: border-color 0.15s, background 0.15s;
    }
    .long-acting-row.active {
      border-color: var(--accent-green, #4caf50);
      background: rgba(76, 175, 80, 0.08);
    }
    .long-acting-row .la-row-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .long-acting-row select,
    .long-acting-row input {
      width: 100%;
      box-sizing: border-box;
    }
    .long-acting-row select:disabled,
    .long-acting-row input:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .long-acting-row .la-set-btn {
      padding: 4px 12px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--bg-surface);
      color: var(--text);
      cursor: pointer;
      font-size: 13px;
    }
    .long-acting-row.active .la-set-btn {
      border-color: var(--accent-green, #4caf50);
      color: var(--accent-green, #4caf50);
    }
    .long-acting-row.invalid {
      animation: la-shake 0.25s;
    }
    @keyframes la-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-3px); }
      75% { transform: translateX(3px); }
    }
```

If the existing CSS uses a different green token name (search for `--accent-` or similar), substitute it for `--accent-green`. If no green token exists, the literal `#4caf50` fallback is used.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/index.html
git commit -m "ui/index.html: dual-row MDI panel with Set/Unset toggle

Replaces the single auto-applying type/dose/time panel-rows with two
long-acting-row blocks (morning + evening). Each row has insulin dropdown
(Toujeo default), dose, time picker (slot-constrained 00:00–11:59 / 12:00–23:59),
and a Set button. CSS adds active state (green border + tint), disabled-input
styling, and a brief shake on invalid Set.

main.ts wiring lands in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Rewire `main.ts` for the new dual-slot UI

**Files:**
- Modify: `packages/ui/src/main.ts:148-150` (delete old element refs)
- Modify: `packages/ui/src/main.ts:440-466` (`onTherapyChange` and the change-listener loop)
- Modify: `packages/ui/src/main.ts:618-635` (`btnReset` handler)
- Add: helper module-scope functions for slot row management

- [ ] **Step 1: Replace the old element refs**

At lines 148-150 in `packages/ui/src/main.ts`, find:
```ts
const longActingType   = getEl<HTMLSelectElement>('long-acting-type');
const longActingDose   = getEl<HTMLInputElement>('long-acting-dose');
const longActingTime   = getEl<HTMLInputElement>('long-acting-time');
```

Replace with:
```ts
const laRowMorning = getEl<HTMLDivElement>('la-row-morning');
const laRowEvening = getEl<HTMLDivElement>('la-row-evening');
```

- [ ] **Step 2: Add `LongActingSchedule` and `LongActingType` to the type imports**

Find the `@cgmsim/shared` import block near the top of `main.ts` (search for `from '@cgmsim/shared'`) and add `LongActingSchedule` and `LongActingType` to the named imports.

- [ ] **Step 3: Add slot-row helper functions**

Insert this block immediately above `function onTherapyChange()` (the function currently at line 440):

```ts
type SlotName = 'morning' | 'evening';

interface SlotRowRefs {
  row:    HTMLDivElement;
  type:   HTMLSelectElement;
  dose:   HTMLInputElement;
  time:   HTMLInputElement;
  setBtn: HTMLButtonElement;
}

function getSlotRowRefs(row: HTMLDivElement): SlotRowRefs {
  return {
    row,
    type:   row.querySelector<HTMLSelectElement>('.la-type')!,
    dose:   row.querySelector<HTMLInputElement>('.la-dose')!,
    time:   row.querySelector<HTMLInputElement>('.la-time')!,
    setBtn: row.querySelector<HTMLButtonElement>('.la-set-btn')!,
  };
}

function readSlotSchedule(refs: SlotRowRefs, slot: SlotName): LongActingSchedule | null {
  const dose = parseFloat(refs.dose.value);
  const minute = timeStringToMinutes(refs.time.value);
  if (!Number.isFinite(dose) || dose < 1) return null;
  const lo = slot === 'morning' ? 0 : 12 * 60;
  const hi = slot === 'morning' ? 12 * 60 - 1 : 24 * 60 - 1;
  if (minute < lo || minute > hi) return null;
  return {
    type: refs.type.value as LongActingType,
    units: dose,
    injectionMinute: minute,
  };
}

/** Apply visual + control state for a slot. `schedule` non-null = Active (green, locked). */
function setSlotActiveState(refs: SlotRowRefs, schedule: LongActingSchedule | null): void {
  const isActive = schedule !== null;
  refs.row.classList.toggle('active', isActive);
  refs.type.disabled = isActive;
  refs.dose.disabled = isActive;
  refs.time.disabled = isActive;
  refs.setBtn.textContent = isActive ? 'Unset' : 'Set';
}

function shakeRow(refs: SlotRowRefs): void {
  refs.row.classList.remove('invalid');
  // Force reflow so the animation re-triggers on the next add
  void refs.row.offsetWidth;
  refs.row.classList.add('invalid');
}

const morningRefs = getSlotRowRefs(laRowMorning);
const eveningRefs = getSlotRowRefs(laRowEvening);
const slotRefs: Record<SlotName, SlotRowRefs> = {
  morning: morningRefs,
  evening: eveningRefs,
};

// Track active schedule per slot — null = unset
const activeSchedule: Record<SlotName, LongActingSchedule | null> = {
  morning: null,
  evening: null,
};

function setSlot(slot: SlotName, schedule: LongActingSchedule | null): void {
  activeSchedule[slot] = schedule;
  setSlotActiveState(slotRefs[slot], schedule);
  // Push the full pair into therapy each time
  bridge.setTherapyParam({
    longActingMorning: activeSchedule.morning,
    longActingEvening: activeSchedule.evening,
  });
}

function onSetUnsetClick(slot: SlotName): void {
  const refs = slotRefs[slot];
  if (activeSchedule[slot] !== null) {
    // Currently Active → Unset
    setSlot(slot, null);
    return;
  }
  // Currently Unset → validate and Set
  const schedule = readSlotSchedule(refs, slot);
  if (schedule === null) {
    shakeRow(refs);
    return;
  }
  setSlot(slot, schedule);
}

morningRefs.setBtn.addEventListener('click', () => onSetUnsetClick('morning'));
eveningRefs.setBtn.addEventListener('click', () => onSetUnsetClick('evening'));
```

- [ ] **Step 4: Update `onTherapyChange` to remove old long-acting field references**

In `onTherapyChange()` (currently lines 440-460), find the `bridge.setTherapyParam({ ... })` call. Remove these three lines:
```ts
    longActingType:          longActingType.value as 'Glargine' | 'Degludec' | 'Detemir',
    longActingDose:          parseFloat(longActingDose.value),
    longActingInjectionTime: timeStringToMinutes(longActingTime.value),
```

The Morning/Evening slots are managed independently by `setSlot()` — `onTherapyChange` no longer needs to push them.

- [ ] **Step 5: Update the change-listener registration loop**

At line 462-464, find:
```ts
[therapyMode, glucoseTarget, rapidAnalogue, progDIA,
 longActingType, longActingDose, longActingTime].forEach(el =>
  el.addEventListener('change', onTherapyChange)
);
```

Remove the three long-acting elements from this list:
```ts
[therapyMode, glucoseTarget, rapidAnalogue, progDIA].forEach(el =>
  el.addEventListener('change', onTherapyChange)
);
```

- [ ] **Step 6: Update the `btnReset` handler at lines 622-632**

Find the `bridge.reset({ ... })` call. In the inline `therapy:` literal, find:
```ts
             rapidAnalogue:'Fiasp',rapidDia:5,longActingType:'Glargine',longActingDose:20,
             longActingInjectionTime:22*60,glucoseTarget:100,enableSMB:false},
```

Replace with:
```ts
             rapidAnalogue:'Fiasp',rapidDia:5,longActingMorning:null,longActingEvening:null,
             glucoseTarget:100,enableSMB:false},
```

Then immediately after the `bridge.reset({...})` call (after line 632, before `renderer.clearHistory()`), reset the UI state:
```ts
  setSlot('morning', null);
  setSlot('evening', null);
```

- [ ] **Step 7: Build the standalone**

```bash
npm run build:standalone
```

Expected: build succeeds, no TS errors. Output path: `packages/ui/dist/cgmsim-v4-standalone.html`.

If TS errors appear, re-check Tasks 1, 5, 6, 7 for type-name consistency.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/main.ts
git commit -m "ui/main: wire dual-slot Set/Unset toggle for long-acting

Replaces the auto-applying long-acting form with explicit Set/Unset gestures
per slot. setSlot() pushes both slots into therapy as a pair; setSlotActiveState
toggles green active styling and disables inputs. Validation rejects out-of-window
times and dose < 1U with a shake animation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Manual verification + final standalone build

**Files:**
- Re-run: build, tests, dev server
- Modify: `packages/ui/dist/cgmsim-v4-standalone.html` (rebuilt artifact)

- [ ] **Step 1: Full typecheck across all packages**

```bash
npm run typecheck 2>&1 | tail -30
```

Expected: clean. Any errors here are real bugs to fix before proceeding — re-read the failing message and re-check the spec/Tasks 1–7.

- [ ] **Step 2: Run the full test suite**

```bash
npm run test
```

Expected: all 100+ tests pass, including the five new ones from Task 2.

- [ ] **Step 3: Rebuild standalone**

```bash
npm run build:standalone
```

Expected: produces `packages/ui/dist/cgmsim-v4-standalone.html`.

- [ ] **Step 4: Manual smoke test in browser**

Open the standalone HTML in a browser:
```bash
xdg-open packages/ui/dist/cgmsim-v4-standalone.html  # Linux
# or: explorer.exe packages/ui/dist/cgmsim-v4-standalone.html  # WSL
```

Run through these steps and confirm each:

1. **Default state:** Switch therapy mode to **MDI**. Both Morning and Evening rows are visible, gray border, "Set" button label, controls enabled. No basal insulin running.
2. **Time validation:** Try to type `15:00` into the Morning time input — the browser picker should not allow it; if pasted manually, pressing Set should trigger the shake animation and the row stays gray.
3. **Set Morning:** Pick `GlargineU300`, dose `20`, time `08:00`. Press Set. Row turns green, button now reads "Unset", controls are disabled.
4. **Set Evening:** Same as above but with time `22:00`. Both rows green.
5. **Run sim:** Press Resume. Run the sim forward (throttle ×100 or higher). At simulated 08:00 you should see a long-acting injection event marker on the canvas (and IOB rises). Same at 22:00.
6. **Unset Morning mid-sim:** Press Unset on Morning row. Row goes gray, controls re-enabled. Tomorrow's 08:00 injection should NOT fire. Already-injected morning depot continues to decay (visible in IOB).
7. **Re-Set with different insulin:** Change Morning insulin to `Detemir`, dose `30`, press Set. Verify row goes green; tomorrow's 08:00 fires Detemir.
8. **Reset button:** Press Reset → confirm. Both rows return to gray (default state, nothing scheduled).
9. **Mode switch:** Switch to PUMP — `#section-mdi` hides. Switch back to MDI — rows reappear, in whatever state they were in (slots persist across mode toggles).

If any step fails: capture the error from devtools console, re-read the relevant task, fix, rebuild, retry.

- [ ] **Step 5: Commit the rebuilt standalone**

```bash
git add packages/ui/dist/cgmsim-v4-standalone.html
git commit -m "build: rebuild standalone with dual-slot long-acting MDI

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Done

The work is complete when:

- All 8 tasks are committed
- `npm run typecheck` is clean
- `npm run test` is green (≥107 tests — the original 102 plus the 5 new long-acting ones)
- `packages/ui/dist/cgmsim-v4-standalone.html` is rebuilt and committed
- Manual smoke test from Task 8 passes all 9 steps

If the user wants follow-up work (e.g., adding a third "lunch" slot, or extracting the v3 PK formulas into a reusable module shared with v3), that's a fresh spec → plan → implementation cycle.
