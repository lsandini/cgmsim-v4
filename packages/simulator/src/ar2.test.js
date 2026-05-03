/**
 * AR2 forecast unit tests — verify parity with Nightscout's algorithm.
 *
 * Reference: vendor/cgm-remote-monitor/lib/plugins/ar2.js
 *   AR = [-0.723, 1.716], BG_REF = 140, log-domain recurrence.
 *
 * The numeric cross-check at the bottom is hand-computed from the recurrence
 * and protects against accidental coefficient drift.
 */
import { describe, it, expect } from 'vitest';
import {
  ar2Forecast,
  ar2Opacity,
  AR2_HORIZON_STEPS,
  AR2_TICK_MS,
} from './ar2.js';

describe('ar2Forecast — output shape', () => {
  it('produces exactly 13 points', () => {
    const pts = ar2Forecast(100, 105, 0);
    expect(pts).toHaveLength(AR2_HORIZON_STEPS);
  });

  it('places points at +5, +10, …, +65 min from nowMs', () => {
    const pts = ar2Forecast(100, 105, 1_700_000_000_000);
    pts.forEach((p, i) => {
      expect(p.mills).toBe(1_700_000_000_000 + (i + 1) * AR2_TICK_MS);
    });
  });

  it('clamps mgdl to [36, 400]', () => {
    const pts = ar2Forecast(100, 105, 0);
    for (const p of pts) {
      expect(p.mgdl).toBeGreaterThanOrEqual(36);
      expect(p.mgdl).toBeLessThanOrEqual(400);
    }
  });
});

describe('ar2Forecast — sensor floor', () => {
  it('returns [] when bgPrev < 36', () => {
    expect(ar2Forecast(35, 100, 0)).toEqual([]);
  });

  it('returns [] when bgCurr < 36', () => {
    expect(ar2Forecast(100, 35, 0)).toEqual([]);
  });

  it('returns [] when both inputs are below floor', () => {
    expect(ar2Forecast(20, 30, 0)).toEqual([]);
  });

  it('forecasts normally at exactly the floor', () => {
    expect(ar2Forecast(36, 36, 0)).toHaveLength(AR2_HORIZON_STEPS);
  });
});

describe('ar2Forecast — flat input drifts toward 140', () => {
  it('flat at 100 mg/dL: forecast crawls upward toward 140', () => {
    const pts = ar2Forecast(100, 100, 0);
    expect(pts[0].mgdl).toBeGreaterThanOrEqual(99);
    expect(pts[0].mgdl).toBeLessThanOrEqual(101);
    expect(pts[12].mgdl).toBeGreaterThan(100);
    expect(pts[12].mgdl).toBeLessThan(110);
  });

  it('flat at 200 mg/dL: forecast drifts downward toward 140', () => {
    const pts = ar2Forecast(200, 200, 0);
    expect(pts[0].mgdl).toBeLessThanOrEqual(200);
    expect(pts[12].mgdl).toBeLessThan(200);
    expect(pts[12].mgdl).toBeGreaterThan(140);
  });

  it('flat at exactly 140 stays at 140', () => {
    const pts = ar2Forecast(140, 140, 0);
    for (const p of pts) expect(p.mgdl).toBe(140);
  });
});

describe('ar2Forecast — rising trajectory continues rising', () => {
  it('+10 mg/dL/tick input yields a steeper-than-linear initial rise', () => {
    const pts = ar2Forecast(95, 105, 0);
    expect(pts[0].mgdl).toBeGreaterThan(105);
    for (let i = 1; i < 5; i++) {
      expect(pts[i].mgdl).toBeGreaterThanOrEqual(pts[i - 1].mgdl);
    }
  });

  it('falling trajectory continues falling', () => {
    const pts = ar2Forecast(120, 100, 0);
    expect(pts[0].mgdl).toBeLessThan(100);
  });
});

describe('ar2Forecast — Nightscout numeric parity', () => {
  /**
   * Hand-computed against the recurrence:
   *   z_-1 = ln(120/140) = -0.154151
   *   z_0  = ln(130/140) = -0.074108
   *
   *   z_1 = -0.723 × z_-1 + 1.716 × z_0
   *       = 0.111451 + -0.127169 = -0.015718
   *   BG_1 = round(140 × e^-0.015718) = round(137.82) = 138
   *
   *   z_2 = -0.723 × z_0 + 1.716 × z_1
   *       = 0.053580 + -0.026972 =  0.026608
   *   BG_2 = round(140 × e^0.026608) = round(143.78) = 144
   */
  it('matches hand-computed values for input (120, 130)', () => {
    const pts = ar2Forecast(120, 130, 0);
    expect(pts[0].mgdl).toBe(138);
    expect(pts[1].mgdl).toBe(144);
  });
});

describe('ar2Opacity — Nightscout futureOpacity curve', () => {
  it('first three 5-min dots clamp at 1.0', () => {
    expect(ar2Opacity(5)).toBe(1);
    expect(ar2Opacity(10)).toBe(1);
    expect(ar2Opacity(15)).toBe(1);
  });

  it('reaches 0.8 at 25 min and 0.1 at 60 min', () => {
    expect(ar2Opacity(25)).toBeCloseTo(0.8, 5);
    expect(ar2Opacity(60)).toBeCloseTo(0.1, 5);
  });

  it('falls through 0.5 at 42.5 min (midpoint of fade)', () => {
    expect(ar2Opacity(42.5)).toBeCloseTo(0.45, 2);
  });

  it('clamps to 0 at and beyond 65 min', () => {
    expect(ar2Opacity(65)).toBe(0);
    expect(ar2Opacity(120)).toBe(0);
  });

  it('forecast points expose the same opacity values', () => {
    const pts = ar2Forecast(100, 105, 0);
    expect(pts[0].opacity).toBe(1);
    expect(pts[2].opacity).toBe(1);
    expect(pts[4].opacity).toBeCloseTo(0.8, 5);
    expect(pts[11].opacity).toBeCloseTo(0.1, 5);
    expect(pts[12].opacity).toBe(0);
  });
});
