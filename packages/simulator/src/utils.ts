/**
 * Core mathematical utilities for the CGMSIM v4 simulation engine.
 * Ported from @lsandini/cgmsim-lib utils.ts; Nightscout dependencies removed.
 *
 * The biexponential model represents subcutaneous insulin absorption and
 * elimination as two competing exponential processes, producing the
 * characteristic bell-shaped activity curve observed in pharmacokinetic studies.
 */

// ── Biexponential helpers ────────────────────────────────────────────────────

interface ExpTreatmentParams {
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
 * Matches v3 cgmsim-lib exactly: biexponential parametric model with a
 * 15-minute subcutaneous absorption ramp-up at the start of action.
 */
export function getExpTreatmentActivity(p: ExpTreatmentParams): number {
  const { peak, duration, minutesAgo: t, units } = p;

  if (t < 0 || t > duration) return 0;

  const tau = (peak * (1 - peak / duration)) / (1 - (2 * peak) / duration);
  const S = 1 / (1 - (2 * tau / duration) + (1 + (2 * tau / duration)) * Math.exp(-duration / tau));

  let act = units * (S / (tau * tau)) * t * (1 - t / duration) * Math.exp(-t / tau);
  if (act <= 0) return 0;
  // 15-minute subcutaneous absorption ramp-up (matches v3 behaviour)
  if (t < 15) return act * (t / 15);
  return act;
}

/**
 * Compute insulin on board (units remaining) for a single dose.
 *
 * Analytical integral of the biexponential activity curve, matching v3
 * cgmsim-lib exactly. Includes the 15-minute ramp-up correction.
 */
export function getExpTreatmentIOB(p: ExpTreatmentParams): number {
  const { peak, duration, minutesAgo: t, units } = p;

  if (t >= duration) return 0;
  if (t <= 0) return units;

  const tau = (peak * (1 - peak / duration)) / (1 - (2 * peak) / duration);
  const a = (2 * tau) / duration;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-duration / tau));

  let iobFraction = 1 - S * (1 - a) *
    ((t * t / (tau * duration * (1 - a)) - t / tau - 1) *
      Math.exp(-t / tau) + 1);

  // 15-minute ramp-up correction (matches v3 behaviour)
  if (t < 15) iobFraction = 1 - (t / 15) * (1 - iobFraction);

  return Math.max(0, units * iobFraction);
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
