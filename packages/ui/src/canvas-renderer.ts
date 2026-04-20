/**
 * CGM Canvas Renderer
 *
 * Renders the animated glucose trace on an HTML Canvas element.
 * Driven by requestAnimationFrame at 60fps, independent of tick rate.
 * Reads from a shared ring buffer updated on each tick message.
 *
 * Spec §7.3 and §8.2:
 *   - 24-hour display window: 18h filled + 6h empty space
 *   - Fixed midnight-at-left for first 18h; scrolling thereafter
 *   - ATTD colour bands: green (70–180), amber (54–70), red (<54)
 *   - Glow effect on trace line
 *   - IOB and COB activity overlays (toggleable)
 *   - mg/dL ↔ mmol/L display at presentation layer only
 */

import type { TickSnapshot, DisplayUnit } from '@cgmsim/shared';
import type { SimEvent } from './inline-simulator.js';

// ── Constants ────────────────────────────────────────────────────────────────

const WINDOW_MINUTES = 24 * 60;         // total display window
const HISTORY_MINUTES = 18 * 60;        // filled region
const FUTURE_MINUTES = 6 * 60;          // empty region
const TICK_MINUTES = 5;
const MAX_BUFFER = HISTORY_MINUTES / TICK_MINUTES + 1; // 217 points

// ATTD glucose thresholds (mg/dL)
const TIR_LOW = 70;
const TIR_HIGH = 180;
const HYPO_L1 = 54;

// Canvas colours (CSS variables mapped to actual values for canvas 2D)
const COLORS = {
  bg: '#0d1117',
  grid: 'rgba(48, 54, 61, 0.6)',
  gridLabel: '#8b949e',
  greenBand: 'rgba(38, 166, 65, 0.12)',
  amberBand: 'rgba(210, 153, 34, 0.20)',
  redBand: 'rgba(218, 54, 51, 0.20)',
  trace: '#58a6ff',
  traceGlow: 'rgba(88, 166, 255, 0.35)',
  traceHypoL1: '#d29922',
  traceHypoL2: '#da3633',
  trueGlucose: 'rgba(255, 255, 255, 0.25)',
  iobFill: 'rgba(88, 166, 255, 0.10)',
  iobLine: 'rgba(88, 166, 255, 0.4)',
  cobFill: 'rgba(210, 153, 34, 0.10)',
  cobLine: 'rgba(210, 153, 34, 0.4)',
  bolusMarker: '#58a6ff',
  mealMarker: '#d29922',
  future: 'rgba(255, 255, 255, 0.03)',
};

// ── Types ────────────────────────────────────────────────────────────────────

// Comparison trace colours (orange/coral — distinct from primary blue)
const COMPARE_COLORS = {
  trace:     '#ff7b54',
  traceGlow: 'rgba(255, 123, 84, 0.30)',
  hypoL1:    '#ff9f43',
  hypoL2:    '#ee5a24',
};

export interface RendererOptions {
  showIOB: boolean;
  showCOB: boolean;
  showTrueGlucose: boolean;
  showEvents: boolean;
  displayUnit: DisplayUnit;
  /** Label for primary trace legend (shown when comparison active) */
  primaryLabel: string;
  /** Label for comparison trace */
  compareLabel: string;
}

interface RingEntry {
  simTimeMs: number;
  cgm: number;
  trueGlucose: number;
  iob: number;
  cob: number;
  trend: number;
}

// ── Ring buffer ──────────────────────────────────────────────────────────────

class RingBuffer {
  private buf: (RingEntry | null)[];
  private head = 0;  // next write position
  private _size = 0;

  constructor(capacity: number) {
    this.buf = new Array(capacity).fill(null) as null[];
  }

  push(entry: RingEntry): void {
    this.buf[this.head] = entry;
    this.head = (this.head + 1) % this.buf.length;
    if (this._size < this.buf.length) this._size++;
  }

  get size(): number { return this._size; }

  /** Iterate from oldest to newest. */
  forEach(cb: (entry: RingEntry, index: number) => void): void {
    const cap = this.buf.length;
    const start = this._size < cap ? 0 : this.head;
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % cap;
      const e = this.buf[idx];
      if (e != null) cb(e, i);
    }
  }

  latest(): RingEntry | null {
    if (this._size === 0) return null;
    const idx = (this.head - 1 + this.buf.length) % this.buf.length;
    return this.buf[idx] ?? null;
  }

  clear(): void {
    this.buf.fill(null);
    this.head = 0;
    this._size = 0;
  }
}

// ── Renderer ─────────────────────────────────────────────────────────────────

export class CGMRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ring = new RingBuffer(MAX_BUFFER);
  private comparisonRing = new RingBuffer(MAX_BUFFER);
  private events: SimEvent[] = [];
  private rafId = 0;
  private dirty = false;
  public options: RendererOptions = {
    showIOB: true,
    showCOB: true,
    showTrueGlucose: false,
    showEvents: true,
    displayUnit: 'mgdl',
    primaryLabel: 'Run A',
    compareLabel: 'Run B',
  };

  // Padding
  private readonly PAD_LEFT = 56;
  private readonly PAD_RIGHT = 16;
  private readonly PAD_TOP = 24;
  private readonly PAD_BOTTOM = 36;

  // CSS-pixel dimensions — what all drawing code uses
  private cssW = 0;
  private cssH = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(rect.width, 400);
    this.cssH = Math.max(rect.height, 200);
    // Physical pixel dimensions
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    // Reset to identity then scale once — never accumulate
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  /** Called on every tick from the worker bridge. */
  pushTick(snap: TickSnapshot): void {
    this.ring.push({
      simTimeMs: snap.simTimeMs, cgm: snap.cgm, trueGlucose: snap.trueGlucose,
      iob: snap.iob, cob: snap.cob, trend: snap.trend,
    });
    this.dirty = true;
  }

  /** Push a tick from the comparison simulator. */
  pushComparisonTick(snap: TickSnapshot): void {
    this.comparisonRing.push({
      simTimeMs: snap.simTimeMs, cgm: snap.cgm, trueGlucose: snap.trueGlucose,
      iob: snap.iob, cob: snap.cob, trend: snap.trend,
    });
    this.dirty = true;
  }

  /** True if a comparison trace has any data. */
  get hasComparison(): boolean { return this.comparisonRing.size > 0; }

  /** Add simulation events for canvas markers. */
  pushEvents(evs: SimEvent[]): void {
    for (const ev of evs) this.events.push(ev);
    this.dirty = true;
  }

  /** Clear all historical data (e.g. on RESET). */
  clearHistory(): void {
    this.ring.clear();
    this.comparisonRing.clear();
    this.events = [];
    this.dirty = true;
  }

  /** Clear only comparison trace. */
  clearComparison(): void {
    this.comparisonRing.clear();
    this.dirty = true;
  }

  /** Force a redraw on the next animation frame. */
  markDirty(): void {
    this.dirty = true;
  }

  start(): void {
    this.dirty = true; // ensure first frame always paints
    const loop = () => {
      if (this.dirty) {
        this.render();
        this.dirty = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  private get plotW(): number {
    return this.cssW - this.PAD_LEFT - this.PAD_RIGHT;
  }
  private get plotH(): number {
    return this.cssH - this.PAD_TOP - this.PAD_BOTTOM;
  }

  private toDisplay(mgdl: number): number {
    return this.options.displayUnit === 'mmoll' ? mgdl / 18.0182 : mgdl;
  }

  /** Y coordinate for a given mg/dL value. Glucose range: 40–400 mg/dL. */
  private glucoseY(mgdl: number): number {
    const MIN = 40, MAX = 400;
    const frac = 1 - (mgdl - MIN) / (MAX - MIN);
    return this.PAD_TOP + frac * this.plotH;
  }

  /**
   * X coordinate for a simulated time offset (minutes from the window start).
   * The window always shows WINDOW_MINUTES across the full plot width.
   */
  private timeX(minuteOffset: number): number {
    return this.PAD_LEFT + (minuteOffset / WINDOW_MINUTES) * this.plotW;
  }

  /**
   * Compute the simulated time (in minutes from epoch) that should appear
   * at the left edge of the display.
   *
   * Spec §8.2 scrolling behaviour:
   *   - For first 18 simulated hours: midnight fixed at left, trace grows right
   *   - After 18 simulated hours: scroll so the most recent 18h fills left portion
   */
  private windowStartMinutes(latestSimTimeMs: number): number {
    const latestMin = latestSimTimeMs / 60_000;
    if (latestMin <= HISTORY_MINUTES) {
      return 0; // midnight fixed
    }
    return latestMin - HISTORY_MINUTES;
  }

  // ── Main render ───────────────────────────────────────────────────────────

  private render(): void {
    // Re-measure if resize() ran before layout completed
    if (this.cssW === 0 || this.cssH === 0) {
      this.resize();
      if (this.cssW === 0 || this.cssH === 0) return;
    }
    const W = this.cssW;
    const H = this.cssH;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    const latest = this.ring.latest();
    const latestSimMs = latest?.simTimeMs ?? 0;
    const winStartMin = this.windowStartMinutes(latestSimMs);

    // ── Layer 1: colour bands ────────────────────────────────────────────
    this.drawBands(winStartMin);

    // ── Layer 2: future space ────────────────────────────────────────────
    this.drawFutureSpace(winStartMin, latestSimMs);

    // ── Layer 3: grid lines and labels ───────────────────────────────────
    this.drawGrid(winStartMin);

    // ── Layer 4: COB fill (below baseline) ──────────────────────────────
    if (this.options.showCOB) this.drawCOBOverlay(winStartMin);

    // ── Layer 5: IOB fill (below glucose axis, mirrored down) ───────────
    if (this.options.showIOB) this.drawIOBOverlay(winStartMin);

    // ── Layer 6: true glucose (faint, for debug) ─────────────────────────
    if (this.options.showTrueGlucose) this.drawTrueLine(winStartMin);

    // ── Layer 7: CGM trace ───────────────────────────────────────────────
    this.drawTrace(winStartMin);

    // ── Layer 8: comparison trace (if active) ────────────────────────────
    if (this.hasComparison) {
      this.drawComparisonTrace(winStartMin);
      this.drawLegend();
    }

    // ── Layer 9: event markers ───────────────────────────────────────────
    if (this.options.showEvents) this.drawEventMarkers(winStartMin);
  }

  private drawEventMarkers(winStartMin: number): void {
    const ctx = this.ctx;
    const latest = this.ring.latest();
    if (!latest) return;

    for (const ev of this.events) {
      const offsetMin = ev.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > WINDOW_MINUTES) continue;

      const x = this.timeX(offsetMin);

      if (ev.kind === 'bolus') {
        // Blue downward triangle at bottom of plot area
        const y = this.PAD_TOP + this.plotH;
        ctx.beginPath();
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x - 5, y - 12);
        ctx.lineTo(x + 5, y - 12);
        ctx.closePath();
        ctx.fillStyle = COLORS.bolusMarker;
        ctx.fill();
        // Label: units
        ctx.fillStyle = COLORS.bolusMarker;
        ctx.font = 'bold 9px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${ev.units}U`, x, y - 15);

      } else if (ev.kind === 'meal') {
        // Amber upward triangle at top of plot area
        const y = this.PAD_TOP;
        ctx.beginPath();
        ctx.moveTo(x, y + 2);
        ctx.lineTo(x - 5, y + 12);
        ctx.lineTo(x + 5, y + 12);
        ctx.closePath();
        ctx.fillStyle = COLORS.mealMarker;
        ctx.fill();
        // Label: grams
        ctx.fillStyle = COLORS.mealMarker;
        ctx.font = 'bold 9px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${ev.carbsG}g`, x, y + 24);
      }
    }
    ctx.textAlign = 'left'; // reset
  }

  private drawBands(winStartMin: number): void {
    const ctx = this.ctx;
    // Green TIR band
    const yTop = this.glucoseY(TIR_HIGH);
    const yBot = this.glucoseY(TIR_LOW);
    ctx.fillStyle = COLORS.greenBand;
    ctx.fillRect(this.PAD_LEFT, yTop, this.plotW, yBot - yTop);

    // Amber L1 hypo band
    const yAmberBot = this.glucoseY(HYPO_L1);
    ctx.fillStyle = COLORS.amberBand;
    ctx.fillRect(this.PAD_LEFT, yBot, this.plotW, yAmberBot - yBot);

    // Red L2 hypo band
    ctx.fillStyle = COLORS.redBand;
    ctx.fillRect(this.PAD_LEFT, yAmberBot, this.plotW, this.glucoseY(40) - yAmberBot);
  }

  private drawFutureSpace(winStartMin: number, latestSimMs: number): void {
    const latestMin = latestSimMs / 60_000;
    const filledUntilOffset = latestMin - winStartMin;
    const xFutureStart = this.timeX(filledUntilOffset);
    const xEnd = this.timeX(WINDOW_MINUTES);
    if (xFutureStart >= xEnd) return;

    this.ctx.fillStyle = COLORS.future;
    this.ctx.fillRect(xFutureStart, this.PAD_TOP, xEnd - xFutureStart, this.plotH);
  }

  private drawGrid(winStartMin: number): void {
    const ctx = this.ctx;
    const isMMol = this.options.displayUnit === 'mmoll';

    // Horizontal glucose lines
    const glucoseLines = isMMol
      ? [3.9, 5.0, 7.0, 10.0, 14.0, 22.0].map(v => v * 18.0182)
      : [54, 70, 100, 140, 180, 250, 350];

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillStyle = COLORS.gridLabel;
    ctx.textAlign = 'right';

    for (const mg of glucoseLines) {
      const y = this.glucoseY(mg);
      if (y < this.PAD_TOP || y > this.PAD_TOP + this.plotH) continue;
      ctx.beginPath();
      ctx.moveTo(this.PAD_LEFT, y);
      ctx.lineTo(this.PAD_LEFT + this.plotW, y);
      ctx.stroke();
      const label = isMMol ? (mg / 18.0182).toFixed(1) : Math.round(mg).toString();
      ctx.fillText(label, this.PAD_LEFT - 6, y + 4);
    }
    ctx.setLineDash([]);

    // Vertical time lines — every 3 hours
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h += 3) {
      const simMin = winStartMin - (winStartMin % (24 * 60)) + h * 60;
      const offsetMin = simMin - winStartMin;
      if (offsetMin < 0 || offsetMin > WINDOW_MINUTES) continue;

      const x = this.timeX(offsetMin);
      ctx.strokeStyle = COLORS.grid;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, this.PAD_TOP);
      ctx.lineTo(x, this.PAD_TOP + this.plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Hour label (24h clock, using absolute sim hour mod 24)
      const absHour = Math.round(simMin / 60) % 24;
      ctx.fillStyle = COLORS.gridLabel;
      ctx.fillText(`${String(absHour).padStart(2, '0')}:00`,
        x, this.PAD_TOP + this.plotH + 18);
    }
  }

  private drawTrace(winStartMin: number): void {
    const ctx = this.ctx;
    if (this.ring.size === 0) return;

    // Glow pass (wider, transparent) then sharp line
    this.drawTracePath(this.ring, winStartMin, 6, COLORS.traceGlow, false);
    this.drawTracePath(this.ring, winStartMin, 2, COLORS.trace, true);
  }

  private drawComparisonTrace(winStartMin: number): void {
    if (this.comparisonRing.size === 0) return;
    this.drawTracePath(this.comparisonRing, winStartMin, 6,  COMPARE_COLORS.traceGlow, false);
    this.drawTracePath(this.comparisonRing, winStartMin, 2,  COMPARE_COLORS.trace, false);
  }

  private drawLegend(): void {
    const ctx   = this.ctx;
    const x     = this.PAD_LEFT + 8;
    const y     = this.PAD_TOP + 10;
    const swatch = 14;
    const gap    = 6;

    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';

    // Primary
    ctx.fillStyle = COLORS.trace;
    ctx.fillRect(x, y - swatch / 2, swatch, swatch);
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(this.options.primaryLabel, x + swatch + gap, y);

    // Comparison
    const x2 = x + swatch + gap + ctx.measureText(this.options.primaryLabel).width + 16;
    ctx.fillStyle = COMPARE_COLORS.trace;
    ctx.fillRect(x2, y - swatch / 2, swatch, swatch);
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(this.options.compareLabel, x2 + swatch + gap, y);

    ctx.textBaseline = 'alphabetic';
  }

  private drawTracePath(
    ring: RingBuffer,
    winStartMin: number,
    lineWidth: number,
    color: string,
    colorByZone: boolean,
  ): void {
    const ctx = this.ctx;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let inPath = false;
    let prevZone = 0;

    ctx.beginPath();
    ctx.strokeStyle = color;

    ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > WINDOW_MINUTES) return;

      const x = this.timeX(offsetMin);
      const y = this.glucoseY(entry.cgm);

      if (colorByZone) {
        const zone = entry.cgm < HYPO_L1 ? 2 : entry.cgm < TIR_LOW ? 1 : 0;
        if (zone !== prevZone && inPath) {
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = zone === 2 ? COLORS.traceHypoL2
            : zone === 1 ? COLORS.traceHypoL1 : COLORS.trace;
          ctx.moveTo(x, y);
          prevZone = zone;
        }
      }

      if (!inPath) { ctx.moveTo(x, y); inPath = true; }
      else           ctx.lineTo(x, y);
    });

    if (inPath) ctx.stroke();
  }

  private drawTrueLine(winStartMin: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.trueGlucose;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    let first = true;

    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > WINDOW_MINUTES) return;
      const x = this.timeX(offsetMin);
      const y = this.glucoseY(entry.trueGlucose);
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawIOBOverlay(winStartMin: number): void {
    if (this.ring.size === 0) return;
    const ctx = this.ctx;

    // Normalise IOB to a display scale (max 5U → 25% of plotH)
    const maxIOB = 5;
    const maxPx = this.plotH * 0.25;
    const baseY = this.glucoseY(TIR_LOW); // anchor at 70 mg/dL line

    ctx.beginPath();
    let first = true;

    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > WINDOW_MINUTES) return;
      const x = this.timeX(offsetMin);
      const iobPx = Math.min(entry.iob / maxIOB, 1) * maxPx;
      const y = baseY + iobPx; // draw downward from anchor
      if (first) { ctx.moveTo(x, baseY); ctx.lineTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });

    ctx.lineTo(this.timeX(HISTORY_MINUTES), baseY);
    ctx.closePath();

    ctx.fillStyle = COLORS.iobFill;
    ctx.fill();

    // Redraw line on top
    ctx.beginPath();
    first = true;
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > WINDOW_MINUTES) return;
      const x = this.timeX(offsetMin);
      const iobPx = Math.min(entry.iob / maxIOB, 1) * maxPx;
      const y = baseY + iobPx;
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = COLORS.iobLine;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawCOBOverlay(winStartMin: number): void {
    if (this.ring.size === 0) return;
    const ctx = this.ctx;

    const maxCOB = 80; // g
    const maxPx = this.plotH * 0.20;
    const baseY = this.glucoseY(TIR_HIGH); // anchor at 180 mg/dL

    ctx.beginPath();
    let first = true;

    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > WINDOW_MINUTES) return;
      const x = this.timeX(offsetMin);
      const cobPx = Math.min(entry.cob / maxCOB, 1) * maxPx;
      const y = baseY - cobPx; // draw upward from anchor
      if (first) { ctx.moveTo(x, baseY); ctx.lineTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });

    ctx.lineTo(this.timeX(HISTORY_MINUTES), baseY);
    ctx.closePath();

    ctx.fillStyle = COLORS.cobFill;
    ctx.fill();

    ctx.beginPath();
    first = true;
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > WINDOW_MINUTES) return;
      const x = this.timeX(offsetMin);
      const cobPx = Math.min(entry.cob / maxCOB, 1) * maxPx;
      const y = baseY - cobPx;
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = COLORS.cobLine;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
