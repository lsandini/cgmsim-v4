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
  bg: '#0d1117',
  grid: 'rgba(48, 54, 61, 0.6)',
  gridLabel: '#8b949e',
  gridDay: 'rgba(88, 166, 255, 0.25)',
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
  basalFill: 'rgba(63, 185, 80, 0.12)',
  basalLine: 'rgba(63, 185, 80, 0.55)',
  bolusMarker: '#58a6ff',
  mealMarker: '#d29922',
  smbMarker: '#bc8cff',
  future: 'rgba(255, 255, 255, 0.03)',
};

const COMPARE_COLORS = {
  trace:     '#ff7b54',
  traceGlow: 'rgba(255, 123, 84, 0.30)',
  hypoL1:    '#ff9f43',
  hypoL2:    '#ee5a24',
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
  private readonly PAD_RIGHT       = 16;
  private readonly PAD_TOP         = 24;
  private readonly PAD_BOTTOM      = 80;  // time row(22) + gap(8) + basal panel(44) + margin(6)
  private readonly BASAL_PANEL_H   = 44;  // height of the basal sub-panel in px
  private readonly BASAL_PANEL_OFF = 30;  // offset of sub-panel top below main plot bottom

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
    const yTop = this.glucoseY(TIR_HIGH);
    const yBot = this.glucoseY(TIR_LOW);
    ctx.fillStyle = COLORS.greenBand;
    ctx.fillRect(this.PAD_LEFT, yTop, this.plotW, yBot - yTop);

    const yAmberBot = this.glucoseY(HYPO_L1);
    ctx.fillStyle = COLORS.amberBand;
    ctx.fillRect(this.PAD_LEFT, yBot, this.plotW, yAmberBot - yBot);

    ctx.fillStyle = COLORS.redBand;
    ctx.fillRect(this.PAD_LEFT, yAmberBot, this.plotW, this.glucoseY(40) - yAmberBot);
  }

  private drawFutureSpace(winStartMin: number, animSimMs: number): void {
    const animMin = animSimMs / 60_000;
    const filledOffset = animMin - winStartMin;
    const xStart = this.timeX(filledOffset);
    const xEnd = this.timeX(this.viewWindowMinutes);
    if (xStart >= xEnd) return;
    this.ctx.fillStyle = COLORS.future;
    this.ctx.fillRect(xStart, this.PAD_TOP, xEnd - xStart, this.plotH);
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
      ctx.lineWidth = isMidnight ? 1.5 : 1;
      ctx.setLineDash(isMidnight ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, this.PAD_TOP);
      ctx.lineTo(x, this.PAD_TOP + this.plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;

      const totalMin = Math.round(simMin);
      const absHour = Math.floor(totalMin / 60) % 24;
      const absMin = totalMin % 60;
      const label = `${String(absHour).padStart(2, '0')}:${String(absMin).padStart(2, '0')}`;
      ctx.fillStyle = isMidnight ? COLORS.trace : COLORS.gridLabel;
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
    ctx.font = 'bold 11px -apple-system, sans-serif';
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
    ctx.font = '9px -apple-system, sans-serif';
    ctx.fillStyle = COLORS.basalLine;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('2', this.PAD_LEFT - 3, panelTop);
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', this.PAD_LEFT - 3, panelBot);

    // Rotated 'Basal' label on the left margin
    ctx.save();
    ctx.font = '9px -apple-system, sans-serif';
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
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillStyle = COLORS.basalLine;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${latest.basalRate.toFixed(2)} U/h`, this.PAD_LEFT + 6, panelBot - 2);
      ctx.textBaseline = 'alphabetic';
    }
  }

  private drawIOBOverlay(winStartMin: number): void {
    if (this.ring.size === 0) return;
    const ctx = this.ctx;
    const maxIOB = 5, maxPx = this.plotH * 0.25;
    const baseY = this.glucoseY(TIR_HIGH);

    let lastX = 0, hasPoints = false;

    ctx.beginPath();
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      const x = this.timeX(offsetMin);
      const y = baseY - Math.min(entry.iob / maxIOB, 1) * maxPx;
      if (!hasPoints) { ctx.moveTo(x, baseY); ctx.lineTo(x, y); hasPoints = true; }
      else ctx.lineTo(x, y);
      lastX = x;
    });
    if (!hasPoints) return;

    ctx.lineTo(lastX, baseY);
    ctx.closePath();
    ctx.fillStyle = COLORS.iobFill;
    ctx.fill();

    ctx.beginPath();
    let first = true;
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      const x = this.timeX(offsetMin);
      const y = baseY - Math.min(entry.iob / maxIOB, 1) * maxPx;
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
    const maxCOB = 80, maxPx = this.plotH * 0.20;
    const baseY = this.glucoseY(TIR_HIGH);

    let lastX = 0, hasPoints = false;

    ctx.beginPath();
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      const x = this.timeX(offsetMin);
      const y = baseY - Math.min(entry.cob / maxCOB, 1) * maxPx;
      if (!hasPoints) { ctx.moveTo(x, baseY); ctx.lineTo(x, y); hasPoints = true; }
      else ctx.lineTo(x, y);
      lastX = x;
    });
    if (!hasPoints) return;

    ctx.lineTo(lastX, baseY);
    ctx.closePath();
    ctx.fillStyle = COLORS.cobFill;
    ctx.fill();

    ctx.beginPath();
    let first = true;
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      const x = this.timeX(offsetMin);
      const y = baseY - Math.min(entry.cob / maxCOB, 1) * maxPx;
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = COLORS.cobLine;
    ctx.lineWidth = 1.5;
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
        ctx.font = 'bold 9px -apple-system, sans-serif';
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
        ctx.font = 'bold 9px -apple-system, sans-serif';
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
        ctx.font = '8px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${ev.units}U`, x, y + 16);
      }
    }
    ctx.textAlign = 'left';
  }
}
