/**
 * CGMSIM v4 — WebWorker Simulation Engine
 *
 * This worker owns all simulation state. It is the only component that
 * runs the physiological model. The main thread communicates exclusively
 * through the typed postMessage interface defined in @cgmsim/shared.
 *
 * Architecture (per spec §7.1):
 *   - Long-lived; resets via RESET message rather than re-creation
 *   - No network access
 *   - Tick loop driven by setInterval at interval = 300_000ms / throttle
 *   - One CGM reading produced per tick (5 simulated minutes)
 */
export {};
//# sourceMappingURL=worker.d.ts.map