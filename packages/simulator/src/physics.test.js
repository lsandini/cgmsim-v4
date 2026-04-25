/**
 * Physics correctness tests — ensure simulator matches v3 cgmsim-lib behaviour.
 *
 * Reference: @lsandini/cgmsim-lib liver.js + sgv.js
 *   EGP_mgdl/min = (ISF/CR) × 0.002 × weight × sinus
 *   sinus = 1 + 0.2 × sin(2π × hour / 24), range [0.8, 1.2], peak 6 AM
 *   At sinus=1 (midnight): 0.75 U/h pump basal → steady state for ISF=40, CR=12, weight=75
 */
import { describe, it, expect } from 'vitest';
import { calculateEGP } from './egp.js';
import { rateToMicroBolus, runPID, calculateEquilibriumIOB } from './pid.js';
import { DEFAULT_PATIENT, DEFAULT_THERAPY_PROFILE } from '@cgmsim/shared';
import { computeDeltaBG } from './deltaBG.js';
import { getExpTreatmentActivity, getExpTreatmentIOB } from './utils.js';
import { calculatePumpBasalIOB, calculateBolusIOB } from './iob.js';
import { RAPID_PROFILES } from './insulinProfiles.js';
// Midnight in simulation time (simTimeMs=0 → minuteOfDay=0 → hour=0)
const MIDNIGHT_MS = 0;
describe('EGP model — v3 liver parity', () => {
    it('produces ~2.5 mg/dL per 5-min tick for default patient at midnight', () => {
        // v3 reference: EGP = (ISF/CR) × 0.002 × weight × sinus × 5 min
        // = (40/12) × 0.002 × 75 × 1.0 × 5 = 2.5 mg/dL
        const egp = calculateEGP(DEFAULT_PATIENT, MIDNIGHT_MS, DEFAULT_PATIENT.trueISF);
        expect(egp).toBeCloseTo(2.5, 1);
    });
    it('peaks ~20% above midnight level at 6 AM', () => {
        const SIX_AM_MS = 6 * 60 * 60_000; // 6 hours in simulation ms
        const egpMidnight = calculateEGP(DEFAULT_PATIENT, MIDNIGHT_MS, DEFAULT_PATIENT.trueISF);
        const egpSixAm = calculateEGP(DEFAULT_PATIENT, SIX_AM_MS, DEFAULT_PATIENT.trueISF);
        // sinus at 6 AM = 1 + 0.2 × sin(π/2) = 1.2 → 20% higher than midnight
        expect(egpSixAm / egpMidnight).toBeCloseTo(1.2, 2);
    });
});
describe('rateToMicroBolus — 5-minute tick', () => {
    it('delivers 5/60 U per tick for 1 U/h', () => {
        // Pump at 1 U/h over a 5-minute tick = 5/60 U
        expect(rateToMicroBolus(1)).toBeCloseTo(5 / 60, 6);
    });
    it('delivers 0 for 0 U/h', () => {
        expect(rateToMicroBolus(0)).toBe(0);
    });
});
// ── v3 reference implementations for comparison ─────────────────────────────
function v3Activity(peak, duration, minutesAgo, units) {
    const tau = (peak * (1 - peak / duration)) / (1 - (2 * peak) / duration);
    const S = 1 / (1 - (2 * tau / duration) + (1 + (2 * tau / duration)) * Math.exp(-duration / tau));
    let act = units * (S / (tau * tau)) * minutesAgo * (1 - minutesAgo / duration) * Math.exp(-minutesAgo / tau);
    if (act <= 0)
        return 0;
    if (minutesAgo < 15)
        return act * (minutesAgo / 15);
    return act;
}
function v3IOB(peak, duration, minutesAgo, units) {
    if (minutesAgo >= duration)
        return 0;
    const tau = (peak * (1 - peak / duration)) / (1 - (2 * peak) / duration);
    const a = (2 * tau) / duration;
    const S = 1 / (1 - a + (1 + a) * Math.exp(-duration / tau));
    let iobFraction = 1 - S * (1 - a) *
        ((minutesAgo * minutesAgo / (tau * duration * (1 - a)) - minutesAgo / tau - 1) *
            Math.exp(-minutesAgo / tau) + 1);
    if (minutesAgo < 15)
        iobFraction = 1 - (minutesAgo / 15) * (1 - iobFraction);
    return Math.max(0, units * iobFraction);
}
// Fiasp profile
const PEAK = 55, DIA_MIN = 300;
describe('getExpTreatmentActivity — v3 parity (biexponential + 15-min ramp)', () => {
    it('matches v3 at t=0 (zero activity)', () => {
        expect(getExpTreatmentActivity({ peak: PEAK, duration: DIA_MIN, minutesAgo: 0, units: 1 }))
            .toBeCloseTo(v3Activity(PEAK, DIA_MIN, 0, 1), 8);
    });
    it('matches v3 at t=7.5 min (mid ramp-up)', () => {
        expect(getExpTreatmentActivity({ peak: PEAK, duration: DIA_MIN, minutesAgo: 7.5, units: 1 }))
            .toBeCloseTo(v3Activity(PEAK, DIA_MIN, 7.5, 1), 6);
    });
    it('matches v3 at t=55 min (peak)', () => {
        expect(getExpTreatmentActivity({ peak: PEAK, duration: DIA_MIN, minutesAgo: 55, units: 1 }))
            .toBeCloseTo(v3Activity(PEAK, DIA_MIN, 55, 1), 6);
    });
    it('matches v3 at t=150 min (descending)', () => {
        expect(getExpTreatmentActivity({ peak: PEAK, duration: DIA_MIN, minutesAgo: 150, units: 1 }))
            .toBeCloseTo(v3Activity(PEAK, DIA_MIN, 150, 1), 6);
    });
});
describe('getExpTreatmentIOB — v3 parity (analytical biexponential)', () => {
    it('equals 1.0 at t=0 (full IOB)', () => {
        expect(getExpTreatmentIOB({ peak: PEAK, duration: DIA_MIN, minutesAgo: 0, units: 1 }))
            .toBeCloseTo(v3IOB(PEAK, DIA_MIN, 0, 1), 6);
    });
    it('matches v3 at t=7.5 min (ramp-up region)', () => {
        expect(getExpTreatmentIOB({ peak: PEAK, duration: DIA_MIN, minutesAgo: 7.5, units: 1 }))
            .toBeCloseTo(v3IOB(PEAK, DIA_MIN, 7.5, 1), 6);
    });
    it('matches v3 at t=55 min (post-peak)', () => {
        expect(getExpTreatmentIOB({ peak: PEAK, duration: DIA_MIN, minutesAgo: 55, units: 1 }))
            .toBeCloseTo(v3IOB(PEAK, DIA_MIN, 55, 1), 6);
    });
    it('matches v3 at t=150 min', () => {
        expect(getExpTreatmentIOB({ peak: PEAK, duration: DIA_MIN, minutesAgo: 150, units: 1 }))
            .toBeCloseTo(v3IOB(PEAK, DIA_MIN, 150, 1), 6);
    });
    it('equals 0 at t=DIA (expired)', () => {
        expect(getExpTreatmentIOB({ peak: PEAK, duration: DIA_MIN, minutesAgo: DIA_MIN, units: 1 }))
            .toBe(0);
    });
    it('steady-state pump IOB ≈ 1.28 U at 0.8 U/h', () => {
        // v3 steady-state IOB: 0.8 U/h × 5-min micro-boluses, 60 in DIA window
        const units = 0.8 * 5 / 60;
        let iob = 0;
        for (let k = 0; k < 60; k++)
            iob += v3IOB(PEAK, DIA_MIN, k * 5, units);
        const v4iob = (() => {
            const mbs = Array.from({ length: 60 }, (_, k) => ({
                simTimeMs: k * 5 * 60_000, units, dia: 5, peak: PEAK,
            }));
            return calculatePumpBasalIOB(mbs, 59 * 5 * 60_000);
        })();
        // Both should match each other (v4 uses same formula as v3 after fix)
        expect(v4iob).toBeCloseTo(iob, 3);
    });
});
describe('calculateBolusIOB — respects per-bolus DIA, not hard-coded profile', () => {
    it('returns 0 at t=200 min when bolus DIA is 3 h (not the 5 h Fiasp profile)', () => {
        // With Fiasp profile DIA=5h (300 min), IOB at 200 min is still ~0.17 U.
        // If DIA is stamped as 3h (180 min) on the bolus, IOB must be 0 past that.
        const bolus = {
            id: 'test', simTimeMs: 0, units: 1, analogue: 'Fiasp', dia: 3,
        };
        expect(calculateBolusIOB([bolus], 200 * 60_000)).toBe(0);
    });
    it('uses the stamped DIA for a shorter-than-profile duration', () => {
        const bolus = { id: 'test', simTimeMs: 0, units: 1, analogue: 'Fiasp', dia: 4 };
        // At t=4h (240 min) exactly, IOB should be 0 (dia=4h)
        expect(calculateBolusIOB([bolus], 4 * 60 * 60_000)).toBe(0);
        // At t=3h (180 min) it should still have residual IOB
        expect(calculateBolusIOB([bolus], 3 * 60 * 60_000)).toBeGreaterThan(0);
    });
});
describe('runPID — v3 PID-IFB parity', () => {
    const BASE_RATE = 0.8; // U/hr
    const FIASP_PEAK = RAPID_PROFILES['Fiasp'].peak; // 55 min
    const TARGET = DEFAULT_THERAPY_PROFILE.glucoseTarget;
    const flatState = (rate) => ({
        cgmHistory: Array(24).fill(TARGET),
        prevRate: rate,
        ticksSinceLastMB: 999,
    });
    it('suspends to exactly 0 U/hr at glucose ≤ 70 mg/dL', () => {
        const result = runPID(70, 1.0, DEFAULT_THERAPY_PROFILE, flatState(BASE_RATE), BASE_RATE, FIASP_PEAK);
        expect(result.rateUPerHour).toBe(0);
    });
    it('never goes below 0.1 U/hr when glucose is above suspend threshold', () => {
        // Heavy excess IOB should not zero out the basal; 0.1 U/hr is the floor
        const eqIOB = calculateEquilibriumIOB(BASE_RATE, DEFAULT_THERAPY_PROFILE.rapidDia, FIASP_PEAK);
        const result = runPID(80, eqIOB + 5, DEFAULT_THERAPY_PROFILE, flatState(BASE_RATE), BASE_RATE, FIASP_PEAK);
        expect(result.rateUPerHour).toBeGreaterThanOrEqual(0.1);
    });
    it('at target with equilibrium IOB and flat CGM history, delivers base basal unchanged', () => {
        // All error terms = 0, excess IOB = 0 → output = base basal
        const eqIOB = calculateEquilibriumIOB(BASE_RATE, DEFAULT_THERAPY_PROFILE.rapidDia, FIASP_PEAK);
        const result = runPID(TARGET, eqIOB, DEFAULT_THERAPY_PROFILE, flatState(BASE_RATE), BASE_RATE, FIASP_PEAK);
        expect(result.rateUPerHour).toBeCloseTo(BASE_RATE, 1);
    });
    it('excess IOB of 1 U reduces rate by 0.72 U/hr (insulin feedback gain)', () => {
        // At target, flat history, excessIOB = 1 → feedback = 0.72 → rawRate = 0.08, floored to 0.1
        const eqIOB = calculateEquilibriumIOB(BASE_RATE, DEFAULT_THERAPY_PROFILE.rapidDia, FIASP_PEAK);
        const result = runPID(TARGET, eqIOB + 1, DEFAULT_THERAPY_PROFILE, flatState(BASE_RATE), BASE_RATE, FIASP_PEAK);
        expect(result.rateUPerHour).toBeCloseTo(0.1, 1);
    });
    it('rate-of-change is limited to 1 U/hr per tick', () => {
        // Error large enough to demand > 1 U/hr above current rate
        const state = flatState(0.8);
        const result = runPID(300, 0, DEFAULT_THERAPY_PROFILE, state, 0.8, FIASP_PEAK);
        expect(result.rateUPerHour).toBeLessThanOrEqual(0.8 + 1.0 + 0.05); // +0.05 for rounding
    });
    it('with enableSMB false, microbolusUnits is always 0 even on rapid rise', () => {
        const therapy = { ...DEFAULT_THERAPY_PROFILE, enableSMB: false };
        const state = { cgmHistory: [100, 110, 120, 130], prevRate: BASE_RATE, ticksSinceLastMB: 999 };
        const result = runPID(150, 0, therapy, state, BASE_RATE, FIASP_PEAK);
        expect(result.microbolusUnits).toBe(0);
    });
    it('with enableSMB true, microbolus fires on rapid rise (≥2 mg/dL/min)', () => {
        const therapy = { ...DEFAULT_THERAPY_PROFILE, enableSMB: true };
        // prevCGM = last in history = 130; cgm = 140; rise = 10/5 = 2 mg/dL/min
        const state = { cgmHistory: [120, 125, 128, 130], prevRate: BASE_RATE, ticksSinceLastMB: 999 };
        const result = runPID(140, 0, therapy, state, BASE_RATE, FIASP_PEAK);
        expect(result.microbolusUnits).toBe(0.2);
    });
    it('with enableSMB true, Rule 3 fires 0.1 U when BG sustained ≥130 for 30 min with no rapid rise', () => {
        const therapy = { ...DEFAULT_THERAPY_PROFILE, enableSMB: true };
        // Flat at 135 for 24 ticks (history all 135), no rise → rules 1 & 2 do not fire, rule 3 does
        const state = {
            cgmHistory: Array(24).fill(135),
            prevRate: BASE_RATE,
            ticksSinceLastMB: 999,
        };
        const result = runPID(135, 0, therapy, state, BASE_RATE, FIASP_PEAK);
        expect(result.microbolusUnits).toBe(0.1);
    });
    it('calculateEquilibriumIOB matches steady-state pump IOB (insulin feedback must activate)', () => {
        // The steady-state test in the deltaBG suite shows ~1.28 U at 0.8 U/hr Fiasp.
        // If equilibriumIOB >> actual steady-state IOB, excessIOB is always 0 and
        // the insulin feedback is permanently disabled — this test guards against that.
        const eq = calculateEquilibriumIOB(BASE_RATE, DEFAULT_THERAPY_PROFILE.rapidDia, FIASP_PEAK);
        // Must be close to the numerical steady-state value, not 3x larger
        expect(eq).toBeGreaterThan(0.8);
        expect(eq).toBeLessThan(2.0); // old broken formula returned ~3.05 — that must not happen
    });
});
describe('deltaBG steady state — pump at ~0.75 U/h', () => {
    /**
     * Run a pure-pump simulation for long enough to reach steady state (≥5 DIA).
     * At steady state, net deltaBG ≈ 0 with basal rate = 0.75 U/h (default patient).
     *
     * We run 400 ticks (2000 sim-min = 33 sim-hours, > 5h DIA for Fiasp).
     * Then check that deltaBG at the target rate is approximately zero.
     */
    it('net deltaBG ≈ 0 at ~0.75 U/h after reaching steady state', () => {
        const { PumpBasalBolus } = (() => {
            // We build the micro-bolus array manually
            return { PumpBasalBolus: null };
        })();
        const { RAPID_PROFILES } = (() => {
            const r = { Fiasp: { peak: 55, dia: 5 }, Lispro: { peak: 75, dia: 5 }, Aspart: { peak: 75, dia: 5 } };
            return { RAPID_PROFILES: r };
        })();
        const TICK_MS = 5 * 60_000;
        const TARGET_RATE = 0.75; // U/h
        const microBoluses = [];
        // Run 400 ticks to reach steady state
        let nowMs = 0;
        for (let i = 0; i < 400; i++) {
            const units = rateToMicroBolus(TARGET_RATE);
            microBoluses.push({ simTimeMs: nowMs, units, dia: RAPID_PROFILES['Fiasp'].dia, peak: RAPID_PROFILES['Fiasp'].peak });
            nowMs += TICK_MS;
        }
        // Purge micro-boluses older than DIA
        const diaMs = RAPID_PROFILES['Fiasp'].dia * 60 * 60_000;
        const activeMBs = microBoluses.filter(mb => nowMs - mb.simTimeMs <= diaMs);
        const result = computeDeltaBG({
            patient: DEFAULT_PATIENT,
            isf: DEFAULT_PATIENT.trueISF,
            cr: DEFAULT_PATIENT.trueCR,
            boluses: [],
            longActing: [],
            pumpMicroBoluses: activeMBs,
            meals: [],
            nowSimTimeMs: nowMs,
            isPump: true,
            currentGlucose: 100,
        });
        // At steady state, deltaBG should be near zero (within ±0.5 mg/dL per tick)
        expect(Math.abs(result.deltaBG)).toBeLessThan(0.5);
    });
});
//# sourceMappingURL=physics.test.js.map