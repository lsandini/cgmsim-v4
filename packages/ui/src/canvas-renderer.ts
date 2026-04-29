/**
 * CGM Canvas Renderer
 *
 * Renders the animated glucose trace on an HTML Canvas element.
 * Driven by requestAnimationFrame at 60fps, independent of tick rate.
 * Reads from a shared ring buffer updated on each tick message.
 *
 * Spec §7.3 and §8.2:
 *   - 24-hour default display window (6h / 12h / 24h zoom levels)
 *   - Fixed midnight-at-left for first 18h; scrolling thereafter
 *   - ATTD colour bands: green (70–180), amber (54–70), red (<54)
 *   - Glow effect on trace line
 *   - IOB and COB activity overlays (toggleable)
 *   - mg/dL ↔ mmol/L display at presentation layer only
 *   - Pan (drag) and zoom (buttons / pinch) with live-follow mode
 */

import type { TickSnapshot, DisplayUnit } from '@cgmsim/shared';
import type { SimEvent } from './inline-simulator.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MINUTES = 24 * 60;
const TICK_MINUTES = 1;
const MAX_BUFFER = 7 * 24 * 60 / TICK_MINUTES + 1; // 7 days of 5-min ticks

// ATTD glucose thresholds (mg/dL)
const TIR_LOW = 70;
const TIR_HIGH = 180;
const HYPO_L1 = 54;

// Canvas colours
const COLORS = {
  bg: '#0a0f1c',
  grid: 'rgba(80, 92, 118, 0.45)',
  gridStrong: 'rgba(120, 134, 162, 0.65)',
  gridLabel: 'rgba(148, 160, 184, 0.85)',
  gridDay: 'rgba(122, 162, 255, 0.30)',

  // Glycaemic zone bands (low opacity) + crisp threshold lines
  greenBand: 'rgba(16, 185, 129, 0.18)',
  amberBand: 'rgba(245, 158, 11, 0.20)',
  redBand:   'rgba(239, 68, 68, 0.20)',
  hypoLine:  '#ef4444',           // 70 mg/dL  (3.9 mmol/L)
  hypoL2Line:'#dc2626',           // 54 mg/dL  (3.0 mmol/L)
  hyperLine: '#f59e0b',           // 180 mg/dL (10  mmol/L)

  // CGM trace identity
  trace:        '#22d3ee',
  traceGlow:    'rgba(34, 211, 238, 0.40)',
  traceHypoL1:  '#f59e0b',
  traceHypoL2:  '#ef4444',
  trueGlucose:  'rgba(238, 242, 250, 0.28)',

  // IOB / COB / basal — distinct identities
  iobFill:    'rgba(20, 184, 166, 0.28)',
  iobFillTop: 'rgba(20, 184, 166, 0.55)',   // gradient top end
  iobLine:    'rgba(20, 184, 166, 0.95)',
  cobFill:    'rgba(251, 191, 36, 0.22)',
  cobFillTop: 'rgba(251, 191, 36, 0.50)',
  cobLine:    'rgba(251, 191, 36, 0.90)',
  basalFill:  'rgba(52, 211, 153, 0.22)',
  basalLine:  'rgba(52, 211, 153, 0.85)',

  // Event markers
  bolusMarker: '#22d3ee',
  mealMarker:  '#fbbf24',
  smbMarker:   '#c084fc',

  // "Future" region (right of the now-line)
  future: 'rgba(8, 12, 22, 0.45)',
  futureEdge: 'rgba(122, 162, 255, 0.35)',
};

const COMPARE_COLORS = {
  trace:     '#fb7185',                    // rose — clearly distinct from cyan primary
  traceGlow: 'rgba(251, 113, 133, 0.35)',
  hypoL1:    '#fdba74',
  hypoL2:    '#f87171',
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface RendererOptions {
  showIOB: boolean;
  showCOB: boolean;
  showBasal: boolean;
  showTrueGlucose: boolean;
  showEvents: boolean;
  displayUnit: DisplayUnit;
  primaryLabel: string;
  compareLabel: string;
}

interface RingEntry {
  simTimeMs: number;
  cgm: number;
  trueGlucose: number;
  iob: number;
  cob: number;
  trend: number;
  basalRate: number;
}

// ── Ring buffer ──────────────────────────────────────────────────────────────

class RingBuffer {
  private buf: (RingEntry | null)[];
  private head = 0;
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
  private lastTickWallMs = 0;
  private currentThrottle = 10;
  private isRunning = false;

  // View state — pan and zoom
  private viewWindowMinutes = DEFAULT_WINDOW_MINUTES;
  private viewOffsetMs = 0;            // 0 = live-follow; positive = panned into history
  private isDragging = false;
  private dragStartX = 0;
  private dragStartOffset = 0;
  private pinchStartDist = 0;
  private pinchStartWindow = DEFAULT_WINDOW_MINUTES;
  private viewChangeCallbacks: (() => void)[] = [];

  public options: RendererOptions = {
    showIOB: true,
    showCOB: true,
    showBasal: true,
    showTrueGlucose: false,
    showEvents: true,
    displayUnit: 'mmoll',
    primaryLabel: 'Run A',
    compareLabel: 'Run B',
  };

  private readonly PAD_LEFT        = 56;
  private readonly PAD_RIGHT       = 36;
  private readonly PAD_TOP         = 52;  // headroom for IOB/COB row (top: 12) + scenario badge (top: 28)
  private readonly PAD_BOTTOM      = 80;  // time row(22) + gap(8) + basal panel(44) + margin(6)
  private readonly BASAL_PANEL_H   = 56;  // taller for legibility
  private readonly BASAL_PANEL_OFF = 30;

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
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setPlayback(throttle: number, running: boolean): void {
    this.currentThrottle = throttle;
    this.isRunning = running;
    this.dirty = true;
  }

  setZoom(minutes: number): void {
    this.viewWindowMinutes = Math.max(180, Math.min(1440, minutes));
    this.dirty = true;
    this.notifyViewChange();
  }

  snapToLive(): void {
    this.viewOffsetMs = 0;
    this.dirty = true;
    this.notifyViewChange();
  }

  get isLive(): boolean { return this.viewOffsetMs === 0; }
  get zoomMinutes(): number { return this.viewWindowMinutes; }

  onViewChange(cb: () => void): void { this.viewChangeCallbacks.push(cb); }

  pushTick(snap: TickSnapshot): void {
    this.ring.push({
      simTimeMs: snap.simTimeMs, cgm: snap.cgm, trueGlucose: snap.trueGlucose,
      iob: snap.iob, cob: snap.cob, trend: snap.trend, basalRate: snap.basalRate,
    });
    this.lastTickWallMs = performance.now();
    this.dirty = true;
  }

  pushComparisonTick(snap: TickSnapshot): void {
    this.comparisonRing.push({
      simTimeMs: snap.simTimeMs, cgm: snap.cgm, trueGlucose: snap.trueGlucose,
      iob: snap.iob, cob: snap.cob, trend: snap.trend, basalRate: snap.basalRate,
    });
    this.dirty = true;
  }

  get hasComparison(): boolean { return this.comparisonRing.size > 0; }

  pushEvents(evs: SimEvent[]): void {
    for (const ev of evs) this.events.push(ev);
    this.dirty = true;
  }

  clearHistory(): void {
    this.ring.clear();
    this.comparisonRing.clear();
    this.events = [];
    this.viewOffsetMs = 0;
    this.dirty = true;
    this.notifyViewChange();
  }

  clearComparison(): void {
    this.comparisonRing.clear();
    this.dirty = true;
  }

  markDirty(): void { this.dirty = true; }

  start(): void {
    this.dirty = true;
    this.setupPanZoom();
    const loop = () => {
      if (this.dirty || this.isRunning) {
        this.render();
        this.dirty = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void { cancelAnimationFrame(this.rafId); }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  private get plotW(): number { return this.cssW - this.PAD_LEFT - this.PAD_RIGHT; }
  private get plotH(): number { return this.cssH - this.PAD_TOP - this.PAD_BOTTOM; }

  private toDisplay(mgdl: number): number {
    return this.options.displayUnit === 'mmoll' ? mgdl / 18.0182 : mgdl;
  }

  private glucoseY(mgdl: number): number {
    const MIN = 40, MAX = 400;
    return this.PAD_TOP + (1 - (mgdl - MIN) / (MAX - MIN)) * this.plotH;
  }

  private timeX(minuteOffset: number): number {
    return this.PAD_LEFT + (minuteOffset / this.viewWindowMinutes) * this.plotW;
  }

  // Live-follow window start (original drift spec), then subtract pan offset.
  private getWinStart(latestSimMs: number): number {
    const latestMin = latestSimMs / 60_000;
    const histMin = this.viewWindowMinutes * 0.75; // 75% history, 25% future
    const liveStart = latestMin <= histMin ? 0 : latestMin - histMin;
    return liveStart - this.viewOffsetMs / 60_000;
  }

  // ── Pan / zoom event handling ─────────────────────────────────────────────

  private setupPanZoom(): void {
    const canvas = this.canvas;
    canvas.style.cursor = 'grab';

    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartOffset = this.viewOffsetMs;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.applyDrag(e.clientX);
    });

    window.addEventListener('mouseup', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      canvas.style.cursor = 'grab';
    });

    // Touch: single finger = pan, two fingers = pinch zoom
    canvas.addEventListener('touchstart', (e) => {
      const touches = Array.from(e.touches);
      if (touches.length === 1) {
        this.isDragging = true;
        this.dragStartX = touches[0]!.clientX;
        this.dragStartOffset = this.viewOffsetMs;
      } else if (touches.length === 2) {
        this.isDragging = false;
        this.pinchStartDist = Math.hypot(
          touches[0]!.clientX - touches[1]!.clientX,
          touches[0]!.clientY - touches[1]!.clientY,
        );
        this.pinchStartWindow = this.viewWindowMinutes;
      }
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      const touches = Array.from(e.touches);
      if (touches.length === 1 && this.isDragging) {
        this.applyDrag(touches[0]!.clientX);
      } else if (touches.length === 2) {
        const dist = Math.hypot(
          touches[0]!.clientX - touches[1]!.clientX,
          touches[0]!.clientY - touches[1]!.clientY,
        );
        const raw = this.pinchStartWindow * (this.pinchStartDist / dist);
        this.viewWindowMinutes = Math.max(180, Math.min(1440, raw));
        this.dirty = true;
        this.notifyViewChange();
      }
      e.preventDefault();
    }, { passive: false });

    // Wheel: cycle through zoom levels
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const levels = [180, 360, 720, 1440];
      const idx = levels.indexOf(this.viewWindowMinutes);
      const current = idx === -1 ? levels.length - 1 : idx;
      const next = e.deltaY > 0
        ? Math.min(current + 1, levels.length - 1)  // scroll down → zoom out
        : Math.max(current - 1, 0);                  // scroll up  → zoom in
      if (next !== current) {
        this.viewWindowMinutes = levels[next]!;
        this.dirty = true;
        this.notifyViewChange();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
      this.isDragging = false;
      // Snap to nearest discrete zoom level after pinch
      const levels = [180, 360, 720, 1440];
      this.viewWindowMinutes = levels.reduce((best, lvl) =>
        Math.abs(lvl - this.viewWindowMinutes) < Math.abs(best - this.viewWindowMinutes) ? lvl : best
      );
      this.dirty = true;
      this.notifyViewChange();
    });
  }

  private applyDrag(clientX: number): void {
    const dx = clientX - this.dragStartX;
    const msPerPixel = (this.viewWindowMinutes * 60_000) / this.plotW;
    const delta = dx * msPerPixel; // drag right → graph moves right → older data
    const latest = this.ring.latest();
    const latestSimMs = latest?.simTimeMs ?? 0;
    const histMin = this.viewWindowMinutes * 0.75;
    const liveStartMs = Math.max(0, latestSimMs - histMin * 60_000);
    this.viewOffsetMs = Math.max(0, Math.min(this.dragStartOffset + delta, liveStartMs));
    this.dirty = true;
    this.notifyViewChange();
  }

  private notifyViewChange(): void {
    for (const cb of this.viewChangeCallbacks) cb();
  }

  // ── Main render ───────────────────────────────────────────────────────────

  private render(): void {
    if (this.cssW === 0 || this.cssH === 0) {
      this.resize();
      if (this.cssW === 0 || this.cssH === 0) return;
    }
    const W = this.cssW, H = this.cssH;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    const latest = this.ring.latest();
    const latestSimMs = latest?.simTimeMs ?? 0;
    const animSimMs = this.computeAnimatedSimMs(latest);
    const winStartMin = this.getWinStart(latestSimMs);

    this.drawBands(winStartMin);
    this.drawFutureSpace(winStartMin, animSimMs);
    this.drawGrid(winStartMin);

    if (this.options.showBasal) this.drawBasalOverlay(winStartMin);
    if (this.options.showCOB) this.drawCOBOverlay(winStartMin);
    if (this.options.showIOB) this.drawIOBOverlay(winStartMin);
    if (this.options.showTrueGlucose) this.drawTrueLine(winStartMin);

    this.drawTrace(winStartMin);
    this.drawAnimatedExtension(winStartMin, latest, animSimMs);

    if (this.hasComparison) {
      this.drawComparisonTrace(winStartMin);
      this.drawLegend();
    }

    if (this.options.showEvents) this.drawEventMarkers(winStartMin);
  }

  // ── Draw layers ───────────────────────────────────────────────────────────

  private drawBands(winStartMin: number): void {
    void winStartMin;
    const ctx = this.ctx;
    const xL = this.PAD_LEFT;
    const xR = this.PAD_LEFT + this.plotW;
    const yTop      = this.glucoseY(TIR_HIGH);   // 180 mg/dL line
    const yBot      = this.glucoseY(TIR_LOW);    //  70 mg/dL line
    const yAmberBot = this.glucoseY(HYPO_L1);    //  54 mg/dL line
    const yRedFloor = this.glucoseY(40);

    // Translucent zone fills
    ctx.fillStyle = COLORS.greenBand;
    ctx.fillRect(xL, yTop, this.plotW, yBot - yTop);
    ctx.fillStyle = COLORS.amberBand;
    ctx.fillRect(xL, yBot, this.plotW, yAmberBot - yBot);
    ctx.fillStyle = COLORS.redBand;
    ctx.fillRect(xL, yAmberBot, this.plotW, yRedFloor - yAmberBot);

    // Crisp threshold lines on top of the bands
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.hyperLine;
    ctx.beginPath(); ctx.moveTo(xL, yTop); ctx.lineTo(xR, yTop); ctx.stroke();

    ctx.strokeStyle = COLORS.hypoLine;
    ctx.beginPath(); ctx.moveTo(xL, yBot); ctx.lineTo(xR, yBot); ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.hypoL2Line;
    ctx.beginPath(); ctx.moveTo(xL, yAmberBot); ctx.lineTo(xR, yAmberBot); ctx.stroke();
  }

  private drawFutureSpace(winStartMin: number, animSimMs: number): void {
    const animMin = animSimMs / 60_000;
    const filledOffset = animMin - winStartMin;
    const xStart = this.timeX(filledOffset);
    const xEnd = this.timeX(this.viewWindowMinutes);
    if (xStart >= xEnd) return;
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.future;
    ctx.fillRect(xStart, this.PAD_TOP, xEnd - xStart, this.plotH);

    // Soft accent line at the "now" boundary
    ctx.strokeStyle = COLORS.futureEdge;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xStart, this.PAD_TOP);
    ctx.lineTo(xStart, this.PAD_TOP + this.plotH);
    ctx.stroke();
    ctx.setLineDash([]);
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
    ctx.setLineDash([]);                     // solid (was [4,4])
    ctx.font = '14px -apple-system, sans-serif';
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
      ctx.fillText(label, this.PAD_LEFT - 6, y + 5);
    }

    // Vertical time lines — adaptive density based on zoom level
    const stepMin = this.viewWindowMinutes <= 180 ? 30
      : this.viewWindowMinutes <= 360 ? 60
      : this.viewWindowMinutes <= 720 ? 120 : 180;

    ctx.textAlign = 'center';
    const firstMark = Math.ceil(winStartMin / stepMin) * stepMin;
    for (let simMin = firstMark; simMin <= winStartMin + this.viewWindowMinutes; simMin += stepMin) {
      const offsetMin = simMin - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) continue;

      const x = this.timeX(offsetMin);
      const isMidnight = Math.round(simMin) % (24 * 60) === 0;

      ctx.strokeStyle = isMidnight ? COLORS.gridDay : COLORS.grid;
      ctx.lineWidth   = isMidnight ? 1.5 : 1;
      ctx.setLineDash([]);                   // all solid
      ctx.beginPath();
      ctx.moveTo(x, this.PAD_TOP);
      ctx.lineTo(x, this.PAD_TOP + this.plotH);
      ctx.stroke();

      const totalMin = Math.round(simMin);
      const absHour = Math.floor(totalMin / 60) % 24;
      const absMin = totalMin % 60;
      const label = `${String(absHour).padStart(2, '0')}:${String(absMin).padStart(2, '0')}`;
      ctx.fillStyle = isMidnight ? COLORS.gridStrong : COLORS.gridLabel;
      ctx.fillText(label, x, this.PAD_TOP + this.plotH + 18);
    }
  }

  private drawTrace(winStartMin: number): void {
    if (this.ring.size === 0) return;
    this.drawDots(this.ring, winStartMin, true);
  }

  private drawComparisonTrace(winStartMin: number): void {
    if (this.comparisonRing.size === 0) return;
    this.drawDots(this.comparisonRing, winStartMin, false);
  }

  private drawLegend(): void {
    const ctx = this.ctx;
    const x = this.PAD_LEFT + 8, y = this.PAD_TOP + 10, swatch = 14, gap = 6;
    ctx.font = 'bold 13.2px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = COLORS.trace;
    ctx.fillRect(x, y - swatch / 2, swatch, swatch);
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(this.options.primaryLabel, x + swatch + gap, y);

    const x2 = x + swatch + gap + ctx.measureText(this.options.primaryLabel).width + 16;
    ctx.fillStyle = COMPARE_COLORS.trace;
    ctx.fillRect(x2, y - swatch / 2, swatch, swatch);
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(this.options.compareLabel, x2 + swatch + gap, y);
    ctx.textBaseline = 'alphabetic';
  }

  private drawDots(ring: RingBuffer, winStartMin: number, colorByZone: boolean): void {
    const ctx = this.ctx;
    // Dot radius scales with zoom: smaller when many points are visible
    const r = this.viewWindowMinutes <= 180 ? 3.5 : this.viewWindowMinutes <= 360 ? 2.5 : 2;
    ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      const x = this.timeX(offsetMin);
      const y = this.glucoseY(entry.cgm);
      const color = colorByZone
        ? (entry.cgm < HYPO_L1 ? COLORS.traceHypoL2 : entry.cgm < TIR_LOW ? COLORS.traceHypoL1 : COLORS.trace)
        : COMPARE_COLORS.trace;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
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
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;

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
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      const x = this.timeX(offsetMin);
      const y = this.glucoseY(entry.trueGlucose);
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawBasalOverlay(winStartMin: number): void {
    if (this.ring.size === 0) return;
    const ctx = this.ctx;
    const MAX_BASAL  = 2;
    const mainBottom = this.PAD_TOP + this.plotH;
    const panelTop   = mainBottom + this.BASAL_PANEL_OFF;
    const panelBot   = panelTop + this.BASAL_PANEL_H;

    // Separator line between time-label zone and basal panel
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(this.PAD_LEFT, panelTop - 4);
    ctx.lineTo(this.PAD_LEFT + this.plotW, panelTop - 4);
    ctx.stroke();

    // Y-axis tick labels: '2' at top, '0' at bottom
    ctx.font = '12px -apple-system, sans-serif';
    ctx.fillStyle = COLORS.basalLine;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('2', this.PAD_LEFT - 3, panelTop);
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', this.PAD_LEFT - 3, panelBot);

    // Rotated 'Basal' label on the left margin
    ctx.save();
    ctx.font = '12px -apple-system, sans-serif';
    ctx.fillStyle = COLORS.basalLine;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(this.PAD_LEFT - 18, panelTop + this.BASAL_PANEL_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Basal', 0, 0);
    ctx.restore();

    // Collect visible step points
    const pts: { x: number; y: number }[] = [];
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      pts.push({
        x: this.timeX(offsetMin),
        y: panelBot - Math.min(entry.basalRate / MAX_BASAL, 1) * this.BASAL_PANEL_H,
      });
    });
    if (pts.length === 0) return;

    // Filled area
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, panelBot);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      ctx.lineTo(p.x, p.y);
      if (i + 1 < pts.length) ctx.lineTo(pts[i + 1]!.x, p.y);
    }
    ctx.lineTo(pts[pts.length - 1]!.x, panelBot);
    ctx.closePath();
    ctx.fillStyle = COLORS.basalFill;
    ctx.fill();

    // Step line
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      if (i + 1 < pts.length) ctx.lineTo(pts[i + 1]!.x, p.y);
    }
    ctx.strokeStyle = COLORS.basalLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();

    // Current rate readout inside the panel (bottom-left)
    const latest = this.ring.latest();
    if (latest) {
      ctx.font = 'bold 14px -apple-system, sans-serif';
      ctx.fillStyle = '#eef2fa';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${latest.basalRate.toFixed(2)} U/h`, this.PAD_LEFT + 6, panelBot - 3);
      ctx.textBaseline = 'alphabetic';
    }
  }

  private drawIOBOverlay(winStartMin: number): void {
    if (this.ring.size === 0) return;
    const ctx = this.ctx;
    const maxIOB = 5, maxPx = this.plotH * 0.28;
    const baseY = this.glucoseY(TIR_HIGH);
    const peakY = baseY - maxPx;

    // Collect visible points once
    const pts: { x: number; y: number }[] = [];
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      pts.push({
        x: this.timeX(offsetMin),
        y: baseY - Math.min(entry.iob / maxIOB, 1) * maxPx,
      });
    });
    if (pts.length === 0) return;

    // Gradient fill: stronger teal near the peak, fading toward the baseline
    const grad = ctx.createLinearGradient(0, peakY, 0, baseY);
    grad.addColorStop(0, COLORS.iobFillTop);
    grad.addColorStop(1, COLORS.iobFill);

    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, baseY);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[pts.length - 1]!.x, baseY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Top edge stroke
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.strokeStyle = COLORS.iobLine;
    ctx.lineWidth = 1.75;
    ctx.setLineDash([]);
    ctx.stroke();

    // Baseline reference line (subtle, helps anchor the eye)
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, baseY);
    ctx.lineTo(pts[pts.length - 1]!.x, baseY);
    ctx.strokeStyle = COLORS.iobLine;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.35;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawCOBOverlay(winStartMin: number): void {
    if (this.ring.size === 0) return;
    const ctx = this.ctx;
    const maxCOB = 80, maxPx = this.plotH * 0.22;
    const baseY = this.glucoseY(TIR_HIGH);
    const peakY = baseY - maxPx;

    const pts: { x: number; y: number }[] = [];
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      pts.push({
        x: this.timeX(offsetMin),
        y: baseY - Math.min(entry.cob / maxCOB, 1) * maxPx,
      });
    });
    if (pts.length === 0) return;

    const grad = ctx.createLinearGradient(0, peakY, 0, baseY);
    grad.addColorStop(0, COLORS.cobFillTop);
    grad.addColorStop(1, COLORS.cobFill);

    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, baseY);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[pts.length - 1]!.x, baseY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.strokeStyle = COLORS.cobLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  private computeAnimatedSimMs(latest: RingEntry | null): number {
    // No animation when paused or when the user is reviewing history
    if (!latest || !this.isRunning || this.viewOffsetMs > 0) return latest?.simTimeMs ?? 0;
    const advance = (performance.now() - this.lastTickWallMs) * this.currentThrottle;
    return Math.min(latest.simTimeMs + advance, latest.simTimeMs + TICK_MINUTES * 60_000);
  }

  private drawAnimatedExtension(winStartMin: number, latest: RingEntry | null, animSimMs: number): void {
    if (!latest || !this.isRunning || this.viewOffsetMs > 0) return;
    if (animSimMs <= latest.simTimeMs) return;

    const lastOffsetMin = latest.simTimeMs / 60_000 - winStartMin;
    if (lastOffsetMin > this.viewWindowMinutes) return;

    const animOffsetMin = animSimMs / 60_000 - winStartMin;
    const x1 = this.timeX(lastOffsetMin);
    const x2 = this.timeX(Math.min(animOffsetMin, this.viewWindowMinutes));

    const dtMin = (animSimMs - latest.simTimeMs) / 60_000;
    const extrapCGM = Math.max(40, Math.min(400, latest.cgm + latest.trend * dtMin));
    const y1 = this.glucoseY(latest.cgm);
    const y2 = this.glucoseY(extrapCGM);

    const color = extrapCGM < HYPO_L1 ? COLORS.traceHypoL2
      : extrapCGM < TIR_LOW ? COLORS.traceHypoL1 : COLORS.trace;

    const ctx = this.ctx;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  private drawEventMarkers(winStartMin: number): void {
    const ctx = this.ctx;
    if (!this.ring.latest()) return;

    for (const ev of this.events) {
      const offsetMin = ev.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) continue;

      const x = this.timeX(offsetMin);

      if (ev.kind === 'bolus') {
        const y = this.PAD_TOP + this.plotH;
        ctx.beginPath();
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x - 5, y - 12);
        ctx.lineTo(x + 5, y - 12);
        ctx.closePath();
        ctx.fillStyle = COLORS.bolusMarker;
        ctx.fill();
        ctx.fillStyle = COLORS.bolusMarker;
        ctx.font = 'bold 10.8px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${ev.units}U`, x, y - 15);
      } else if (ev.kind === 'meal') {
        const y = this.PAD_TOP;
        ctx.beginPath();
        ctx.moveTo(x, y + 2);
        ctx.lineTo(x - 5, y + 12);
        ctx.lineTo(x + 5, y + 12);
        ctx.closePath();
        ctx.fillStyle = COLORS.mealMarker;
        ctx.fill();
        ctx.fillStyle = COLORS.mealMarker;
        ctx.font = 'bold 10.8px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${ev.carbsG}g`, x, y + 24);
      } else if (ev.kind === 'smb') {
        // Small upward triangle just above the bottom axis — visually distinct from manual bolus
        const y = this.PAD_TOP + this.plotH - 18;
        ctx.beginPath();
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x - 4, y + 6);
        ctx.lineTo(x + 4, y + 6);
        ctx.closePath();
        ctx.fillStyle = COLORS.smbMarker;
        ctx.fill();
        ctx.fillStyle = COLORS.smbMarker;
        ctx.font = '9.6px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${ev.units}U`, x, y + 16);
      }
    }
    ctx.textAlign = 'left';
  }
}
