/**
 * InlineSimulator — simulation engine running on the main thread.
 *
 * Phase 2 additions over Phase 1:
 *   - activeLongActing properly typed and populated (MDI depot)
 *   - MDI: long-acting dose auto-injected at configured time each simulated day
 *   - Temp basal: timed override with automatic expiry
 *   - Proper IOB accounting for all therapy modes
 *   - Event log for canvas markers (bolus/meal events)
 */
import { DEFAULT_PATIENT, DEFAULT_THERAPY_PROFILE } from '@cgmsim/shared';
import { createG6NoiseGenerator } from '../../simulator/src/g6Noise.js';
import { computeDeltaBG } from '../../simulator/src/deltaBG.js';
import { calculateBolusIOB, calculateLongActingIOB, calculatePumpBasalIOB, } from '../../simulator/src/iob.js';
import { calculateCOB, purgeAbsorbedMeals, resolveMealSplit } from '../../simulator/src/carbs.js';
import { runPID, rateToMicroBolus } from '../../simulator/src/pid.js';
import { RAPID_PROFILES, LONG_ACTING_PROFILES } from '../../simulator/src/insulinProfiles.js';
const TICK_SIM_MINUTES = 5;
const TICK_SIM_MS = TICK_SIM_MINUTES * 60_000;
function randomSeed() { return (Date.now() ^ (Math.random() * 0xFFFF_FFFF) >>> 0) || 1; }
const INITIAL_BG = 100;
function createInitialState() {
    return {
        simTimeMs: 0,
        trueGlucose: INITIAL_BG,
        lastCGM: INITIAL_BG,
        patient: { ...DEFAULT_PATIENT },
        therapy: { ...DEFAULT_THERAPY_PROFILE, basalProfile: [{ timeMinutes: 0, rateUPerHour: 0.8 }] },
        activeBoluses: [],
        activeMeals: [],
        activeLongActing: [],
        resolvedMeals: [],
        pumpMicroBoluses: [],
        pidCGMHistory: [],
        pidPrevRate: 0.8,
        pidTicksSinceLastMB: 999,
        throttle: 10,
        running: false,
        g6: createG6NoiseGenerator(randomSeed(), null),
        rngState: randomSeed(),
        lastLongActingDay: -1,
        tempBasal: null,
        events: [],
    };
}
function lcgNext(s) {
    const n = (1664525 * s + 1013904223) & 0xffffffff;
    return { value: (n >>> 0) / 0xffffffff, nextState: n };
}
export class InlineSimulator {
    s = createInitialState();
    rafId = null;
    lastTickWallMs = 0;
    tickHandlers = [];
    savedHandlers = [];
    eventHandlers = [];
    onTick(h) { this.tickHandlers.push(h); }
    onStateSaved(h) { this.savedHandlers.push(h); }
    onEvent(h) { this.eventHandlers.push(h); }
    getBasalRate(simTimeMs) {
        const s = this.s;
        if (s.tempBasal !== null) {
            if (simTimeMs < s.tempBasal.expiresAt)
                return s.tempBasal.rateUPerHour;
            s.tempBasal = null;
        }
        const minuteOfDay = (simTimeMs / 60_000) % (24 * 60);
        const profile = s.therapy.basalProfile;
        let rate = profile[0]?.rateUPerHour ?? 0.8;
        for (const e of profile)
            if (e.timeMinutes <= minuteOfDay)
                rate = e.rateUPerHour;
        return rate;
    }
    checkLongActingDose() {
        const s = this.s;
        if (s.therapy.mode !== 'MDI')
            return;
        const minuteOfDay = (s.simTimeMs / 60_000) % (24 * 60);
        const simDay = Math.floor(s.simTimeMs / (24 * 60 * 60_000));
        const injectionMinute = s.therapy.longActingInjectionTime;
        if (minuteOfDay >= injectionMinute && simDay !== s.lastLongActingDay) {
            s.lastLongActingDay = simDay;
            s.activeLongActing.push({
                id: `la-${s.simTimeMs}`, simTimeMs: s.simTimeMs,
                units: s.therapy.longActingDose, type: s.therapy.longActingType,
            });
            const ev = {
                kind: 'longActing', simTimeMs: s.simTimeMs,
                units: s.therapy.longActingDose, insulinType: s.therapy.longActingType,
            };
            s.events.push(ev);
            for (const h of this.eventHandlers)
                h([ev]);
        }
    }
    tick() {
        const s = this.s;
        const nowMs = s.simTimeMs;
        const isPump = s.therapy.mode === 'PUMP' || s.therapy.mode === 'AID';
        this.checkLongActingDose();
        // Purge expired
        s.activeBoluses = s.activeBoluses.filter(b => (nowMs - b.simTimeMs) / 60_000 <= b.dia * 60);
        s.activeLongActing = s.activeLongActing.filter(d => {
            const p = LONG_ACTING_PROFILES[d.type];
            return p !== undefined && (nowMs - d.simTimeMs) / 60_000 <= p.dia * 60;
        });
        s.resolvedMeals = purgeAbsorbedMeals(s.resolvedMeals, s.patient.carbsAbsTime, nowMs);
        s.pumpMicroBoluses = s.pumpMicroBoluses.filter(mb => (nowMs - mb.simTimeMs) / 60_000 <= mb.dia * 60);
        let basalRate = this.getBasalRate(nowMs);
        if (s.therapy.mode === 'AID') {
            const totalIOB = calculateBolusIOB(s.activeBoluses, nowMs)
                + calculatePumpBasalIOB(s.pumpMicroBoluses, nowMs);
            const rp = RAPID_PROFILES[s.therapy.rapidAnalogue];
            const pidState = {
                cgmHistory: s.pidCGMHistory,
                prevRate: s.pidPrevRate,
                ticksSinceLastMB: s.pidTicksSinceLastMB,
            };
            const pid = runPID(s.lastCGM, totalIOB, s.therapy, pidState, basalRate, rp?.peak ?? 55);
            basalRate = pid.rateUPerHour;
            s.pidCGMHistory = pid.nextState.cgmHistory;
            s.pidPrevRate = pid.nextState.prevRate;
            s.pidTicksSinceLastMB = pid.nextState.ticksSinceLastMB;
            if (pid.microbolusUnits > 0) {
                s.activeBoluses.push({
                    id: `mb-${nowMs}`, simTimeMs: nowMs,
                    units: pid.microbolusUnits, analogue: s.therapy.rapidAnalogue,
                    dia: s.therapy.rapidDia,
                });
                const smbEv = { kind: 'smb', simTimeMs: nowMs, units: pid.microbolusUnits };
                s.events.push(smbEv);
                for (const h of this.eventHandlers)
                    h([smbEv]);
            }
        }
        if (isPump) {
            const rp = RAPID_PROFILES[s.therapy.rapidAnalogue];
            if (rp) {
                const u = rateToMicroBolus(basalRate);
                if (u > 0)
                    s.pumpMicroBoluses.push({ simTimeMs: nowMs, units: u, dia: s.therapy.rapidDia, peak: rp.peak });
            }
        }
        const delta = computeDeltaBG({
            patient: s.patient, isf: s.patient.trueISF, cr: s.patient.trueCR,
            boluses: s.activeBoluses, longActing: s.activeLongActing,
            pumpMicroBoluses: s.pumpMicroBoluses, meals: s.resolvedMeals,
            nowSimTimeMs: nowMs, isPump,
            currentGlucose: s.trueGlucose,
        });
        const newTrue = Math.max(20, Math.min(600, s.trueGlucose + delta.deltaBG));
        const noisy = s.g6.applySensorModel(newTrue, nowMs);
        const cgm = Math.max(40, Math.min(400, Math.round(noisy)));
        const iob = calculateBolusIOB(s.activeBoluses, nowMs) +
            (isPump ? calculatePumpBasalIOB(s.pumpMicroBoluses, nowMs)
                : calculateLongActingIOB(s.activeLongActing, nowMs));
        const cob = calculateCOB(s.resolvedMeals, s.patient.carbsAbsTime, nowMs);
        s.trueGlucose = newTrue;
        s.lastCGM = cgm;
        s.simTimeMs = nowMs + TICK_SIM_MS;
        const snap = {
            type: 'TICK', simTimeMs: s.simTimeMs, cgm, trueGlucose: newTrue,
            iob: Math.round(iob * 100) / 100, cob: Math.round(cob * 10) / 10,
            deltaMinutes: 5, trend: delta.deltaBG / TICK_SIM_MINUTES, basalRate,
        };
        for (const h of this.tickHandlers)
            h(snap);
    }
    rafLoop(wallNow) {
        if (!this.s.running)
            return;
        const intervalMs = TICK_SIM_MS / this.s.throttle;
        const ticksDue = Math.floor((wallNow - this.lastTickWallMs) / intervalMs);
        const ticksToRun = Math.min(ticksDue, 50); // cap catch-up after tab was hidden
        for (let i = 0; i < ticksToRun; i++)
            this.tick();
        if (ticksToRun > 0)
            this.lastTickWallMs += ticksToRun * intervalMs;
        this.rafId = requestAnimationFrame((t) => this.rafLoop(t));
    }
    resume() {
        this.s.running = true;
        this.tick();
        this.lastTickWallMs = performance.now();
        this.rafId = requestAnimationFrame((t) => this.rafLoop(t));
    }
    pause() {
        this.s.running = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }
    setThrottle(throttle) {
        this.s.throttle = throttle;
        // Reset reference point to avoid a burst of catch-up ticks at the new rate
        if (this.s.running)
            this.lastTickWallMs = performance.now();
    }
    bolus(units, analogue) {
        this.s.activeBoluses.push({
            id: `bolus-${this.s.simTimeMs}-${Math.random().toString(36).slice(2)}`,
            simTimeMs: this.s.simTimeMs, units,
            analogue: analogue ?? this.s.therapy.rapidAnalogue,
            dia: this.s.therapy.rapidDia,
        });
        const ev = { kind: 'bolus', simTimeMs: this.s.simTimeMs, units };
        this.s.events.push(ev);
        for (const h of this.eventHandlers)
            h([ev]);
    }
    meal(carbsG, gastricEmptyingRate) {
        const meal = {
            id: `meal-${this.s.simTimeMs}-${Math.random().toString(36).slice(2)}`,
            simTimeMs: this.s.simTimeMs, carbsG,
            gastricEmptyingRate: gastricEmptyingRate ?? this.s.patient.gastricEmptyingRate,
        };
        const { value, nextState } = lcgNext(this.s.rngState);
        this.s.rngState = nextState;
        this.s.resolvedMeals.push(resolveMealSplit(meal, value));
        this.s.activeMeals.push(meal);
        const ev = { kind: 'meal', simTimeMs: this.s.simTimeMs, carbsG };
        this.s.events.push(ev);
        for (const h of this.eventHandlers)
            h([ev]);
    }
    setTempBasal(rateUPerHour, durationMinutes) {
        this.s.tempBasal = {
            rateUPerHour,
            expiresAt: durationMinutes !== undefined
                ? this.s.simTimeMs + durationMinutes * 60_000
                : Infinity,
        };
    }
    cancelTempBasal() { this.s.tempBasal = null; }
    setTarget(targetMgdL) { this.s.therapy.glucoseTarget = targetMgdL; }
    setPatientParam(patch) { Object.assign(this.s.patient, patch); }
    setTherapyParam(patch) { Object.assign(this.s.therapy, patch); }
    getEvents() { return [...this.s.events]; }
    requestSave() {
        const state = {
            simTimeMs: this.s.simTimeMs, trueGlucose: this.s.trueGlucose, lastCGM: this.s.lastCGM,
            patient: { ...this.s.patient }, therapy: { ...this.s.therapy },
            g6State: this.s.g6.getState(),
            activeBoluses: [...this.s.activeBoluses], activeMeals: [...this.s.activeMeals],
            activeLongActing: [...this.s.activeLongActing],
            pidCGMHistory: [...this.s.pidCGMHistory],
            pidPrevRate: this.s.pidPrevRate,
            pidTicksSinceLastMB: this.s.pidTicksSinceLastMB,
            throttle: this.s.throttle, running: this.s.running,
        };
        for (const h of this.savedHandlers)
            h(state);
    }
    reset(state) {
        this.pause();
        Object.assign(this.s, {
            simTimeMs: state.simTimeMs, trueGlucose: state.trueGlucose, lastCGM: state.lastCGM,
            patient: { ...state.patient }, therapy: { ...state.therapy },
            activeBoluses: [...state.activeBoluses], activeMeals: [...state.activeMeals],
            activeLongActing: [...state.activeLongActing],
            resolvedMeals: [], pumpMicroBoluses: [],
            pidCGMHistory: [...(state.pidCGMHistory ?? [])],
            pidPrevRate: state.pidPrevRate ?? 0.8,
            pidTicksSinceLastMB: state.pidTicksSinceLastMB ?? 999,
            throttle: state.throttle, running: false,
            g6: createG6NoiseGenerator(1, state.g6State),
            rngState: randomSeed(), lastLongActingDay: -1, tempBasal: null, events: [],
        });
    }
    terminate() { this.pause(); }
}
//# sourceMappingURL=inline-simulator.js.map