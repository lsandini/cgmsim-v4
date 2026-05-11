import type { InlineSimulator } from '../inline-simulator.js';
import type { CGMRenderer } from '../canvas-renderer.js';

const LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 360, 500, 1000, 2000, 3600];

export interface SpeedDeps {
  sim: InlineSimulator;
  renderer: CGMRenderer;
  pill: HTMLElement;
  host: HTMLElement;
  initialThrottle: number;
}

export function createSpeedControl(deps: SpeedDeps) {
  let throttle = snap(deps.initialThrottle);
  let running = true;

  function snap(t: number): number {
    return LADDER.reduce((best, v) => Math.abs(v - t) < Math.abs(best - t) ? v : best, LADDER[0]!);
  }

  function paint() {
    deps.pill.textContent = `${running ? '▶' : '⏸'} ×${throttle}`;
  }

  function setRunning(r: boolean) {
    running = r;
    if (running) deps.sim.resume();
    else deps.sim.pause();
    deps.renderer.setPlayback(throttle, running);
    paint();
  }

  function setThrottle(t: number) {
    throttle = snap(t);
    deps.sim.setThrottle(throttle);
    deps.renderer.setPlayback(throttle, running);
    paint();
  }

  // Long-press detection
  let lpTimer: number | null = null;
  let longPressed = false;

  deps.pill.addEventListener('pointerdown', () => {
    longPressed = false;
    // iOS HIG: 500ms is the standard long-press threshold; below this feels too eager.
    lpTimer = window.setTimeout(() => {
      longPressed = true;
      openSlider();
    }, 500);
  });
  deps.pill.addEventListener('pointerup', () => {
    if (lpTimer !== null) window.clearTimeout(lpTimer);
    lpTimer = null;
    if (!longPressed) setRunning(!running);
  });
  deps.pill.addEventListener('pointercancel', () => {
    if (lpTimer !== null) window.clearTimeout(lpTimer);
    lpTimer = null;
    longPressed = false;
  });

  function openSlider() {
    const wrap = document.createElement('div');
    wrap.className = 'm-sheet-root';
    wrap.innerHTML = `
      <div class="m-sheet-scrim"></div>
      <div class="m-sheet m-sheet-speed">
        <div class="m-sheet-grab"></div>
        <div class="m-sheet-title">Acceleration factor</div>
        <div class="m-speed-readout">×<strong>${throttle}</strong></div>
        <input type="range" min="0" max="${LADDER.length - 1}" step="1" value="${LADDER.indexOf(throttle)}" class="m-speed-slider">
        <div class="m-speed-ticks">
          ${LADDER.map((v) => `<span>${v}</span>`).join('')}
        </div>
      </div>
    `;
    deps.host.appendChild(wrap);
    const teardown = () => wrap.remove();
    wrap.querySelector<HTMLElement>('.m-sheet-scrim')!.addEventListener('click', teardown);

    const slider = wrap.querySelector<HTMLInputElement>('.m-speed-slider')!;
    const readout = wrap.querySelector<HTMLElement>('.m-speed-readout strong')!;
    slider.addEventListener('input', () => {
      const idx = parseInt(slider.value, 10);
      const v = LADDER[idx]!;
      setThrottle(v);
      readout.textContent = String(v);
    });
  }

  deps.sim.setThrottle(throttle);
  deps.renderer.setPlayback(throttle, running);
  paint();

  return { setRunning, setThrottle, getThrottle: () => throttle, isRunning: () => running };
}
