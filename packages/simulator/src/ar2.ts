/**
 * AR2 glucose forecast — faithful port of Nightscout's `lib/plugins/ar2.js`
 * (cgm-remote-monitor) with `coneFactor = 0` (central line only, no cone, no alarms).
 *
 * Algorithm
 * ---------
 *   z_t   = ln(BG_t / 140)                              // log-normalize against a fixed pivot
 *   z_t+1 = -0.723 · z_t-1  +  1.716 · z_t              // deterministic AR(2), no innovation
 *   BG_t+1 = clamp( round( 140 · exp(z_t+1) ), 36, 400 )
 *
 * Iterates 13 steps × 5 min → 65-minute horizon. Coefficients sum to 0.993,
 * making the process near-unit-root in log-space (slow mean-reversion to 140).
 *
 * Per-dot opacity matches Nightscout's chart `futureOpacity`, a piecewise-linear
 * scale: domain [25 min, 60 min] → range [0.8, 0.1], extrapolated and clamped to
 * [0, 1]. The first ~3 dots are full opacity; the last ~2 are nearly invisible.
 *
 * The forecast carries no information about IOB, COB, or basals — it is pure
 * pattern continuation. Pedagogically it is most useful when it visibly diverges
 * from the actual CGM trace after a meal or bolus lands.
 */

export interface ForecastPoint {
  /** Absolute timestamp of the forecast point (ms since epoch). */
  mills: number;
  /** Forecast glucose (mg/dL), clamped to [BG_MIN, BG_MAX]. */
  mgdl: number;
  /** Render alpha (0..1) — bake-in of Nightscout's piecewise-linear fade. */
  opacity: number;
}

export const AR2_HORIZON_STEPS = 13;
export const AR2_TICK_MINUTES  = 5;
export const AR2_TICK_MS       = AR2_TICK_MINUTES * 60_000;

const BG_REF = 140;
const BG_MIN = 36;
const BG_MAX = 400;
const AR: readonly [number, number] = [-0.723, 1.716];

// Nightscout chart.futureOpacity domain/range.
const OPACITY_T0  = 25;   // minutes — opacity = 0.8
const OPACITY_T1  = 60;   // minutes — opacity = 0.1
const OPACITY_V0  = 0.8;
const OPACITY_V1  = 0.1;

/**
 * Build a 13-point AR(2) forecast from the two most recent CGM values.
 * Returns `[]` if either input is below the sensor floor — there is no
 * meaningful forecast from a sensor-error reading.
 *
 * @param bgPrev   BG from the prior tick (mg/dL)
 * @param bgCurr   BG from the current tick (mg/dL)
 * @param nowMs    Absolute timestamp of `bgCurr`; first forecast point sits at nowMs + 5 min
 */
export function ar2Forecast(bgPrev: number, bgCurr: number, nowMs: number): ForecastPoint[] {
  if (bgPrev < BG_MIN || bgCurr < BG_MIN) return [];

  let prev = Math.log(bgPrev / BG_REF);
  let curr = Math.log(bgCurr / BG_REF);

  const out: ForecastPoint[] = [];
  for (let k = 1; k <= AR2_HORIZON_STEPS; k++) {
    const next = AR[0] * prev + AR[1] * curr;
    prev = curr;
    curr = next;

    const mgdl = Math.max(
      BG_MIN,
      Math.min(BG_MAX, Math.round(BG_REF * Math.exp(curr))),
    );
    out.push({
      mills: nowMs + k * AR2_TICK_MS,
      mgdl,
      opacity: ar2Opacity(k * AR2_TICK_MINUTES),
    });
  }
  return out;
}

/**
 * Per-dot opacity for a forecast point at `minutesAhead` minutes.
 *
 * Piecewise-linear extrapolation of d3.scaleLinear([25,60] → [0.8,0.1]),
 * clamped to [0, 1]. Yields the Nightscout fade: full opacity for the first
 * three 5-min dots, then a linear roll-off to ~0 by 65 minutes.
 */
export function ar2Opacity(minutesAhead: number): number {
  const a = OPACITY_V0 + ((minutesAhead - OPACITY_T0) / (OPACITY_T1 - OPACITY_T0)) * (OPACITY_V1 - OPACITY_V0);
  return Math.max(0, Math.min(1, a));
}
