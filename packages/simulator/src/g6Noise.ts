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

// ── Ziggurat RNG ─────────────────────────────────────────────────────────────

class RNG_Ziggurat_SHR3 {
  private seed: number;
  private jsr: number;
  private wn: number[];
  private fn: number[];
  private kn: number[];

  constructor(seed = 1) {
    this.seed = Math.max(Math.floor(seed), 1);
    this.jsr = 0;
    this.wn = new Array(128) as number[];
    this.fn = new Array(128) as number[];
    this.kn = new Array(128) as number[];
    this.reset();
  }

  reset(): void {
    this.jsr = 123456789 ^ this.seed;
    this.zigset();
  }

  getState(): { jsr: number; seed: number } {
    return { jsr: this.jsr, seed: this.seed };
  }

  setState(state: { jsr: number; seed: number }): void {
    this.jsr = state.jsr;
    this.seed = state.seed;
  }

  getUniform(): number {
    return 0.5 * (1 - this.SHR3() / Math.pow(2, 31));
  }

  private SHR3(): number {
    const jz = this.jsr;
    let jzr = this.jsr;
    jzr ^= jzr << 13;
    jzr ^= jzr >>> 17;
    jzr ^= jzr << 5;
    this.jsr = jzr;
    return (jz + jzr) | 0;
  }

  getNormal(): number {
    const r = 3.442619855899;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const hz = (1 - this.getUniform() * 2) * Math.pow(2, 31);
      const iz = hz & 127;

      const wn_iz = this.wn[iz];
      const kn_iz = this.kn[iz];
      const fn_iz = this.fn[iz];

      if (wn_iz === undefined || kn_iz === undefined || fn_iz === undefined) {
        continue;
      }

      if (Math.abs(hz) < kn_iz) {
        return hz * wn_iz;
      }

      const x = hz * wn_iz;
      if (iz === 0) {
        const xa = -Math.log(this.getUniform()) / r;
        let ya = -Math.log(this.getUniform());
        while (ya + ya < xa * xa) {
          ya = -Math.log(this.getUniform());
        }
        return hz > 0 ? r + xa : -r - xa;
      }

      const fn_iz_prev = this.fn[iz - 1];
      if (fn_iz_prev !== undefined) {
        if (fn_iz + this.getUniform() * (fn_iz_prev - fn_iz) < Math.exp(-0.5 * x * x)) {
          return x;
        }
      }
    }
  }

  private zigset(): void {
    this.wn = new Array(128) as number[];
    this.fn = new Array(128) as number[];
    this.kn = new Array(128) as number[];

    const m1 = 2147483648.0;
    let dn = 3.442619855899;
    let tn = dn;
    const vn = 9.91256303526217e-3;

    const q = vn / Math.exp(-0.5 * dn * dn);
    this.kn[0] = Math.floor((dn / q) * m1);
    this.kn[1] = 0;
    this.wn[0] = q / m1;
    this.wn[127] = dn / m1;
    this.fn[0] = 1.0;
    this.fn[127] = Math.exp(-0.5 * dn * dn);

    for (let i = 126; i >= 1; i--) {
      dn = Math.sqrt(-2.0 * Math.log(vn / dn + Math.exp(-0.5 * dn * dn)));
      this.kn[i + 1] = Math.floor((dn / tn) * m1);
      tn = dn;
      this.fn[i] = Math.exp(-0.5 * dn * dn);
      this.wn[i] = dn / m1;
    }
  }
}

// ── G6 Model Parameters (Vettoretti 2019, Table 1 & 2) ──────────────────────

const G6_PARAMS = {
  alpha_w1: 1.220,
  alpha_w2: -0.331,
  sigma_2_w: 3.641,

  alpha_cc1: 1.34,
  alpha_cc2: -0.492,
  sigma_2_cc: 5.538,

  a0: 1.048,
  a1: -0.033,
  a2: 0.002,
  b0: -6.398,
  b1: 6.179,
  b2: -0.448,
} as const;

const MS_PER_DAY = 60e3 * 60 * 24;

// ── DexcomG6Noise class ──────────────────────────────────────────────────────

export class DexcomG6Noise {
  private rng: RNG_Ziggurat_SHR3;
  private v: [number, number];
  private cc: [number, number];
  private tCalib: number;

  constructor(seed = 1, state: G6NoiseState | null = null) {
    this.rng = new RNG_Ziggurat_SHR3(seed);

    if (state) {
      this.v = [state.v[0], state.v[1]];
      this.cc = [state.cc[0], state.cc[1]];
      this.tCalib = state.tCalib;
      this.rng.setState(state.rng);
    } else {
      this.v = [0, 0];
      this.cc = [0, 0];
      this.tCalib = 0;  // simulation epoch — simTimeMs starts at 0
    }
  }

  getState(): G6NoiseState {
    return {
      v: [this.v[0], this.v[1]],
      cc: [this.cc[0], this.cc[1]],
      tCalib: this.tCalib,
      rng: this.rng.getState(),
    };
  }

  setState(state: G6NoiseState): void {
    this.v = [state.v[0], state.v[1]];
    this.cc = [state.cc[0], state.cc[1]];
    this.tCalib = state.tCalib;
    this.rng.setState(state.rng);
  }

  /**
   * Advance the AR model one step and return the stochastic noise (mg/dL).
   * Call once per 5-minute simulation tick.
   */
  getNextNoise(): number {
    const p = G6_PARAMS;

    const w_v = Math.sqrt(p.sigma_2_w) * this.rng.getNormal();
    const v_new = p.alpha_w1 * this.v[1] + p.alpha_w2 * this.v[0] + w_v;
    this.v[0] = this.v[1];
    this.v[1] = v_new;

    const w_cc = Math.sqrt(p.sigma_2_cc) * this.rng.getNormal();
    const cc_new = p.alpha_cc1 * this.cc[1] + p.alpha_cc2 * this.cc[0] + w_cc;
    this.cc[0] = this.cc[1];
    this.cc[1] = cc_new;

    return v_new + cc_new;
  }

  /**
   * Apply the full sensor model to a true glucose value.
   * Includes deterministic drift + stochastic noise.
   * @param trueGlucose mg/dL
   * @param simTimeMs current simulated timestamp (ms) — used for drift polynomial
   */
  applySensorModel(trueGlucose: number, simTimeMs: number): number {
    const p = G6_PARAMS;
    const dt = (simTimeMs - this.tCalib) / MS_PER_DAY;

    const a = p.a0 + p.a1 * dt + p.a2 * dt * dt;
    const b = p.b0 + p.b1 * dt + p.b2 * dt * dt;
    const noise = this.getNextNoise();

    return a * trueGlucose + b + noise;
  }

  resetCalibration(simTimeMs: number): void {
    this.tCalib = simTimeMs;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a seeded noise generator.
 * @param seed integer seed (e.g. derived from scenario ID or hash)
 * @param state optional saved state for restore / comparison runs
 */
export function createG6NoiseGenerator(
  seed: number,
  state: G6NoiseState | null = null,
): DexcomG6Noise {
  return new DexcomG6Noise(seed, state);
}
