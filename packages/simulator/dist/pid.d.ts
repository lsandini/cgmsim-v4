/**
 * PID Controller for AID therapy mode.
 *
 * Ported from @lsandini/cgmsim-lib PID controller implementation.
 * Receives the noisy CGM signal (not true glucose) — physiologically accurate
 * and pedagogically important (controller reacts to sensor artefacts).
 *
 * Includes a fuzzy-logic microbolus layer that adds small correction boluses
 * when both PID output and glucose trajectory agree a bolus is warranted.
 *
 * Returns the insulin delivery rate for this tick in U/hr.
 */
import type { TherapyProfile } from '@cgmsim/shared';
export interface PIDState {
    integral: number;
    prevCGM: number;
}
export interface PIDOutput {
    rateUPerHour: number;
    /** Updated PID state to store back into WorkerState. */
    nextState: PIDState;
    /** Microbolus delivered this tick (units), if any. */
    microbolusUnits: number;
}
/**
 * Run one tick of the PID controller.
 *
 * @param cgm           Current CGM reading (noisy, mg/dL)
 * @param iob           Current IOB (units)
 * @param therapy       Current therapy profile (for target and programmed ISF)
 * @param state         PID state from previous tick
 * @param basalRateUPerHour  Current scheduled basal rate (U/hr)
 */
export declare function runPID(cgm: number, iob: number, therapy: TherapyProfile, state: PIDState, basalRateUPerHour: number): PIDOutput;
/**
 * Convert AID basal rate to a 5-minute micro-bolus equivalent.
 * Pump delivers basal as micro-boluses every TICK_MINUTES.
 */
export declare function rateToMicroBolus(rateUPerHour: number): number;
//# sourceMappingURL=pid.d.ts.map