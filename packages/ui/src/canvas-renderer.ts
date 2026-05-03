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

import type { TickSnapshot, DisplayUnit, SimEvent, CGMTracePoint } from '@cgmsim/shared';
import { ar2Forecast } from '../../simulator/src/ar2.js';
import type { ForecastPoint } from '../../simulator/src/ar2.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MINUTES = 12 * 60;
const TICK_MINUTES = 1;
const MAX_BUFFER = 7 * 24 * 60 / TICK_MINUTES + 1; // 7 days of 5-min ticks

// ATTD glucose thresholds (mg/dL)
const TIR_LOW = 70;
const TIR_HIGH = 180;
const HYPO_L1 = 54;

// Canvas colour palettes — swapped wholesale on theme change.
type ColorPalette = {
  bg: string; grid: string; gridStrong: string; gridLabel: string; gridDay: string;
  greenBand: string; amberBand: string; redBand: string;
  hypoLine: string; hypoL2Line: string; hyperLine: string; lowLine: string;
  trace: string; traceGlow: string; traceHypoL1: string; traceHypoL2: string; trueGlucose: string;
  iobFill: string; iobFillTop: string; iobLine: string;
  cobFill: string; cobFillTop: string; cobLine: string;
  basalFill: string; basalLine: string;
  bolusMarker: string; mealMarker: string; smbMarker: string; longActingMarker: string;
  bolusMarkerBottom: string; mealMarkerBottom: string; smbMarkerBottom: string; longActingMarkerBottom: string;
  markerStroke: string;
  markerLabelBg: string;
  future: string; futureEdge: string;
  forecast: string;
};
type ComparePalette = { trace: string; traceGlow: string; hypoL1: string; hypoL2: string; };

const DARK_PALETTE: ColorPalette = {
  bg: '#0a0f1c',
  grid: 'rgba(80, 92, 118, 0.45)',
  gridStrong: 'rgba(120, 134, 162, 0.65)',
  gridLabel: 'rgba(148, 160, 184, 0.85)',
  gridDay: 'rgba(122, 162, 255, 0.30)',
  greenBand: 'rgba(16, 185, 129, 0.18)',
  amberBand: 'rgba(245, 158, 11, 0.20)',
  redBand:   'rgba(239, 68, 68, 0.20)',
  hypoLine:  '#ef4444',
  hypoL2Line:'#dc2626',
  hyperLine: '#f59e0b',
  lowLine:   '#10b981',
  trace:        '#22c55e',
  traceGlow:    'rgba(34, 197, 94, 0.40)',
  traceHypoL1:  '#f59e0b',
  traceHypoL2:  '#ef4444',
  trueGlucose:  'rgba(238, 242, 250, 0.28)',
  iobFill:    'rgba(96, 165, 250, 0.10)',
  iobFillTop: 'rgba(96, 165, 250, 0.32)',
  iobLine:    'rgba(96, 165, 250, 0.85)',
  cobFill:    'rgba(251, 191, 36, 0.22)',
  cobFillTop: 'rgba(251, 191, 36, 0.50)',
  cobLine:    'rgba(251, 191, 36, 0.90)',
  basalFill:  'rgba(245, 158, 11, 0.18)',
  basalLine:  'rgba(217, 119, 6, 0.85)',
  bolusMarker: '#60a5fa',                        // matches IOB overlay sky-blue (gradient top + label)
  mealMarker:  '#fbbf24',                        // matches COB overlay amber (gradient top + label)
  smbMarker:   '#c084fc',
  longActingMarker: '#14b8a6',                   // teal — distinct hue family from bolus sky-blue
  bolusMarkerBottom:      '#2563eb',             // gradient bottom — deeper blue
  mealMarkerBottom:       '#d97706',             // gradient bottom — deeper amber, pulls hue away from yellow
  smbMarkerBottom:        '#9333ea',             // gradient bottom — deeper purple
  longActingMarkerBottom: '#0d9488',             // gradient bottom — deeper rose
  markerStroke: '#cbd5e1',                       // slate 300 — soft outline against dark bg
  markerLabelBg: 'rgba(28, 34, 54, 0.78)',       // matches --bg-surface w/ alpha
  future: 'rgba(8, 12, 22, 0.45)',
  futureEdge: 'rgba(122, 162, 255, 0.35)',
  forecast: '#94a3b8',                           // slate-400 — light grey, readable against dark bg
};

const LIGHT_PALETTE: ColorPalette = {
  bg: '#ffffff',
  grid: 'rgba(15, 23, 42, 0.10)',
  gridStrong: 'rgba(15, 23, 42, 0.22)',
  gridLabel: 'rgba(71, 85, 105, 0.85)',
  gridDay: 'rgba(59, 130, 246, 0.35)',
  greenBand: 'rgba(16, 185, 129, 0.10)',
  amberBand: 'rgba(245, 158, 11, 0.12)',
  redBand:   'rgba(239, 68, 68, 0.12)',
  hypoLine:  '#dc2626',
  hypoL2Line:'#b91c1c',
  hyperLine: '#d97706',
  lowLine:   '#16a34a',
  trace:        '#16a34a',                       // Loop green CGM
  traceGlow:    'rgba(22, 163, 74, 0.25)',
  traceHypoL1:  '#d97706',
  traceHypoL2:  '#dc2626',
  trueGlucose:  'rgba(15, 23, 42, 0.22)',
  iobFill:    'rgba(96, 165, 250, 0.10)',          // lighter sky-blue IOB
  iobFillTop: 'rgba(96, 165, 250, 0.28)',
  iobLine:    'rgba(96, 165, 250, 0.80)',
  cobFill:    'rgba(251, 191, 36, 0.22)',         // amber-400 carbs — yellower than basal
  cobFillTop: 'rgba(251, 191, 36, 0.50)',
  cobLine:    'rgba(234, 179, 8, 0.90)',
  basalFill:  'rgba(245, 158, 11, 0.18)',
  basalLine:  'rgba(217, 119, 6, 0.85)',
  bolusMarker: '#60a5fa',                        // matches IOB overlay sky-blue (gradient top + label)
  mealMarker:  '#fbbf24',                        // matches COB overlay amber (gradient top + label)
  smbMarker:   '#c084fc',
  longActingMarker: '#14b8a6',                   // teal — distinct hue family from bolus sky-blue
  bolusMarkerBottom:      '#2563eb',
  mealMarkerBottom:       '#d97706',
  smbMarkerBottom:        '#9333ea',
  longActingMarkerBottom: '#0d9488',
  markerStroke: '#64748b',                       // soft slate outline against light bg
  markerLabelBg: 'rgba(255, 255, 255, 0.85)',
  future: 'rgba(15, 23, 42, 0.04)',
  futureEdge: 'rgba(59, 130, 246, 0.30)',
  forecast: '#475569',                           // slate-600 — dark grey, readable against light bg
};

const DARK_COMPARE: ComparePalette = {
  trace:     '#fb7185',
  traceGlow: 'rgba(251, 113, 133, 0.35)',
  hypoL1:    '#fdba74',
  hypoL2:    '#f87171',
};
const LIGHT_COMPARE: ComparePalette = {
  trace:     '#e11d48',
  traceGlow: 'rgba(225, 29, 72, 0.25)',
  hypoL1:    '#ea580c',
  hypoL2:    '#dc2626',
};

let COLORS: ColorPalette = DARK_PALETTE;
let COMPARE_COLORS: ComparePalette = DARK_COMPARE;

const LONG_ACTING_BRANDS = {
  GlargineU100: 'Lantus',
  GlargineU300: 'Toujeo',
  Detemir:      'Levemir',
  Degludec:     'Tresiba',
} as const;

export function setRendererTheme(theme: 'dark' | 'light'): void {
  if (theme === 'light') { COLORS = LIGHT_PALETTE; COMPARE_COLORS = LIGHT_COMPARE; }
  else { COLORS = DARK_PALETTE; COMPARE_COLORS = DARK_COMPARE; }
}

/** Convert a `#rrggbb` hex to `rgba(r,g,b,a)`. Pass-through for non-hex inputs (already rgba/named). */
function withAlpha(hex: string, alpha: number): string {
  if (hex.length === 7 && hex[0] === '#') {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface RendererOptions {
  showIOB: boolean;
  showCOB: boolean;
  showBasal: boolean;
  showTrueGlucose: boolean;
  showEvents: boolean;
  showForecast: boolean;
  displayUnit: DisplayUnit;
  primaryLabel: string;
  compareLabel: string;
  /** Therapy mode — used to suppress mode-irrelevant overlays (e.g. basal in MDI). */
  therapyMode: 'AID' | 'PUMP' | 'MDI';
}

// Ring buffer entry shape — sourced from @cgmsim/shared so the on-disk session JSON
// and the in-memory chart trace share a single canonical type.
type RingEntry = CGMTracePoint;

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

  /** Last n entries in chronological order (oldest first). Returns fewer than n if buffer is shorter. */
  lastN(n: number): RingEntry[] {
    const cap = this.buf.length;
    const count = Math.min(n, this._size);
    const out: RingEntry[] = [];
    for (let i = count; i > 0; i--) {
      const idx = (this.head - i + cap) % cap;
      const e = this.buf[idx];
      if (e != null) out.push(e);
    }
    return out;
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
    showForecast: true,
    displayUnit: 'mmoll',
    primaryLabel: 'Run A',
    compareLabel: 'Run B',
    therapyMode: 'PUMP',
  };

  // AR2 prediction points for the primary trace, recomputed each tick. Comparison runs
  // do not get a forecast — pedagogically we want one trace, one prediction, one divergence.
  private forecastPoints: ForecastPoint[] = [];

  private readonly PAD_LEFT        = 56;
  private readonly PAD_RIGHT       = 36;
  private readonly PAD_TOP         = 52;  // headroom for IOB/COB row (top: 12) + scenario badge (top: 28)
  private readonly PAD_BOTTOM      = 92;  // time row(22) + gap(8) + basal panel(56) + margin(6)
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
    this.updateForecast();
    this.dirty = true;
  }

  private updateForecast(): void {
    const last2 = this.ring.lastN(2);
    if (last2.length < 2) { this.forecastPoints = []; return; }
    this.forecastPoints = ar2Forecast(last2[0]!.cgm, last2[1]!.cgm, last2[1]!.simTimeMs);
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
    this.forecastPoints = [];
    this.viewOffsetMs = 0;
    this.dirty = true;
    this.notifyViewChange();
  }

  clearComparison(): void {
    this.comparisonRing.clear();
    this.dirty = true;
  }

  /** Snapshot the current chart trace in chronological order — for session export. */
  getHistorySnapshot(): CGMTracePoint[] {
    const out: CGMTracePoint[] = [];
    this.ring.forEach((e) => { out.push({ ...e }); });
    return out;
  }

  /** Replace the chart trace wholesale — for session import. Recomputes the AR2 forecast. */
  setHistorySnapshot(entries: CGMTracePoint[]): void {
    this.ring.clear();
    for (const e of entries) this.ring.push({ ...e });
    this.updateForecast();
    this.dirty = true;
  }

  /** Replace the discrete event log wholesale — for session import. */
  setEvents(events: SimEvent[]): void {
    this.events = events.map((e) => ({ ...e }));
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

  private bgYAtEventTime(simTimeMs: number): number {
    let bestCgm = -1;
    let bestDelta = Infinity;
    this.ring.forEach((e) => {
      const d = Math.abs(e.simTimeMs - simTimeMs);
      if (d < bestDelta) { bestDelta = d; bestCgm = e.cgm; }
    });
    const cgm = bestCgm >= 0 ? bestCgm : (this.ring.latest()?.cgm ?? 120);
    return this.glucoseY(cgm);
  }

  private treatmentRadius(value: number, kind: 'carbs' | 'insulin'): number {
    const equiv = kind === 'carbs' ? value : value * 10;
    return Math.max(3, Math.min(20, Math.sqrt(equiv) * 1.8));
  }

  private drawLabelChip(
    text: string,
    x: number,
    y: number,
    align: 'center' | 'left',
    baseline: 'top' | 'bottom' | 'middle',
    color: string,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    const tw = ctx.measureText(text).width;
    const fh = 14;
    const padX = 5, padY = 2;
    const w = tw + 2 * padX;
    const h = fh + 2 * padY;
    const cx = align === 'center' ? x - w / 2 : x - padX;
    const cy = baseline === 'top'    ? y - padY
             : baseline === 'bottom' ? y - h + padY
             :                         y - h / 2;
    ctx.beginPath();
    ctx.roundRect(cx, cy, w, h, 5);
    ctx.fillStyle = COLORS.markerLabelBg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.markerStroke;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, cy + h / 2);
    ctx.restore();
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
      this.hideTooltip();
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) { this.applyDrag(e.clientX); return; }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) return;
      const rect = canvas.getBoundingClientRect();
      this.updateTooltip(e.clientX - rect.left, e.clientY - rect.top);
    });

    canvas.addEventListener('mouseleave', () => this.hideTooltip());

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

  // ── Hover tooltip ─────────────────────────────────────────────────────────

  private tooltipEl: HTMLElement | null | undefined;

  private getTooltipEl(): HTMLElement | null {
    if (this.tooltipEl === undefined) {
      this.tooltipEl = document.getElementById('cgm-tooltip');
    }
    return this.tooltipEl ?? null;
  }

  private hideTooltip(): void {
    const el = this.getTooltipEl();
    if (el) el.classList.remove('visible');
  }

  private updateTooltip(mouseX: number, mouseY: number): void {
    const el = this.getTooltipEl();
    if (!el) return;
    const latest = this.ring.latest();
    if (!latest) { this.hideTooltip(); return; }

    const winStartMin = this.getWinStart(latest.simTimeMs);
    const HIT_RADIUS = 14; // px

    let bestDist = Infinity;
    let bestX = 0, bestY = 0;
    let bestEntry: RingEntry | null = null;

    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      const x = this.timeX(offsetMin);
      const y = this.glucoseY(entry.cgm);
      const d = Math.hypot(x - mouseX, y - mouseY);
      if (d < bestDist) { bestDist = d; bestX = x; bestY = y; bestEntry = entry; }
    });

    if (!bestEntry || bestDist > HIT_RADIUS) { this.hideTooltip(); return; }
    const e = bestEntry as RingEntry;

    const isMmoll = this.options.displayUnit === 'mmoll';
    const val = isMmoll ? (e.cgm / 18.0182).toFixed(1) : Math.round(e.cgm).toString();
    const unit = isMmoll ? 'mmol/L' : 'mg/dL';

    const totalMin = Math.round(e.simTimeMs / 60_000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timeLabel = `D${days}+${pad(hours)}:${pad(mins)}`;

    el.innerHTML = `<span class="time">${timeLabel}</span>${val} ${unit}`;
    el.style.left = `${bestX}px`;
    el.style.top = `${bestY}px`;
    el.classList.add('visible');
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

    // Canonical text state at the start of every frame. Individual draw helpers
    // override what they need; this guarantees a known starting point and stops
    // mid-frame leaks from contaminating the next frame.
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.setLineDash([]);

    const latest = this.ring.latest();
    const latestSimMs = latest?.simTimeMs ?? 0;
    const animSimMs = this.computeAnimatedSimMs(latest);
    const winStartMin = this.getWinStart(latestSimMs);

    this.drawBands();
    this.drawFutureSpace(winStartMin, animSimMs);
    this.drawGrid(winStartMin);

    if (this.options.showBasal && this.options.therapyMode !== 'MDI') this.drawBasalOverlay(winStartMin);
    if (this.options.showCOB) this.drawCOBOverlay(winStartMin);
    if (this.options.showIOB) this.drawIOBOverlay(winStartMin);
    if (this.options.showTrueGlucose) this.drawTrueLine(winStartMin);

    this.drawTrace(winStartMin);
    this.drawAnimatedExtension(winStartMin, latest, animSimMs);

    if (this.options.showForecast) this.drawForecast(winStartMin);

    if (this.hasComparison) {
      this.drawComparisonTrace(winStartMin);
      this.drawLegend();
    }

    if (this.options.showEvents) this.drawEventMarkers(winStartMin);
  }

  // ── Draw layers ───────────────────────────────────────────────────────────

  private drawBands(): void {
    const ctx = this.ctx;
    const xL = this.PAD_LEFT;
    const xR = this.PAD_LEFT + this.plotW;
    const yHigh = this.glucoseY(TIR_HIGH);   // 180 mg/dL — dashed orange
    const yLow  = this.glucoseY(TIR_LOW);    //  70 mg/dL — dashed green
    const yVlow = this.glucoseY(HYPO_L1);    //  54 mg/dL — dashed red

    ctx.lineWidth = 1.25;
    ctx.setLineDash([6, 5]);

    ctx.strokeStyle = COLORS.hyperLine;
    ctx.beginPath(); ctx.moveTo(xL, yHigh); ctx.lineTo(xR, yHigh); ctx.stroke();

    ctx.strokeStyle = COLORS.lowLine;
    ctx.beginPath(); ctx.moveTo(xL, yLow); ctx.lineTo(xR, yLow); ctx.stroke();

    ctx.strokeStyle = COLORS.hypoL2Line;
    ctx.beginPath(); ctx.moveTo(xL, yVlow); ctx.lineTo(xR, yVlow); ctx.stroke();

    ctx.setLineDash([]);
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
    ctx.textBaseline = 'alphabetic';

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

  private drawForecast(winStartMin: number): void {
    if (this.forecastPoints.length === 0) return;
    const ctx = this.ctx;
    // Match CGM dot size exactly — the forecast reads as a continuation of the trace.
    const rOuter = this.viewWindowMinutes <= 180 ? 3 : 2.5;
    // Hollow-ring style (port of Nightscout: fill=none, stroke). Pull the arc in by
    // half the stroke width so the visual outer edge still sits at rOuter.
    const lineWidth = 1;
    const rArc = rOuter - lineWidth / 2;
    ctx.lineWidth = lineWidth;
    const xMin = this.PAD_LEFT;
    const xMax = this.PAD_LEFT + this.plotW;

    for (const p of this.forecastPoints) {
      if (p.opacity <= 0) continue;
      const offsetMin = p.mills / 60_000 - winStartMin;
      const x = this.timeX(offsetMin);
      if (x < xMin || x > xMax) continue;          // clip to plot area (3h zoom drops the far dots)
      const y = this.glucoseY(p.mgdl);
      ctx.strokeStyle = withAlpha(COLORS.forecast, p.opacity);
      ctx.beginPath();
      ctx.arc(x, y, rArc, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawDots(ring: RingBuffer, winStartMin: number, colorByZone: boolean): void {
    const ctx = this.ctx;
    // Dot radius scales with zoom: smaller when many points are visible
    const r = this.viewWindowMinutes <= 180 ? 3 : 2.5;
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
      ctx.save();
      ctx.font = 'bold 14px -apple-system, sans-serif';
      ctx.fillStyle = '#eef2fa';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${latest.basalRate.toFixed(2)} U/h`, this.PAD_LEFT + 6, panelBot - 3);
      ctx.restore();
    }
  }

  private drawIOBOverlay(winStartMin: number): void {
    if (this.ring.size === 0) return;
    const ctx = this.ctx;
    const panelH = this.plotH * 0.25;
    const baseY  = this.glucoseY(TIR_HIGH);   // 10 mmol/L line — panel floor
    const topY   = baseY - panelH;            // panel ceiling

    // Pass 1: collect visible (offset, iob) and find peak — auto-scale Y
    const visible: { x: number; iob: number }[] = [];
    let peakIOB = 0;
    this.ring.forEach((entry) => {
      const offsetMin = entry.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) return;
      visible.push({ x: this.timeX(offsetMin), iob: entry.iob });
      if (entry.iob > peakIOB) peakIOB = entry.iob;
    });
    if (visible.length === 0) return;

    const niceCeil = (v: number): number => {
      if (v <= 0) return 4;
      const ladder = [4, 6, 8, 10, 15, 20, 30, 50, 75, 100];
      for (const c of ladder) if (c >= v) return c;
      return Math.ceil(v / 10) * 10;
    };
    const maxIOB = niceCeil(peakIOB * 1.10);

    const yFor = (iob: number): number =>
      baseY - Math.max(0, Math.min(iob / maxIOB, 1)) * panelH;

    const pts = visible.map((v) => ({ x: v.x, y: yFor(v.iob) }));

    // Gradient fill
    const grad = ctx.createLinearGradient(0, topY, 0, baseY);
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

    // Baseline reference line at the 10 mmol/L floor
    ctx.beginPath();
    ctx.moveTo(this.PAD_LEFT, baseY);
    ctx.lineTo(this.PAD_LEFT + this.plotW, baseY);
    ctx.strokeStyle = COLORS.iobLine;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.35;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Y-axis tick labels on the RIGHT margin: max at top, '0' at bottom
    const xRight = this.PAD_LEFT + this.plotW;
    ctx.font = '12px -apple-system, sans-serif';
    ctx.fillStyle = COLORS.iobLine;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const maxLabel = maxIOB >= 10 ? maxIOB.toFixed(0) : maxIOB.toFixed(1);
    ctx.fillText(maxLabel, xRight + 3, topY);
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', xRight + 3, baseY);

    // Rotated 'IOB' label on the right margin
    ctx.save();
    ctx.fillStyle = COLORS.iobLine;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(xRight + 22, topY + panelH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('IOB', 0, 0);
    ctx.restore();
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

    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = COLORS.markerStroke;
    ctx.lineWidth = 1.5;

    for (const ev of this.events) {
      const offsetMin = ev.simTimeMs / 60_000 - winStartMin;
      if (offsetMin < 0 || offsetMin > this.viewWindowMinutes) continue;

      const x = this.timeX(offsetMin);

      if (ev.kind === 'meal') {
        const cy = this.bgYAtEventTime(ev.simTimeMs);
        const r  = this.treatmentRadius(ev.carbsG, 'carbs');
        const grad = ctx.createLinearGradient(x, cy - r, x, cy + r);
        grad.addColorStop(0, COLORS.mealMarkerBottom + 'D9'); // dark stop on top, 0.85 alpha
        grad.addColorStop(1, COLORS.mealMarker + 'D9');       // light stop on bottom, 0.85 alpha
        ctx.beginPath();
        ctx.arc(x, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.stroke();
        this.drawLabelChip(`${ev.carbsG} g`, x, cy - r - 4, 'center', 'bottom', COLORS.mealMarker);
      } else if (ev.kind === 'bolus') {
        const cy = this.bgYAtEventTime(ev.simTimeMs);
        const r  = this.treatmentRadius(ev.units, 'insulin');
        const grad = ctx.createLinearGradient(x, cy - r, x, cy + r);
        grad.addColorStop(0, COLORS.bolusMarkerBottom + 'D9');
        grad.addColorStop(1, COLORS.bolusMarker + 'D9');
        ctx.beginPath();
        ctx.arc(x, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.stroke();
        this.drawLabelChip(`${ev.units} U`, x, cy + r + 4, 'center', 'top', COLORS.bolusMarker);
      } else if (ev.kind === 'longActing') {
        const cy = this.bgYAtEventTime(ev.simTimeMs);
        const r  = this.treatmentRadius(ev.units, 'insulin');
        const grad = ctx.createLinearGradient(x, cy - r, x, cy + r);
        grad.addColorStop(0, COLORS.longActingMarkerBottom + 'D9');
        grad.addColorStop(1, COLORS.longActingMarker + 'D9');
        ctx.beginPath();
        ctx.arc(x, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.stroke();
        const brand = LONG_ACTING_BRANDS[ev.insulinType];
        const label = `${brand} ${ev.units}U`;
        const labelWidth = ctx.measureText(label).width;
        // Default: read upward from below the marker. Flip downward when high-BG markers
        // would push the label off the top of the plot.
        const flipDown = (cy - r - 6 - labelWidth) < this.PAD_TOP;
        ctx.save();
        if (flipDown) {
          ctx.translate(x, cy + r + 6);
          ctx.rotate(Math.PI / 2);
        } else {
          ctx.translate(x, cy - r - 6);
          ctx.rotate(-Math.PI / 2);
        }
        this.drawLabelChip(label, 0, 0, 'left', 'middle', COLORS.longActingMarker);
        ctx.restore();
      } else if (ev.kind === 'smb') {
        // Small upward triangle just above the bottom axis — visually distinct from manual bolus
        const y = this.PAD_TOP + this.plotH - 18;
        const grad = ctx.createLinearGradient(x, y - 2, x, y + 6);
        grad.addColorStop(0, COLORS.smbMarkerBottom + 'D9');
        grad.addColorStop(1, COLORS.smbMarker + 'D9');
        ctx.beginPath();
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x - 4, y + 6);
        ctx.lineTo(x + 4, y + 6);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.stroke();
        this.drawLabelChip(`${ev.units} U`, x, y + 8, 'center', 'top', COLORS.smbMarker);
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}
