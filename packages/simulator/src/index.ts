// packages/simulator public API
// Exports the physics-engine utilities consumed by the UI package
// (InlineSimulator) and by the Vitest unit tests.

export { computeDeltaBG } from './deltaBG.js';
export { calculateCarbEffect, calculateCOB, resolveMealSplit } from './carbs.js';
export { calculateEGP } from './egp.js';
export { DexcomG6Noise, createG6NoiseGenerator } from './g6Noise.js';
export { runPID, rateToMicroBolus } from './pid.js';
export { RAPID_PROFILES, LONG_ACTING_PROFILES } from './insulinProfiles.js';
export { getExpTreatmentActivity, getExpTreatmentIOB } from './utils.js';
export { ar2Forecast, ar2Opacity, AR2_HORIZON_STEPS, AR2_TICK_MS, AR2_TICK_MINUTES } from './ar2.js';
export type { ForecastPoint } from './ar2.js';
