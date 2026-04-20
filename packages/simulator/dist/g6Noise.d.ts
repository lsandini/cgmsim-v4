/**
 * Dexcom G6 CGM Sensor Noise Model — TypeScript port
 *
 * Based on Vettoretti 2019 / Facchinetti 2014 model.
 * Original JS from LoopInsighT1 (MIT License), adapted for CGMSIM v4.
 *
 * Two AR(2) autoregressive processes:
 *   v  — sensor-specific noise component
 *   cc — common component across sensors
 * Plus deterministic drift polynomials a(t) and b(t).
 *
 * State is fully serialisable so save/restore and comparison-run seeding work.
 */
import type { G6NoiseState } from '@cgmsim/shared';
export declare class DexcomG6Noise {
    private rng;
    private v;
    private cc;
    private tCalib;
    constructor(seed?: number, state?: G6NoiseState | null);
    getState(): G6NoiseState;
    setState(state: G6NoiseState): void;
    /**
     * Advance the AR model one step and return the stochastic noise (mg/dL).
     * Call once per 5-minute simulation tick.
     */
    getNextNoise(): number;
    /**
     * Apply the full sensor model to a true glucose value.
     * Includes deterministic drift + stochastic noise.
     * @param trueGlucose mg/dL
     * @param simTimeMs current simulated timestamp (ms) — used for drift polynomial
     */
    applySensorModel(trueGlucose: number, simTimeMs: number): number;
    resetCalibration(simTimeMs: number): void;
}
/**
 * Create a seeded noise generator.
 * @param seed integer seed (e.g. derived from scenario ID or hash)
 * @param state optional saved state for restore / comparison runs
 */
export declare function createG6NoiseGenerator(seed: number, state?: G6NoiseState | null): DexcomG6Noise;
//# sourceMappingURL=g6Noise.d.ts.map