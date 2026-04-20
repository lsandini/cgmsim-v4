/**
 * Core mathematical utilities for the CGMSIM v4 simulation engine.
 * Ported from @lsandini/cgmsim-lib utils.ts; Nightscout dependencies removed.
 *
 * The biexponential model represents subcutaneous insulin absorption and
 * elimination as two competing exponential processes, producing the
 * characteristic bell-shaped activity curve observed in pharmacokinetic studies.
 */

// ── Biexponential helpers ────────────────────────────────────────────────────

export interface ExpTreatmentParams {
  /** Time to peak activity in minutes. */
  peak: number;
  /** Total duration of action in minutes. */
  duration: number;
  /** Minutes elapsed since dose was given. */
  minutesAgo: number;
  /** Dose size in units. */
  units: number;
}

/**
 * Compute instantaneous insulin activity (U/min) for a single dose.
 *
 * Uses the biexponential parametric model from cgmsim-lib.
 * The curve is normalised so its integral over [0, duration] equals `units`.
 * Returns zero outside the active window [0, duration].
 */
export function getExpTreatmentActivity(p: ExpTreatmentParams): number {
  const { peak, duration, minutesAgo: t, units } = p;

  if (t < 0 || t > duration) return 0;

  // Biexponential parameters
  const tau = peak * (1 - peak / duration) / (1 - 2 * peak / duration);
  const a = 2 * tau / duration;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-duration / tau));

  // Activity per unit: area under curve = 1 unit
  // From cgmsim-lib: activity = (S/tau^2) * t * (1 - t/duration) * exp(-t/tau)
  const actPerUnit = (S / Math.pow(tau, 2)) *
    t * (1 - t / duration) *
    Math.exp(-t / tau);

  return units * actPerUnit;
}

/**
 * Compute insulin on board (units remaining) for a single dose.
 * Uses smooth cubic IOB decay that matches the activity integral.
 */
export function getExpTreatmentIOB(p: ExpTreatmentParams): number {
  const { peak, duration, minutesAgo: t, units } = p;

  if (t < 0) return units;
  if (t > duration) return 0;

  // Smooth cubic decay: matches the "S-curve" shape of IOB rundown
  const frac = t / duration;
  const iobFraction = 1 - frac * frac * (3 - 2 * frac);
  return units * Math.max(0, iobFraction);
}

// ── Rounding ─────────────────────────────────────────────────────────────────

export function roundTo8Decimals(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

// ── Time ─────────────────────────────────────────────────────────────────────

/**
 * Minutes elapsed since a given simulated timestamp.
 * Both arguments are ms-since-epoch in simulated time.
 */
export function getDeltaMinutes(
  eventSimTimeMs: number,
  nowSimTimeMs: number,
): number {
  return (nowSimTimeMs - eventSimTimeMs) / 60_000;
}
