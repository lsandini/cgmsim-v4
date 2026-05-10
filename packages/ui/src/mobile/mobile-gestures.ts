/**
 * mobile-gestures.ts
 *
 * Pointer-based gesture handling for the CGM canvas on mobile:
 *   - Single-tap → callback (used for play/pause toggle)
 *   - Tap near a marker → popover showing event kind, value, timestamp
 *   - Pinch zoom is handled by CGMRenderer's existing touch handlers;
 *     this module just persists the resulting zoom to localStorage on change.
 *
 * Two-finger pan is deferred to v2 (see spec "Open questions / deferred to v2").
 */

import type { CGMRenderer } from '../canvas-renderer.js';

// NOTE: this module relies on `touch-action: none` being set on the canvas (see
// mobile-styles.css). Without it, the browser fires touchstart-preventDefault
// before the pointer events here, breaking pinch + tap detection.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MarkerHitResult {
  kind: 'meal' | 'bolus' | 'longActing' | 'smb';
  simTimeMs: number;
  value: number;
  unitLabel: string;
}

export interface GestureDeps {
  canvas: HTMLCanvasElement;
  renderer: CGMRenderer;
  /** Called on a clean single-tap with no marker hit. */
  onSingleTap: () => void;
  /** Element to attach popovers to (must have position:relative or position:absolute). */
  hostForPopover: HTMLElement;
}

// ── Gesture attachment ────────────────────────────────────────────────────────

export function attachCanvasGestures(deps: GestureDeps): void {
  const { canvas, renderer, onSingleTap, hostForPopover } = deps;

  // Track active pointers so we can suppress tap during multi-touch (pinch).
  const activePointers = new Map<number, PointerEvent>();
  let suppressTap = false;
  // Suppress tap if the pointer moved significantly (drag).
  let downX = 0;
  let downY = 0;
  // Apple HIG: tap movement tolerance
  const TAP_MOVE_THRESHOLD = 10;
  // Standard tap-duration ceiling; anything longer is a hold/drag, not a tap.
  const TAP_MAX_MS = 200;
  let downAt = 0;

  canvas.addEventListener('pointerdown', (e) => {
    activePointers.set(e.pointerId, e);
    if (activePointers.size === 1) {
      // First finger down — start tracking for tap.
      downX = e.clientX;
      downY = e.clientY;
      downAt = performance.now();
      suppressTap = false;
    } else {
      // Multi-finger (pinch) — suppress any tap.
      suppressTap = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, e);
    if (!suppressTap) {
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (dx * dx + dy * dy > TAP_MOVE_THRESHOLD * TAP_MOVE_THRESHOLD) {
        suppressTap = true;
      }
    }
  });

  function endPointer(e: PointerEvent) {
    activePointers.delete(e.pointerId);
    if (performance.now() - downAt > TAP_MAX_MS) suppressTap = true;
    if (activePointers.size === 0 && !suppressTap) {
      // Single clean tap — check for marker hit first.
      const hit = renderer.hitTestMarker(e.clientX, e.clientY);
      if (hit) {
        showMarkerPopover(hostForPopover, e.clientX, e.clientY, hit);
      } else {
        onSingleTap();
      }
    }
    if (activePointers.size === 0) suppressTap = false;
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // Persist lastZoom to localStorage whenever the renderer's view changes
  // (covers both pinch via touch events and wheel via mouse).
  renderer.onViewChange(() => {
    try {
      const raw = localStorage.getItem('cgmsim.mobile.ui-prefs');
      const prefs: Record<string, unknown> = raw ? JSON.parse(raw) : {};
      prefs.lastZoom = renderer.zoomMinutes;
      localStorage.setItem('cgmsim.mobile.ui-prefs', JSON.stringify(prefs));
    } catch { /* localStorage may be disabled */ }
  });
}

// ── Marker popover ────────────────────────────────────────────────────────────

const POPOVER_DISMISS_MS = 2000;

export function showMarkerPopover(host: HTMLElement, clientX: number, clientY: number, hit: MarkerHitResult): void {
  // Remove any existing popover first.
  host.querySelectorAll('.m-marker-popover').forEach((n) => n.remove());

  const hostRect = host.getBoundingClientRect();
  const x = clientX - hostRect.left;
  const y = clientY - hostRect.top;

  const pop = document.createElement('div');
  pop.className = 'm-marker-popover';

  // Format sim time as HH:MM (UTC to match simulator time-of-day).
  const d = new Date(hit.simTimeMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');

  const kindLabel: Record<MarkerHitResult['kind'], string> = {
    meal: 'Meal',
    bolus: 'Bolus',
    longActing: 'Long-acting',
    smb: 'SMB',
  };

  pop.textContent = `${kindLabel[hit.kind]}: ${hit.value} ${hit.unitLabel} @ ${hh}:${mm}`;
  pop.style.left = `${x}px`;
  pop.style.top = `${y - 36}px`;
  host.appendChild(pop);

  setTimeout(() => pop.remove(), POPOVER_DISMISS_MS);
}
