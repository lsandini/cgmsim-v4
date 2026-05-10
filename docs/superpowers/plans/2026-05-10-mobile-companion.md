# Mobile companion build — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `dist/cgmsim-v4-mobile.html` — a second standalone HTML target optimized for iPhone-landscape, MDI-only, sharing the simulator engine and `CGMRenderer` untouched.

**Architecture:** New Vite entrypoint (`index-mobile.html`, `vite.mobile.config.ts`) and new mobile-only TypeScript modules under `packages/ui/src/mobile/`. Reuses `InlineSimulator` and `CGMRenderer` directly. One small engine extension: a new `InlineSimulator.injectLongActingNow(type, units)` method to support the mobile "inject when you decide" model. Dark theme only. localStorage-only persistence with `cgmsim.mobile.*` keys.

**Tech Stack:** Vite 8.0.x, vite-plugin-singlefile 2.3.x, terser, vanilla TypeScript (no UI framework), Vitest 4 for the engine extension test. Same toolchain as the desktop standalone.

**Spec:** `docs/superpowers/specs/2026-05-10-mobile-companion-design.md`

---

## Conventions used in this plan

- **File paths are absolute from the repo root** (`packages/...`).
- **"Build and hand-test" steps** mean: run `npm run build:mobile` from the repo root, open `packages/ui/dist/cgmsim-v4-mobile.html` directly in a desktop browser, resize the window to ~852×393, and verify the described behaviour. iOS device testing is reserved for the final task.
- **Commits use the project's house style** — short subject (≤60 chars), no scope prefix, sentence case, optional body, always include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **mg/dL conversion**: BG values shown in the UI go through `mgdlToMmoll = (mg) => mg / 18.0182`. The display unit is read from `cgmsim.mobile.ui-prefs.displayUnit`.
- **CGMRenderer is the canvas-renderer class** (file is `canvas-renderer.ts` but the export name is `CGMRenderer`).
- **The simulator runtime** is shipped as both `.ts` and hand-maintained `.js` files in `packages/simulator/src/`. The `.js` files are what Vite resolves at runtime. **Any simulator change must be applied to both the `.ts` and the matching `.js` file.** This is a project-wide convention documented in CLAUDE.md.

---

## Task 1: Add `injectLongActingNow` to the simulator (TDD)

The mobile build needs a one-shot long-acting injection. The current API only supports scheduled morning/evening. This task adds the new method via TDD and is the only engine-side change.

**Files:**
- Modify: `packages/simulator/src/index.ts` — export the new free function (if added there) or just keep the change inside InlineSimulator
- Modify: `packages/ui/src/inline-simulator.ts` — add `injectLongActingNow` method
- Modify: `packages/ui/src/inline-simulator.js` — keep the runtime `.js` in sync (project convention)
- Create: `packages/ui/src/inline-simulator.test.ts` — new test file (or append to an existing one if there is one in this package)

- [ ] **Step 1 — Discover the existing pattern**

Read `packages/simulator/src/insulinProfiles.ts` (or `.js`) to find `LONG_ACTING_PROFILES` and confirm it exposes `(units, weight) => { peak, duration }` for each `LongActingType`. Read `packages/ui/src/inline-simulator.ts` `firePremixSlow`-style or `fireLongActingMorning`-style functions to find the existing stamping pattern (push to `state.activeLongActing`, emit `SimEvent { kind: 'longActing' }`).

You're looking for the snippet that already does:
```ts
state.activeLongActing.push({
  id: nextId(),
  simTimeMs: state.simTimeMs,
  units,
  type,
  peak,
  duration,
});
state.pendingEvents.push({ kind: 'longActing', simTimeMs: state.simTimeMs, units, insulinType: type });
```
That's your reference. The new method does the same but is callable on demand.

- [ ] **Step 2 — Pick a test home and write the failing test**

The root `npm test` script only runs `packages/simulator/src/*.test.ts` (see root `package.json` — `"test": "npm run test -w packages/simulator"`). `InlineSimulator` lives in the UI package, so a test placed at `packages/ui/src/inline-simulator.test.ts` will NOT be picked up by `npm test`.

Two options:
- **Option A (preferred):** Add a test script to `packages/ui/package.json` — `"test": "vitest run"` — and add `vitest` to its devDependencies. Then update root `package.json` `"test"` to `"npm run test -w packages/simulator && npm run test -w packages/ui"`. This is the more robust home and follows the project's test discipline.
- **Option B:** Skip a unit test for the wrapper. The actual peak/duration math is in `LONG_ACTING_PROFILES` in the simulator package and is already covered by existing tests; the new method is a 10-line wrapper (call profile fn, push to state, emit event). Verify via the smoke scenario in Task 12 — inject 20U GlargineU100 at known weight, inspect `window.__mobile.sim.getCurrentState().activeLongActing[0]` for expected peak/duration. **If you take Option B, skip Steps 3 and 6 of this task.**

Choose Option A unless that's pushing back on a project convention you're aware of and can't justify changing. The rest of these instructions assume Option A.

Place the test at `packages/ui/src/inline-simulator.test.ts`. Add:

```ts
import { describe, it, expect } from 'vitest';
import { InlineSimulator } from './inline-simulator';

describe('InlineSimulator.injectLongActingNow', () => {
  it('appends an ActiveLongActing record stamped with peak/duration from patient weight', () => {
    const sim = new InlineSimulator();
    sim.setPatientParam({ weight: 70 });

    sim.injectLongActingNow('GlargineU100', 20);

    const state = sim.getCurrentState();
    expect(state.activeLongActing).toHaveLength(1);

    const dose = state.activeLongActing[0];
    expect(dose.type).toBe('GlargineU100');
    expect(dose.units).toBe(20);
    // GlargineU100: duration = (22 + 12 * 20 / 70) * 60 ≈ 1525 min, peak = duration / 2.5 ≈ 610 min
    expect(dose.duration).toBeCloseTo(1525.7, 0);
    expect(dose.peak).toBeCloseTo(610.3, 0);
    expect(dose.simTimeMs).toBe(state.simTimeMs);
  });

  it('emits a SimEvent of kind longActing on the next tick batch', () => {
    const sim = new InlineSimulator();
    let capturedEvents: any[] = [];
    sim.onEvent((evs) => { capturedEvents = capturedEvents.concat(evs); });

    sim.injectLongActingNow('Detemir', 10);

    // The simulator emits events on its event handler synchronously when injecting,
    // mirroring how `bolus()` and `meal()` behave.
    expect(capturedEvents.some((e) => e.kind === 'longActing' && e.units === 10)).toBe(true);
  });
});
```

- [ ] **Step 3 — Run test, expect FAIL**

```bash
npm run test -- inline-simulator.test
```

Expected: FAIL with `TypeError: sim.injectLongActingNow is not a function` (or similar). If the test infrastructure for InlineSimulator doesn't exist yet, you'll see "Cannot find module './inline-simulator'" — in that case, place the test file next to whatever existing test imports `InlineSimulator`.

- [ ] **Step 4 — Implement the method**

Open `packages/ui/src/inline-simulator.ts`. Locate the existing long-acting injection code (probably in a method called `fireLongActingMorning` or in a helper function). Add a new public method on the `InlineSimulator` class:

```ts
public injectLongActingNow(type: LongActingType, units: number): void {
  const profile = LONG_ACTING_PROFILES[type];
  if (!profile) {
    throw new Error(`Unknown long-acting type: ${type}`);
  }
  const weight = this.state.patient.weight;
  const { peak, duration } = profile(units, weight);

  const dose: ActiveLongActing = {
    id: this.nextId(),
    simTimeMs: this.state.simTimeMs,
    units,
    type,
    peak,
    duration,
  };
  this.state.activeLongActing.push(dose);

  const ev: SimEvent = {
    kind: 'longActing',
    simTimeMs: this.state.simTimeMs,
    units,
    insulinType: type,
  };
  this.emitEvent(ev);
}
```

Adjust to match the existing class's actual method names — `nextId()`, `emitEvent()`, and how `state` is accessed may have different names in the real file. If the existing scheduled-LA method already does the push + emit, refactor it to call a private helper that both methods share, e.g. `private injectLongActing(type, units, simTimeMs)`.

- [ ] **Step 5 — Mirror the change in `inline-simulator.js`**

Apply the same method body to `packages/ui/src/inline-simulator.js`. The runtime resolves `.js` directly per the project convention (CLAUDE.md "Key architecture decisions"). Without this step, the test will pass but the build will silently use the old `.js`.

If `packages/ui/src/inline-simulator.js` does not exist (it's listed in `.gitignore` as a tsc artefact for UI), the runtime is using `.ts` directly via Vite's TS support — in which case skip this step. Confirm by running `grep -r "inline-simulator" packages/ui/src/` and looking at how it's imported. If imports use `./inline-simulator` (no extension), Vite resolves the `.ts`. If they use `./inline-simulator.js`, the `.js` file is required.

**Note on the simulator package:** the same convention applies to `packages/simulator/src/*.js` — those ARE required runtime files. If `injectLongActingNow` ends up in the simulator package itself rather than the UI's `InlineSimulator` wrapper, both `.ts` and `.js` must be updated.

- [ ] **Step 6 — Run test, expect PASS**

```bash
npm run test -- inline-simulator.test
```

Expected: 2 passing tests.

- [ ] **Step 7 — Commit**

```bash
git add packages/ui/src/inline-simulator.ts packages/ui/src/inline-simulator.test.ts
# Add the .js file too if you needed to update it
git commit -m "$(cat <<'EOF'
Add InlineSimulator.injectLongActingNow for one-shot LA injection

Mobile companion build needs to inject long-acting "now" without using
the morning/evening schedule. New method stamps peak/duration from
current patient weight and emits a SimEvent. Existing scheduled-LA
paths unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Build infrastructure — Vite mobile config + index-mobile.html shell + npm script

Sets up the second build target so the rest of the work can be hand-tested via `npm run build:mobile`.

**Files:**
- Create: `packages/ui/vite.mobile.config.ts`
- Create: `packages/ui/index-mobile.html`
- Modify: `packages/ui/package.json` — add `build:mobile` script
- Modify: `package.json` (root) — add `build:mobile` shortcut

- [ ] **Step 1 — Create `packages/ui/vite.mobile.config.ts`**

```ts
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  resolve: {
    alias: {
      '@cgmsim/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@cgmsim/simulator': resolve(__dirname, '../simulator/src/index.ts'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    minify: 'terser',
    rollupOptions: {
      input: resolve(__dirname, 'index-mobile.html'),
    },
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
      },
      format: {
        comments: false,
      },
      mangle: true,
    },
    cssMinify: true,
    reportCompressedSize: true,
  },
});
```

This is the desktop config with one change: `build.rollupOptions.input` points at `index-mobile.html`. Output still goes to `dist/`.

- [ ] **Step 2 — Create `packages/ui/index-mobile.html` (skeleton)**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>CGMSIM v4 — Mobile</title>
  <style>
    /* Inline base reset only — full mobile styles will arrive in a later task. */
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; background: #0d1117; color: #c9d1d9; font-family: ui-monospace, monospace; -webkit-tap-highlight-color: transparent; overflow: hidden; }
    #app { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/mobile/mobile.ts"></script>
</body>
</html>
```

- [ ] **Step 3 — Add `build:mobile` script in `packages/ui/package.json`**

Edit `packages/ui/package.json`. After the existing `build:standalone` line, add:

```json
"build:mobile": "vite build --config vite.mobile.config.ts && mv dist/index-mobile.html dist/cgmsim-v4-mobile.html",
```

The complete `scripts` block should now read:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc --noEmit && vite build && mv dist/index.html dist/cgmsim-v4-standalone.html",
  "build:standalone": "vite build && mv dist/index.html dist/cgmsim-v4-standalone.html",
  "build:mobile": "vite build --config vite.mobile.config.ts && mv dist/index-mobile.html dist/cgmsim-v4-mobile.html",
  "preview": "vite preview",
  "typecheck": "tsc --noEmit"
},
```

- [ ] **Step 4 — Add root shortcut in `/package.json`**

Add to root `package.json` `scripts`:

```json
"build:mobile": "npm run build:mobile -w packages/ui",
```

The complete `scripts` block:

```json
"scripts": {
  "dev": "npm run dev -w packages/ui",
  "build": "npm run build -w packages/shared && npm run build -w packages/simulator && npm run build -w packages/ui",
  "build:standalone": "npm run build:standalone -w packages/ui",
  "build:mobile": "npm run build:mobile -w packages/ui",
  "test": "npm run test -w packages/simulator",
  "typecheck": "tsc --build"
},
```

- [ ] **Step 5 — Create the entrypoint stub so the build can resolve it**

Create `packages/ui/src/mobile/mobile.ts`:

```ts
// Mobile companion entrypoint — implementation arrives in Task 3.
const app = document.getElementById('app');
if (app) {
  app.textContent = 'CGMSIM v4 mobile — boot stub';
}
```

- [ ] **Step 6 — Run the build, verify output**

```bash
npm run build:mobile
ls -la packages/ui/dist/cgmsim-v4-mobile.html
```

Expected: file exists, size ~5–15 kB (just the shell). Open it directly in a browser — should display "CGMSIM v4 mobile — boot stub" on a dark background.

- [ ] **Step 7 — Commit**

```bash
git add packages/ui/vite.mobile.config.ts packages/ui/index-mobile.html packages/ui/package.json packages/ui/src/mobile/mobile.ts package.json
git commit -m "$(cat <<'EOF'
Add mobile build target — index-mobile.html + vite.mobile.config.ts

Sets up the parallel build infrastructure for the iPhone-landscape
companion. New `npm run build:mobile` produces
dist/cgmsim-v4-mobile.html. Currently a stub — UI implementation
follows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Mobile entrypoint — engine + renderer in a full-viewport canvas

Wires up `InlineSimulator` and `CGMRenderer` to a viewport-filling canvas. No UI overlays yet — just the chart.

**Files:**
- Modify: `packages/ui/src/mobile/mobile.ts`
- Create: `packages/ui/src/mobile/mobile-styles.css`
- Modify: `packages/ui/index-mobile.html` — link the CSS, replace `#app` markup

- [ ] **Step 1 — Create `packages/ui/src/mobile/mobile-styles.css`**

```css
/* Dark-only theme variables. No light theme in mobile. */
:root {
  --bg-base: #0d1117;
  --bg-raised: #161b22;
  --bg-elevated: #21262d;
  --border: #30363d;
  --text-primary: #c9d1d9;
  --text-secondary: #8b949e;
  --text-muted: #6e7681;
  --accent-blue: #1f6feb;
  --accent-green: #238636;
  --accent-amber: #d29922;
  --accent-danger: #da3633;
  --meal-amber: #fbbf24;
  --bolus-blue: #60a5fa;
  --la-teal: #14b8a6;
}

* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; user-select: none; }

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: ui-monospace, monospace;
  overflow: hidden;
  /* Honour the iOS safe area on notched devices */
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}

#app {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

#cgm-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none; /* gestures handled in JS */
}
```

- [ ] **Step 2 — Replace the body of `packages/ui/index-mobile.html`**

The new `<body>` should be:

```html
<body>
  <div id="app">
    <canvas id="cgm-canvas"></canvas>
  </div>
  <script type="module" src="/src/mobile/mobile.ts"></script>
</body>
```

Remove the inline `<style>` block (now lives in `mobile-styles.css`). Add a stylesheet link in `<head>`:

```html
<link rel="stylesheet" href="/src/mobile/mobile-styles.css">
```

- [ ] **Step 3 — Wire engine + renderer in `packages/ui/src/mobile/mobile.ts`**

Replace the stub with:

```ts
import { InlineSimulator } from '../inline-simulator';
import { CGMRenderer, setRendererTheme } from '../canvas-renderer';
import './mobile-styles.css';

setRendererTheme('dark');

const canvas = document.getElementById('cgm-canvas') as HTMLCanvasElement;
if (!canvas) throw new Error('mobile: #cgm-canvas not found');

const sim = new InlineSimulator();
const renderer = new CGMRenderer(canvas);

renderer.options.displayUnit = 'mmoll';
renderer.options.therapyMode = 'MDI';
renderer.options.showBasal = false; // Mobile drops the basal strip overlay
renderer.options.showIOB = false;   // IOB shown as a top-pill instead of an overlay
renderer.options.showCOB = false;   // Same as IOB
renderer.options.showForecast = true; // AR2 default on
renderer.options.showTrueGlucose = false;

renderer.setZoom(360); // 6h default
renderer.start();

sim.onTick((snap) => renderer.pushTick(snap));
sim.onEvent((evs) => renderer.pushEvents(evs));

sim.setThrottle(360);
sim.resume();

// Expose for debugging while the rest is built (will be removed in a later task)
(window as any).__mobile = { sim, renderer };
```

The exact import paths (`../inline-simulator` vs `../inline-simulator.ts` vs `../../ui/...`) depend on the actual file layout — Vite resolves both styles. If imports fail, check the desktop `main.ts` for the working pattern and copy it.

- [ ] **Step 4 — Build and hand-test**

```bash
npm run build:mobile
```

Open `packages/ui/dist/cgmsim-v4-mobile.html` in a desktop browser. Resize the window to ~852×393 (Chrome DevTools device toolbar → "iPhone 14 Pro" landscape).

Expected:
- Dark background.
- Canvas fills the entire viewport.
- After ~5 seconds (×360 throttle = 1 tick / 0.83 sec), CGM points start to appear and a curve begins to draw.
- No console errors. (`drop_console` strips them anyway, but check while developing — comment out `drop_console` temporarily if you need to debug.)

- [ ] **Step 5 — Commit**

```bash
git add packages/ui/src/mobile/mobile.ts packages/ui/src/mobile/mobile-styles.css packages/ui/index-mobile.html
git commit -m "$(cat <<'EOF'
Mobile entrypoint — full-viewport canvas with engine + renderer

Wires InlineSimulator and CGMRenderer to a viewport-filling canvas.
Dark theme only, 6h default zoom, MDI therapy mode. No overlays yet
— that's the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Static chrome — top + bottom overlays

Adds the BG chip, IOB pill, COB pill, sim-time, hamburger button, speed pill, and floating + button. All visual at this stage; interactivity comes in later tasks.

**Files:**
- Create: `packages/ui/src/mobile/mobile-layout.ts`
- Modify: `packages/ui/src/mobile/mobile-styles.css`
- Modify: `packages/ui/src/mobile/mobile.ts`

- [ ] **Step 1 — Create `packages/ui/src/mobile/mobile-layout.ts`**

```ts
import type { TickSnapshot } from '@cgmsim/shared';

export interface MobileLayoutHandles {
  bgChip: HTMLElement;
  iobPill: HTMLElement;
  cobPill: HTMLElement;
  simTime: HTMLElement;
  hamburger: HTMLElement;
  speedPill: HTMLElement;
  fab: HTMLElement;
  setDisplayUnit: (unit: 'mmoll' | 'mgdl') => void;
  applyTick: (snap: TickSnapshot) => void;
}

export function createMobileLayout(root: HTMLElement): MobileLayoutHandles {
  // Build DOM structure
  root.insertAdjacentHTML('beforeend', `
    <div class="m-overlay m-top">
      <div class="m-pill m-iob" id="m-iob">IOB —</div>
      <div class="m-bgchip" id="m-bgchip">— mmol/L</div>
      <div class="m-pill m-cob" id="m-cob">COB —</div>
      <button class="m-icon-btn m-hamburger" id="m-hamburger" aria-label="Settings">☰</button>
      <div class="m-simtime" id="m-simtime">—</div>
    </div>
    <div class="m-overlay m-bottom">
      <button class="m-pill m-speed" id="m-speed">⏸ ×360</button>
      <button class="m-fab" id="m-fab" aria-label="Add treatment">+</button>
    </div>
  `);

  const bgChip = root.querySelector<HTMLElement>('#m-bgchip')!;
  const iobPill = root.querySelector<HTMLElement>('#m-iob')!;
  const cobPill = root.querySelector<HTMLElement>('#m-cob')!;
  const simTime = root.querySelector<HTMLElement>('#m-simtime')!;
  const hamburger = root.querySelector<HTMLElement>('#m-hamburger')!;
  const speedPill = root.querySelector<HTMLElement>('#m-speed')!;
  const fab = root.querySelector<HTMLElement>('#m-fab')!;

  let displayUnit: 'mmoll' | 'mgdl' = 'mmoll';

  function fmtBg(mgdl: number): string {
    if (displayUnit === 'mgdl') return `${Math.round(mgdl)} mg/dL`;
    return `${(mgdl / 18.0182).toFixed(1)} mmol/L`;
  }

  function bgZoneClass(mgdl: number): string {
    if (mgdl < 70) return 'm-zone-low';
    if (mgdl > 180) return 'm-zone-high';
    return 'm-zone-good';
  }

  function applyTick(snap: TickSnapshot): void {
    bgChip.textContent = fmtBg(snap.cgm);
    bgChip.className = 'm-bgchip ' + bgZoneClass(snap.cgm);
    iobPill.textContent = `IOB ${snap.iob.toFixed(1)} U`;
    cobPill.textContent = `COB ${Math.round(snap.cob)} g`;

    const totalMin = Math.floor(snap.simTimeMs / 60000);
    const dayMin = totalMin % 1440;
    const hh = Math.floor(dayMin / 60).toString().padStart(2, '0');
    const mm = (dayMin % 60).toString().padStart(2, '0');
    const isDay = dayMin >= 360 && dayMin < 1080; // 06:00 to 18:00
    simTime.textContent = `${isDay ? '☀' : '☾'} ${hh}:${mm}`;
  }

  return {
    bgChip, iobPill, cobPill, simTime, hamburger, speedPill, fab,
    setDisplayUnit: (u) => { displayUnit = u; },
    applyTick,
  };
}
```

- [ ] **Step 2 — Append overlay styles to `mobile-styles.css`**

Append:

```css
/* === Overlays (chrome) === */
.m-overlay {
  position: absolute;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 10;
  display: flex;
  align-items: flex-start;
  padding: 0 12px;
}
.m-overlay.m-top { top: 12px; gap: 8px; }
.m-overlay.m-bottom { bottom: 12px; align-items: flex-end; justify-content: space-between; }

.m-overlay > * { pointer-events: auto; }

.m-pill {
  background: rgba(22, 27, 34, 0.85);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  backdrop-filter: blur(4px);
}
.m-iob { margin-right: auto; }
.m-cob { margin-left: auto; }

.m-bgchip {
  background: rgba(13, 17, 23, 0.7);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 36px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  align-self: center;
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
}
.m-bgchip.m-zone-low { color: var(--accent-danger); }
.m-bgchip.m-zone-good { color: #4ec9b0; }
.m-bgchip.m-zone-high { color: var(--accent-amber); }

.m-icon-btn {
  background: rgba(22, 27, 34, 0.85);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 40px;
  height: 40px;
  font-size: 18px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0;
}
.m-hamburger { margin-left: 4px; }

.m-simtime {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.05em;
}

.m-speed {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  background: rgba(22, 27, 34, 0.85);
  border: 1px solid var(--border);
  border-radius: 22px;
  padding: 8px 14px;
  cursor: pointer;
}

.m-fab {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--accent-blue);
  color: white;
  border: none;
  font-size: 28px;
  font-weight: 300;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
```

- [ ] **Step 3 — Wire layout into `mobile.ts`**

Modify `mobile.ts`:

```ts
import { InlineSimulator } from '../inline-simulator';
import { CGMRenderer, setRendererTheme } from '../canvas-renderer';
import { createMobileLayout } from './mobile-layout';
import './mobile-styles.css';

setRendererTheme('dark');

const app = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('cgm-canvas') as HTMLCanvasElement;
if (!app || !canvas) throw new Error('mobile: #app or #cgm-canvas not found');

const sim = new InlineSimulator();
const renderer = new CGMRenderer(canvas);

renderer.options.displayUnit = 'mmoll';
renderer.options.therapyMode = 'MDI';
renderer.options.showBasal = false;
renderer.options.showIOB = false;
renderer.options.showCOB = false;
renderer.options.showForecast = true;
renderer.options.showTrueGlucose = false;

renderer.setZoom(360);
renderer.start();

const layout = createMobileLayout(app);

sim.onTick((snap) => {
  renderer.pushTick(snap);
  layout.applyTick(snap);
});
sim.onEvent((evs) => renderer.pushEvents(evs));

sim.setThrottle(360);
sim.resume();

(window as any).__mobile = { sim, renderer, layout };
```

- [ ] **Step 4 — Build and hand-test**

```bash
npm run build:mobile
```

Open in browser at ~852×393. Expected:
- BG chip centered at top, large number, zone-coloured.
- IOB pill top-left, COB pill top-right.
- Sun/moon + sim-time below the BG chip.
- Hamburger ☰ top-right.
- Speed pill bottom-left, + button bottom-right.
- After a few ticks, all values populate from the sim.

- [ ] **Step 5 — Commit**

```bash
git add packages/ui/src/mobile/mobile-layout.ts packages/ui/src/mobile/mobile-styles.css packages/ui/src/mobile/mobile.ts
git commit -m "$(cat <<'EOF'
Mobile chrome — BG chip, IOB/COB pills, hamburger, speed pill, FAB

Static layout overlays only; no interactivity yet. Values update
from tick events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Onboarding — first-launch case picker

Single-screen case picker. Reused via Settings → Patient case in a later task. Stores selection in `localStorage.cgmsim.mobile.case`.

**Files:**
- Create: `packages/ui/src/mobile/mobile-onboarding.ts`
- Modify: `packages/ui/src/mobile/mobile-styles.css`
- Modify: `packages/ui/src/mobile/mobile.ts`

- [ ] **Step 1 — Inspect cases**

Read `packages/ui/src/onboarding/cases.ts` to confirm the exported case-id constants. Expect three: `'lean-recent'`, `'average-established'`, `'larger-resistant'`. Find the function that produces a `{ patient, therapy }` pair from a case id (likely `buildCase(caseId)` or similar).

- [ ] **Step 2 — Create `mobile-onboarding.ts`**

```ts
import { CASES, buildTherapyForCase } from '../onboarding/cases';
import { patientFigureHTML } from '../onboarding/icons';
import type { InlineSimulator } from '../inline-simulator';

const STORAGE_KEY = 'cgmsim.mobile.case';
const CASE_ORDER = ['lean-recent', 'average-established', 'larger-resistant'] as const;
type CaseId = typeof CASE_ORDER[number];

const CASE_LABELS: Record<CaseId, { title: string; meta: string; size: 'lean' | 'average' | 'larger' }> = {
  'lean-recent':         { title: 'Lean adult',    meta: '60 kg · ISF 3.0', size: 'lean' },
  'average-established': { title: 'Average adult', meta: '75 kg · ISF 2.0', size: 'average' },
  'larger-resistant':    { title: 'Larger adult',  meta: '100 kg · ISF 1.2', size: 'larger' },
};

// VERIFY the `meta` strings against the actual CASES data at runtime — these
// were sourced from the API reference and may drift if cases.ts changes.
// The values shown here assume mmol/L display (mg/dL ÷ 18.0182 for ISF). If
// CASES uses different defaults, update this map or compute it dynamically:
//   meta: `${CASES[id].patient.weight} kg · ISF ${(CASES[id].patient.trueISF / 18.0182).toFixed(1)}`

export function getStoredCaseId(): CaseId | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && (CASE_ORDER as readonly string[]).includes(raw)) return raw as CaseId;
  return null;
}

export function setStoredCaseId(id: CaseId): void {
  localStorage.setItem(STORAGE_KEY, id);
}

export function applyCaseToSim(sim: InlineSimulator, id: CaseId): void {
  const def = CASES[id]; // adapt to the actual export shape
  sim.setPatientParam(def.patient);
  sim.setTherapyParam({ ...buildTherapyForCase(def, 'mdi'), mode: 'MDI', mdiSubmode: 'LIVE' });
}

/**
 * Mounts the onboarding screen on top of `host`. Calls onPick when the user taps Start.
 * Returns a teardown function that removes the screen from the DOM.
 */
export function mountOnboarding(host: HTMLElement, initial: CaseId | null, onPick: (id: CaseId) => void): () => void {
  const wrapper = document.createElement('div');
  wrapper.className = 'm-onboarding';
  wrapper.innerHTML = `
    <div class="m-onb-header">
      <div class="m-onb-title">CGMSIM v4 — Mobile</div>
      <div class="m-onb-sub">Pick a patient to get started</div>
    </div>
    <div class="m-onb-row">
      ${CASE_ORDER.map((id) => {
        const lbl = CASE_LABELS[id];
        return `
          <button class="m-onb-card m-onb-${lbl.size}" data-case="${id}">
            <div class="m-onb-figure">${patientFigureHTML(lbl.size, 78)}</div>
            <div class="m-onb-label">${lbl.title}</div>
            <div class="m-onb-meta">${lbl.meta}</div>
          </button>
        `;
      }).join('')}
    </div>
    <button class="m-onb-start" disabled>Start sim →</button>
  `;
  host.appendChild(wrapper);

  let selected: CaseId | null = initial;
  const startBtn = wrapper.querySelector<HTMLButtonElement>('.m-onb-start')!;
  const cards = Array.from(wrapper.querySelectorAll<HTMLButtonElement>('.m-onb-card'));

  function syncSelection() {
    cards.forEach((c) => c.classList.toggle('m-onb-selected', c.dataset.case === selected));
    startBtn.disabled = selected === null;
  }

  cards.forEach((c) => {
    c.addEventListener('click', () => {
      selected = c.dataset.case as CaseId;
      syncSelection();
    });
  });

  startBtn.addEventListener('click', () => {
    if (!selected) return;
    onPick(selected);
  });

  syncSelection();

  return () => wrapper.remove();
}
```

If `CASES` and `buildTherapyForCase` have different exported names in `onboarding/cases.ts`, adjust the imports. The intent is: read the case definition, push patient + therapy into the sim, with `mode: 'MDI'` and `mdiSubmode: 'LIVE'` as the mobile defaults.

- [ ] **Step 3 — Append onboarding styles to `mobile-styles.css`**

```css
/* === Onboarding === */
.m-onboarding {
  position: absolute;
  inset: 0;
  z-index: 100;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 16px;
}
.m-onb-header { text-align: center; margin-bottom: auto; }
.m-onb-title { font-size: 18px; font-weight: 700; color: var(--text-primary); }
.m-onb-sub { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }

.m-onb-row {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: auto 0;
}
.m-onb-card {
  flex: 1;
  max-width: 22%;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color 80ms ease, box-shadow 80ms ease;
}
.m-onb-card.m-onb-selected {
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.3);
}
.m-onb-figure { color: var(--text-secondary); }
.m-onb-label { font-size: 12px; font-weight: 600; }
.m-onb-meta { font-size: 10px; color: var(--text-muted); }

.m-onb-start {
  background: var(--accent-blue);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 12px 32px;
  font-size: 14px;
  font-weight: 700;
  margin-top: auto;
  margin-bottom: 8px;
  cursor: pointer;
  transition: opacity 80ms ease;
}
.m-onb-start:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 4 — Gate the sim on onboarding in `mobile.ts`**

Refactor `mobile.ts` so the sim doesn't start ticking until a case is chosen:

```ts
import { InlineSimulator } from '../inline-simulator';
import { CGMRenderer, setRendererTheme } from '../canvas-renderer';
import { createMobileLayout } from './mobile-layout';
import { mountOnboarding, getStoredCaseId, setStoredCaseId, applyCaseToSim } from './mobile-onboarding';
import './mobile-styles.css';

setRendererTheme('dark');

const app = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('cgm-canvas') as HTMLCanvasElement;
if (!app || !canvas) throw new Error('mobile: #app or #cgm-canvas not found');

const sim = new InlineSimulator();
const renderer = new CGMRenderer(canvas);

renderer.options.displayUnit = 'mmoll';
renderer.options.therapyMode = 'MDI';
renderer.options.showBasal = false;
renderer.options.showIOB = false;
renderer.options.showCOB = false;
renderer.options.showForecast = true;
renderer.options.showTrueGlucose = false;
renderer.setZoom(360);
renderer.start();

const layout = createMobileLayout(app);

sim.onTick((snap) => {
  renderer.pushTick(snap);
  layout.applyTick(snap);
});
sim.onEvent((evs) => renderer.pushEvents(evs));

function startSim(caseId: ReturnType<typeof getStoredCaseId>) {
  if (!caseId) return;
  applyCaseToSim(sim, caseId);
  sim.setThrottle(360);
  sim.resume();
}

const stored = getStoredCaseId();
if (stored) {
  startSim(stored);
} else {
  const teardown = mountOnboarding(app, null, (picked) => {
    setStoredCaseId(picked);
    teardown();
    startSim(picked);
  });
}

(window as any).__mobile = { sim, renderer, layout };
```

- [ ] **Step 5 — Build and hand-test**

```bash
npm run build:mobile
```

Open the file in a fresh incognito window (or `localStorage.clear()` in DevTools first). Expected:
- Onboarding screen appears.
- Title + 3 silhouette cards + Start button (disabled).
- Tap a card → it highlights blue, Start button enables.
- Tap Start → onboarding disappears, chart appears, sim starts ticking.
- Refresh: lands directly in the sim (case is remembered).

- [ ] **Step 6 — Commit**

```bash
git add packages/ui/src/mobile/mobile-onboarding.ts packages/ui/src/mobile/mobile-styles.css packages/ui/src/mobile/mobile.ts
git commit -m "$(cat <<'EOF'
Mobile onboarding — first-launch case picker

Single-screen case picker reusing the existing patient figures.
Stores selection in cgmsim.mobile.case localStorage key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Action sheet — picker tile UI + custom keypad component

Adds the bottom-sheet harness, the 3-tile action picker, and the in-DOM numeric keypad. Per-action input panes and wiring come in Task 7.

**Files:**
- Create: `packages/ui/src/mobile/mobile-keypad.ts`
- Create: `packages/ui/src/mobile/mobile-action-sheet.ts`
- Modify: `packages/ui/src/mobile/mobile-styles.css`
- Modify: `packages/ui/src/mobile/mobile.ts`

- [ ] **Step 1 — Create the keypad component**

`packages/ui/src/mobile/mobile-keypad.ts`:

```ts
export interface KeypadOptions {
  initial?: string;          // initial display value (e.g. '0')
  allowDecimal?: boolean;    // default true
  maxLength?: number;        // default 6
  onChange?: (value: string) => void;
}

export function createKeypad(host: HTMLElement, opts: KeypadOptions = {}) {
  const allowDecimal = opts.allowDecimal !== false;
  const maxLength = opts.maxLength ?? 6;
  let value = opts.initial ?? '0';

  const display = document.createElement('div');
  display.className = 'm-kp-display';
  display.textContent = value;

  const grid = document.createElement('div');
  grid.className = 'm-kp-grid';
  const keys = ['1','2','3','4','5','6','7','8','9', allowDecimal ? '.' : '', '0', '⌫'];
  keys.forEach((k) => {
    const btn = document.createElement('button');
    btn.className = 'm-kp-key';
    btn.textContent = k;
    if (!k) btn.style.visibility = 'hidden';
    btn.addEventListener('click', () => press(k));
    grid.appendChild(btn);
  });

  function press(k: string): void {
    if (!k) return;
    if (k === '⌫') {
      value = value.length > 1 ? value.slice(0, -1) : '0';
    } else if (k === '.') {
      if (!value.includes('.') && value.length < maxLength) value = value + '.';
    } else {
      if (value === '0') value = k;
      else if (value.length < maxLength) value = value + k;
    }
    display.textContent = value;
    opts.onChange?.(value);
  }

  function setValue(v: string): void {
    value = v;
    display.textContent = v;
  }

  function getValue(): string { return value; }

  host.appendChild(display);
  host.appendChild(grid);

  return { setValue, getValue };
}
```

- [ ] **Step 2 — Create the action sheet harness**

`packages/ui/src/mobile/mobile-action-sheet.ts`:

```ts
export type ActionKind = 'meal' | 'bolus' | 'longActing';

export interface ActionSheetCallbacks {
  onMeal?: (carbsG: number, gastricEmptyingRate: number) => void;
  onBolus?: (units: number) => void;
  onLongActing?: (type: string, units: number) => void;
}

export function createActionSheet(host: HTMLElement, cb: ActionSheetCallbacks) {
  const root = document.createElement('div');
  root.className = 'm-sheet-root m-sheet-hidden';
  root.innerHTML = `
    <div class="m-sheet-scrim"></div>
    <div class="m-sheet m-sheet-action">
      <div class="m-sheet-grab"></div>
      <div class="m-sheet-body" id="m-action-body">
        <!-- picker is rendered here; per-action panes replace it via setView() -->
      </div>
    </div>
  `;
  host.appendChild(root);

  const scrim = root.querySelector<HTMLElement>('.m-sheet-scrim')!;
  const body  = root.querySelector<HTMLElement>('#m-action-body')!;

  function open() {
    root.classList.remove('m-sheet-hidden');
    renderPicker();
  }
  function close() {
    root.classList.add('m-sheet-hidden');
    body.innerHTML = '';
  }

  scrim.addEventListener('click', close);

  function renderPicker() {
    body.innerHTML = `
      <div class="m-sheet-title">Add treatment</div>
      <div class="m-action-row">
        <button class="m-action-btn m-action-meal"  data-kind="meal">
          <div class="m-action-ico">🍞</div><div class="m-action-lbl">MEAL</div><div class="m-action-sub">grams</div>
        </button>
        <button class="m-action-btn m-action-bolus" data-kind="bolus">
          <div class="m-action-ico">💉</div><div class="m-action-lbl">RAPID</div><div class="m-action-sub">units</div>
        </button>
        <button class="m-action-btn m-action-la"    data-kind="longActing">
          <div class="m-action-ico">💉</div><div class="m-action-lbl">LONG-ACTING</div><div class="m-action-sub">units + type</div>
        </button>
      </div>
    `;
    body.querySelectorAll<HTMLButtonElement>('.m-action-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const kind = b.dataset.kind as ActionKind;
        // Per-action panes are filled in by Task 7.
        body.innerHTML = `<div class="m-sheet-title">${kind} pane (Task 7)</div>`;
      });
    });
  }

  return { open, close, _body: body };
}
```

- [ ] **Step 3 — Append sheet/keypad styles**

```css
/* === Bottom sheet harness === */
.m-sheet-root { position: absolute; inset: 0; z-index: 50; pointer-events: none; }
.m-sheet-root.m-sheet-hidden { display: none; }
.m-sheet-scrim {
  position: absolute; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  pointer-events: auto;
}
.m-sheet {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg-raised);
  border-top: 1px solid var(--border);
  border-radius: 14px 14px 0 0;
  padding: 12px 16px 16px;
  box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
  max-height: 90vh;
  overflow: auto;
}
.m-sheet-grab { width: 40px; height: 4px; background: var(--border); border-radius: 2px; margin: 0 auto 12px; }
.m-sheet-title { font-size: 12px; color: var(--text-secondary); text-align: center; margin-bottom: 12px; }

/* Action picker */
.m-action-row { display: flex; gap: 10px; }
.m-action-btn {
  flex: 1;
  aspect-ratio: 1.6 / 1;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px;
  color: var(--text-primary);
  cursor: pointer;
}
.m-action-btn .m-action-ico { font-size: 22px; }
.m-action-btn .m-action-lbl { font-size: 11px; font-weight: 700; }
.m-action-btn .m-action-sub { font-size: 9px; color: var(--text-muted); }
.m-action-btn.m-action-meal  { border-color: var(--meal-amber);  }
.m-action-btn.m-action-meal  .m-action-ico { color: var(--meal-amber); }
.m-action-btn.m-action-bolus { border-color: var(--bolus-blue);  }
.m-action-btn.m-action-bolus .m-action-ico { color: var(--bolus-blue); }
.m-action-btn.m-action-la    { border-color: var(--la-teal);     }
.m-action-btn.m-action-la    .m-action-ico { color: var(--la-teal); }

/* Keypad */
.m-kp-display {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  height: 38px;
  font-size: 20px;
  font-weight: 700;
  color: var(--accent-blue);
  text-align: right;
  padding: 0 12px;
  display: flex; align-items: center; justify-content: flex-end;
  margin-bottom: 8px;
  font-variant-numeric: tabular-nums;
}
.m-kp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.m-kp-key {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  padding: 10px 0;
  cursor: pointer;
}
.m-kp-key:active { background: var(--accent-blue); color: white; }
```

- [ ] **Step 4 — Wire the FAB to open the sheet**

In `mobile.ts`, after `createMobileLayout(app)`:

```ts
import { createActionSheet } from './mobile-action-sheet';

const actionSheet = createActionSheet(app, {
  onMeal: (carbsG, gastricEmptyingRate) => sim.meal(carbsG, gastricEmptyingRate, renderer.displayedSimTime),
  onBolus: (units) => sim.bolus(units, undefined, renderer.displayedSimTime),
  onLongActing: (type, units) => sim.injectLongActingNow(type as any, units),
});

layout.fab.addEventListener('click', () => actionSheet.open());
```

Wiring `onMeal`/`onBolus`/`onLongActing` is harmless even though Task 6 doesn't yet trigger them — Task 7 connects the buttons.

- [ ] **Step 5 — Build and hand-test**

```bash
npm run build:mobile
```

Expected:
- Tap "+" → bottom sheet slides up with 3 tiles.
- Tap one tile → body changes to "meal pane (Task 7)" or similar (placeholder).
- Tap the dimmed scrim → sheet dismisses.

- [ ] **Step 6 — Commit**

```bash
git add packages/ui/src/mobile/mobile-action-sheet.ts packages/ui/src/mobile/mobile-keypad.ts packages/ui/src/mobile/mobile-styles.css packages/ui/src/mobile/mobile.ts
git commit -m "$(cat <<'EOF'
Action sheet harness + keypad component + 3-tile picker

Bottom-sheet shell with scrim + grab handle. Custom in-DOM keypad
component (avoids native iOS keyboard taking over the screen).
Per-action input panes are placeholders until next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Per-action input panes (meal, bolus, long-acting) + simulator wiring

Replace the placeholder panes from Task 6 with real input flows.

**Files:**
- Modify: `packages/ui/src/mobile/mobile-action-sheet.ts`
- Modify: `packages/ui/src/mobile/mobile-styles.css`

- [ ] **Step 1 — Replace `mobile-action-sheet.ts` with the full implementation**

```ts
import { createKeypad } from './mobile-keypad';

export type ActionKind = 'meal' | 'bolus' | 'longActing';

export interface ActionSheetCallbacks {
  onMeal?: (carbsG: number, gastricEmptyingRate: number) => void;
  onBolus?: (units: number) => void;
  onLongActing?: (type: string, units: number) => void;
}

const ABSORPTION_RATES = { slow: 0.6, normal: 1.0, fast: 1.4 };
const LA_TYPES: Array<{ id: string; label: string }> = [
  { id: 'GlargineU100', label: 'Lantus' },
  { id: 'GlargineU300', label: 'Toujeo' },
  { id: 'Detemir',      label: 'Levemir' },
  { id: 'Degludec',     label: 'Tresiba' },
];

export function createActionSheet(host: HTMLElement, cb: ActionSheetCallbacks) {
  const root = document.createElement('div');
  root.className = 'm-sheet-root m-sheet-hidden';
  root.innerHTML = `
    <div class="m-sheet-scrim"></div>
    <div class="m-sheet m-sheet-action">
      <div class="m-sheet-grab"></div>
      <div class="m-sheet-body" id="m-action-body"></div>
    </div>
  `;
  host.appendChild(root);

  const scrim = root.querySelector<HTMLElement>('.m-sheet-scrim')!;
  const body  = root.querySelector<HTMLElement>('#m-action-body')!;

  function open() {
    root.classList.remove('m-sheet-hidden');
    renderPicker();
  }
  function close() {
    root.classList.add('m-sheet-hidden');
    body.innerHTML = '';
  }
  scrim.addEventListener('click', close);

  function renderPicker() {
    body.innerHTML = `
      <div class="m-sheet-title">Add treatment</div>
      <div class="m-action-row">
        <button class="m-action-btn m-action-meal"  data-kind="meal">
          <div class="m-action-ico">🍞</div><div class="m-action-lbl">MEAL</div><div class="m-action-sub">grams</div>
        </button>
        <button class="m-action-btn m-action-bolus" data-kind="bolus">
          <div class="m-action-ico">💉</div><div class="m-action-lbl">RAPID</div><div class="m-action-sub">units</div>
        </button>
        <button class="m-action-btn m-action-la"    data-kind="longActing">
          <div class="m-action-ico">💉</div><div class="m-action-lbl">LONG-ACTING</div><div class="m-action-sub">units + type</div>
        </button>
      </div>
    `;
    body.querySelectorAll<HTMLButtonElement>('.m-action-btn').forEach((b) => {
      b.addEventListener('click', () => routePane(b.dataset.kind as ActionKind));
    });
  }

  function routePane(kind: ActionKind) {
    if (kind === 'meal')        renderMeal();
    if (kind === 'bolus')       renderBolus();
    if (kind === 'longActing')  renderLA();
  }

  function paneShell(title: string, accent: string, accentVar: string): { kpHost: HTMLElement; rightHost: HTMLElement; back: HTMLElement; } {
    body.innerHTML = `
      <div class="m-pane-head">
        <button class="m-pane-back">‹ Back</button>
        <div class="m-pane-title" style="color: var(${accentVar});">${title}</div>
        <div></div>
      </div>
      <div class="m-pane-grid">
        <div class="m-pane-left"></div>
        <div class="m-pane-right"></div>
      </div>
    `;
    body.querySelector<HTMLButtonElement>('.m-pane-back')!.addEventListener('click', renderPicker);
    return {
      kpHost: body.querySelector<HTMLElement>('.m-pane-left')!,
      rightHost: body.querySelector<HTMLElement>('.m-pane-right')!,
      back: body.querySelector<HTMLElement>('.m-pane-back')!,
    };
  }

  function renderMeal() {
    const { kpHost, rightHost } = paneShell('🍞 MEAL — grams', 'amber', '--meal-amber');
    const kp = createKeypad(kpHost, { initial: '0', allowDecimal: false, maxLength: 4 });
    let absorption: keyof typeof ABSORPTION_RATES = 'normal';

    rightHost.innerHTML = `
      <div class="m-pane-meta">
        <div class="m-pane-meta-label">Absorption</div>
        <div class="m-seg" id="m-meal-abs">
          <button class="m-seg-item" data-v="slow">slow</button>
          <button class="m-seg-item m-seg-active" data-v="normal">normal</button>
          <button class="m-seg-item" data-v="fast">fast</button>
        </div>
      </div>
      <button class="m-pane-confirm m-confirm-meal">Add now</button>
    `;
    rightHost.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        rightHost.querySelectorAll('.m-seg-item').forEach((x) => x.classList.remove('m-seg-active'));
        b.classList.add('m-seg-active');
        absorption = b.dataset.v as any;
      });
    });
    rightHost.querySelector<HTMLButtonElement>('.m-confirm-meal')!.addEventListener('click', () => {
      const grams = parseInt(kp.getValue(), 10);
      if (!Number.isFinite(grams) || grams <= 0) return;
      cb.onMeal?.(grams, ABSORPTION_RATES[absorption]);
      close();
    });
  }

  function renderBolus() {
    const { kpHost, rightHost } = paneShell('💉 RAPID — units', 'blue', '--bolus-blue');
    const kp = createKeypad(kpHost, { initial: '0', allowDecimal: true, maxLength: 5 });
    rightHost.innerHTML = `
      <div class="m-pane-meta"><div class="m-pane-meta-label">Analogue</div><div class="m-pane-meta-value">from case</div></div>
      <button class="m-pane-confirm m-confirm-bolus">Inject now</button>
    `;
    rightHost.querySelector<HTMLButtonElement>('.m-confirm-bolus')!.addEventListener('click', () => {
      const units = parseFloat(kp.getValue());
      if (!Number.isFinite(units) || units <= 0) return;
      cb.onBolus?.(units);
      close();
    });
  }

  function renderLA() {
    const { kpHost, rightHost } = paneShell('💉 LONG-ACTING', 'teal', '--la-teal');
    const kp = createKeypad(kpHost, { initial: '0', allowDecimal: true, maxLength: 5 });
    let type = LA_TYPES[1].id; // GlargineU300

    rightHost.innerHTML = `
      <div class="m-pane-meta"><div class="m-pane-meta-label">Type</div></div>
      <div class="m-la-types" id="m-la-types">
        ${LA_TYPES.map((t) => `<button class="m-la-type${t.id === type ? ' m-la-type-active' : ''}" data-id="${t.id}">${t.label}</button>`).join('')}
      </div>
      <button class="m-pane-confirm m-confirm-la">Inject now</button>
    `;
    rightHost.querySelectorAll<HTMLButtonElement>('.m-la-type').forEach((b) => {
      b.addEventListener('click', () => {
        rightHost.querySelectorAll('.m-la-type').forEach((x) => x.classList.remove('m-la-type-active'));
        b.classList.add('m-la-type-active');
        type = b.dataset.id!;
      });
    });
    rightHost.querySelector<HTMLButtonElement>('.m-confirm-la')!.addEventListener('click', () => {
      const units = parseFloat(kp.getValue());
      if (!Number.isFinite(units) || units <= 0) return;
      cb.onLongActing?.(type, units);
      close();
    });
  }

  return { open, close };
}
```

- [ ] **Step 2 — Append pane styles**

```css
/* === Per-action panes === */
.m-pane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.m-pane-back {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.m-pane-title { font-size: 12px; font-weight: 700; }

.m-pane-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 14px;
}
.m-pane-left { display: flex; flex-direction: column; }
.m-pane-right { display: flex; flex-direction: column; gap: 8px; }
.m-pane-meta-label { font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.m-pane-meta-value { font-size: 11px; color: var(--text-secondary); }

.m-seg {
  display: flex;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.m-seg-item {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 6px;
  font-size: 11px;
  cursor: pointer;
}
.m-seg-item.m-seg-active { background: var(--accent-blue); color: white; }

.m-la-types { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.m-la-type {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  font-size: 10px;
  color: var(--text-secondary);
  cursor: pointer;
}
.m-la-type-active { background: var(--accent-blue); color: white; border-color: var(--accent-blue); }

.m-pane-confirm {
  background: var(--accent-blue);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 10px;
  font-size: 12px;
  font-weight: 700;
  margin-top: auto;
  cursor: pointer;
}
```

- [ ] **Step 3 — Build and hand-test**

```bash
npm run build:mobile
```

Run through each action:
- Tap "+" → tap MEAL → enter `45` → keep absorption normal → "Add now" → sheet closes, an amber dot should appear on the chart at the current sim-time, COB pill jumps to `45 g`.
- Tap "+" → tap RAPID → enter `4.5` → "Inject now" → blue dot appears, IOB pill jumps.
- Tap "+" → tap LONG-ACTING → choose Toujeo → enter `20` → "Inject now" → teal dot appears, no IOB jump (long-acting effect builds slowly).

- [ ] **Step 4 — Commit**

```bash
git add packages/ui/src/mobile/mobile-action-sheet.ts packages/ui/src/mobile/mobile-styles.css
git commit -m "$(cat <<'EOF'
Wire action sheet — meal, rapid bolus, long-acting injection

Three input panes wire through to sim.meal / sim.bolus /
sim.injectLongActingNow respectively. Stamps events at the
renderer's displayedSimTime so markers land at the user's
perceived "now".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Settings sheet — case row, display unit, AR2, true-glucose, restart

Adds the right-side settings sheet with most rows wired up. Submode toggle and prescription editor land in Task 9.

**Files:**
- Create: `packages/ui/src/mobile/mobile-settings-sheet.ts`
- Modify: `packages/ui/src/mobile/mobile-styles.css`
- Modify: `packages/ui/src/mobile/mobile.ts`

- [ ] **Step 1 — Create the settings sheet module**

`packages/ui/src/mobile/mobile-settings-sheet.ts`:

```ts
import type { CGMRenderer } from '../canvas-renderer';
import type { InlineSimulator } from '../inline-simulator';

const PREFS_KEY = 'cgmsim.mobile.ui-prefs';

export interface MobilePrefs {
  displayUnit: 'mmoll' | 'mgdl';
  ar2: boolean;
  trueGlucose: boolean;
  lastZoom: number;
}

export const DEFAULT_PREFS: MobilePrefs = {
  displayUnit: 'mmoll',
  ar2: true,
  trueGlucose: false,
  lastZoom: 360,
};

export function loadPrefs(): MobilePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: MobilePrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export interface SettingsSheetDeps {
  sim: InlineSimulator;
  renderer: CGMRenderer;
  prefs: MobilePrefs;
  setDisplayUnit: (unit: 'mmoll' | 'mgdl') => void; // forwards to layout.setDisplayUnit
  reopenOnboarding: () => void;
  restartSim: () => void;
}

export function createSettingsSheet(host: HTMLElement, deps: SettingsSheetDeps) {
  const root = document.createElement('div');
  root.className = 'm-sheet-root m-sheet-hidden';
  root.innerHTML = `
    <div class="m-sheet-scrim"></div>
    <div class="m-sheet m-sheet-side">
      <div class="m-side-head">
        <div class="m-side-title">Settings</div>
        <button class="m-side-close" aria-label="Close">×</button>
      </div>
      <div class="m-side-body" id="m-set-body"></div>
    </div>
  `;
  host.appendChild(root);

  root.querySelector<HTMLElement>('.m-sheet-scrim')!.addEventListener('click', close);
  root.querySelector<HTMLElement>('.m-side-close')!.addEventListener('click', close);

  const body = root.querySelector<HTMLElement>('#m-set-body')!;

  function open() {
    root.classList.remove('m-sheet-hidden');
    render();
  }
  function close() {
    root.classList.add('m-sheet-hidden');
  }

  function render() {
    body.innerHTML = `
      <div class="m-set-row m-set-row-tap" data-act="case">
        <span class="m-set-lbl">Patient case</span>
        <span class="m-set-val">›</span>
      </div>
      <div class="m-set-row" data-act="display-unit">
        <span class="m-set-lbl">Display unit</span>
        <div class="m-seg m-seg-sm">
          <button class="m-seg-item ${deps.prefs.displayUnit === 'mmoll' ? 'm-seg-active' : ''}" data-v="mmoll">mmol/L</button>
          <button class="m-seg-item ${deps.prefs.displayUnit === 'mgdl' ? 'm-seg-active' : ''}" data-v="mgdl">mg/dL</button>
        </div>
      </div>
      <div class="m-set-row" data-act="ar2">
        <span class="m-set-lbl">AR2 forecast</span>
        <div class="m-seg m-seg-sm">
          <button class="m-seg-item ${deps.prefs.ar2 ? 'm-seg-active' : ''}" data-v="on">on</button>
          <button class="m-seg-item ${!deps.prefs.ar2 ? 'm-seg-active' : ''}" data-v="off">off</button>
        </div>
      </div>
      <div class="m-set-row" data-act="true-glucose">
        <span class="m-set-lbl">True-glucose overlay</span>
        <div class="m-seg m-seg-sm">
          <button class="m-seg-item ${deps.prefs.trueGlucose ? 'm-seg-active' : ''}" data-v="on">on</button>
          <button class="m-seg-item ${!deps.prefs.trueGlucose ? 'm-seg-active' : ''}" data-v="off">off</button>
        </div>
      </div>
      <div class="m-set-row m-set-row-tap m-set-danger" data-act="restart">
        <span class="m-set-lbl">Restart simulation</span>
        <span class="m-set-val">↻</span>
      </div>
    `;

    body.querySelector<HTMLElement>('[data-act="case"]')!.addEventListener('click', () => {
      close();
      deps.reopenOnboarding();
    });

    body.querySelector<HTMLElement>('[data-act="display-unit"]')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        deps.prefs.displayUnit = b.dataset.v as any;
        savePrefs(deps.prefs);
        deps.renderer.options.displayUnit = deps.prefs.displayUnit;
        deps.renderer.markDirty();
        deps.setDisplayUnit(deps.prefs.displayUnit);
        render();
      });
    });

    body.querySelector<HTMLElement>('[data-act="ar2"]')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        deps.prefs.ar2 = b.dataset.v === 'on';
        savePrefs(deps.prefs);
        deps.renderer.options.showForecast = deps.prefs.ar2;
        deps.renderer.markDirty();
        render();
      });
    });

    body.querySelector<HTMLElement>('[data-act="true-glucose"]')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        deps.prefs.trueGlucose = b.dataset.v === 'on';
        savePrefs(deps.prefs);
        deps.renderer.options.showTrueGlucose = deps.prefs.trueGlucose;
        deps.renderer.markDirty();
        render();
      });
    });

    body.querySelector<HTMLElement>('[data-act="restart"]')!.addEventListener('click', () => {
      if (!confirm('Restart simulation? Current sim state is lost.')) return;
      close();
      deps.restartSim();
    });
  }

  return { open, close };
}
```

- [ ] **Step 2 — Append settings styles**

```css
/* === Side sheet (settings) === */
.m-sheet-side {
  top: 0;
  bottom: 0;
  left: auto;
  width: 55%;
  max-width: 480px;
  border-radius: 0;
  border-left: 1px solid var(--border);
  border-top: none;
  padding: 14px 14px 12px;
  overflow-y: auto;
}
.m-side-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.m-side-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.m-side-close { background: transparent; border: none; color: var(--text-secondary); font-size: 22px; cursor: pointer; line-height: 1; }
.m-side-body { display: flex; flex-direction: column; }

.m-set-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--bg-elevated);
  font-size: 12px;
}
.m-set-row:last-child { border-bottom: none; }
.m-set-row-tap { cursor: pointer; }
.m-set-lbl { color: var(--text-primary); }
.m-set-val { color: var(--text-secondary); font-size: 11px; }
.m-set-danger .m-set-lbl { color: var(--accent-danger); }

.m-seg-sm .m-seg-item { padding: 4px 10px; font-size: 10px; }
```

- [ ] **Step 3 — Wire settings into `mobile.ts`**

Replace the relevant section of `mobile.ts`:

```ts
import { createSettingsSheet, loadPrefs, savePrefs, DEFAULT_PREFS } from './mobile-settings-sheet';

const prefs = loadPrefs();

renderer.options.displayUnit = prefs.displayUnit;
renderer.options.showForecast = prefs.ar2;
renderer.options.showTrueGlucose = prefs.trueGlucose;
renderer.setZoom(prefs.lastZoom);

// ... (existing layout + sim wiring)

layout.setDisplayUnit(prefs.displayUnit);

let teardownOnboarding: (() => void) | null = null;

function openOnboarding() {
  teardownOnboarding?.();
  teardownOnboarding = mountOnboarding(app, getStoredCaseId(), (picked) => {
    setStoredCaseId(picked);
    teardownOnboarding?.();
    teardownOnboarding = null;
    sim.pause();
    applyCaseToSim(sim, picked);
    sim.resume();
  });
}

function restartSim() {
  const caseId = getStoredCaseId();
  if (!caseId) { openOnboarding(); return; }
  sim.pause();
  applyCaseToSim(sim, caseId);
  renderer.clearHistory();
  sim.resume();
}

const settingsSheet = createSettingsSheet(app, {
  sim, renderer, prefs,
  setDisplayUnit: (u) => layout.setDisplayUnit(u),
  reopenOnboarding: openOnboarding,
  restartSim,
});

layout.hamburger.addEventListener('click', () => settingsSheet.open());
```

`applyCaseToSim` should also reset the renderer's history when the case changes. If `renderer.clearHistory()` doesn't exist, use whatever method does — confirmed in the API reference.

- [ ] **Step 4 — Build and hand-test**

```bash
npm run build:mobile
```

Verify:
- Tap ☰ → settings sheet slides in from the right.
- Display-unit toggle: chart axis flips between mmol/L and mg/dL, BG chip flips too.
- AR2 toggle: forecast ring dots appear/disappear.
- True-glucose toggle: white translucent dots appear/disappear.
- Patient-case row: tap → onboarding screen reappears with current case pre-selected.
- Restart: confirm → chart clears, sim restarts at t=0 with the same case.

- [ ] **Step 5 — Commit**

```bash
git add packages/ui/src/mobile/mobile-settings-sheet.ts packages/ui/src/mobile/mobile-styles.css packages/ui/src/mobile/mobile.ts
git commit -m "$(cat <<'EOF'
Mobile settings sheet — display unit, AR2, true-glucose, restart, case

Right-side settings drawer with overlay toggles wired to the
renderer and persisted to localStorage. Patient-case row reopens
the onboarding screen. Restart confirms then resets the sim.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: PRESCRIPTION submode + prescription sub-sheet

Adds the LIVE/PRESCRIPTION segmented control and the prescription editor.

**Files:**
- Create: `packages/ui/src/mobile/mobile-prescription-sheet.ts`
- Modify: `packages/ui/src/mobile/mobile-settings-sheet.ts`
- Modify: `packages/ui/src/mobile/mobile-styles.css`

- [ ] **Step 1 — Create the prescription sub-sheet**

`packages/ui/src/mobile/mobile-prescription-sheet.ts`:

```ts
import type { Prescription } from '@cgmsim/shared';

const PRESC_KEY = 'cgmsim.mobile.prescription';

export const DEFAULT_PRESCRIPTION: Prescription = {
  fasting: false,
  meals: [
    { hour: 7,  minute: 0, grams: 60, bolusUnits: 8 },
    { hour: 11, minute: 0, grams: 20, bolusUnits: 3 },
    { hour: 13, minute: 0, grams: 75, bolusUnits: 10 },
    { hour: 17, minute: 0, grams: 20, bolusUnits: 3 },
    { hour: 20, minute: 0, grams: 65, bolusUnits: 9 },
  ],
  correction: { units1: 2, units2: 4, units3: 6 },
  fastingCorrectionHours: [7, 13, 17, 22],
};

export function loadPrescription(): Prescription {
  try {
    const raw = localStorage.getItem(PRESC_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_PRESCRIPTION));
    return JSON.parse(raw);
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_PRESCRIPTION));
  }
}
export function savePrescription(p: Prescription): void {
  localStorage.setItem(PRESC_KEY, JSON.stringify(p));
}

export function mountPrescriptionSheet(host: HTMLElement, current: Prescription, onChange: (p: Prescription) => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'm-sheet-root';
  wrap.innerHTML = `
    <div class="m-sheet-scrim"></div>
    <div class="m-sheet m-sheet-side m-sheet-side-wide">
      <div class="m-side-head">
        <button class="m-side-close" aria-label="Back">‹ Back</button>
        <div class="m-side-title">📋 Prescription</div>
        <div></div>
      </div>
      <div class="m-side-body" id="m-presc-body"></div>
    </div>
  `;
  host.appendChild(wrap);

  const body = wrap.querySelector<HTMLElement>('#m-presc-body')!;
  const closeBtn = wrap.querySelector<HTMLElement>('.m-side-close')!;
  const scrim = wrap.querySelector<HTMLElement>('.m-sheet-scrim')!;
  const teardown = () => wrap.remove();
  closeBtn.addEventListener('click', teardown);
  scrim.addEventListener('click', teardown);

  function render() {
    body.innerHTML = `
      <div class="m-seg" id="m-presc-fasting">
        <button class="m-seg-item ${!current.fasting ? 'm-seg-active' : ''}" data-v="eating">Eating</button>
        <button class="m-seg-item ${current.fasting ? 'm-seg-active' : ''}" data-v="fasting">Fasting</button>
      </div>

      <div class="m-presc-section">
        <div class="m-presc-section-label">Mealtime bolus (units)</div>
        ${current.meals.map((m, i) => `
          <div class="m-presc-row">
            <span class="m-presc-time">${String(m.hour).padStart(2, '0')}:${String(m.minute).padStart(2, '0')}</span>
            <span class="m-presc-grams">${m.grams} g</span>
            <span class="m-stepper" data-meal-idx="${i}">
              <button class="m-step-dec">−</button>
              <span class="m-step-val">${m.bolusUnits}</span>
              <button class="m-step-inc">+</button>
            </span>
          </div>
        `).join('')}
      </div>

      <div class="m-presc-section">
        <div class="m-presc-section-label">Sliding scale (correction, U)</div>
        <div class="m-presc-tiers">
          <div class="m-presc-tier">&gt;8 → <strong>${current.correction.units1} U</strong></div>
          <div class="m-presc-tier">&gt;12 → <strong>${current.correction.units2} U</strong></div>
          <div class="m-presc-tier">&gt;16 → <strong>${current.correction.units3} U</strong></div>
        </div>
        <div class="m-presc-note">Sliding-scale tier editing arrives in v2.</div>
      </div>
    `;

    body.querySelector<HTMLElement>('#m-presc-fasting')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        current.fasting = b.dataset.v === 'fasting';
        savePrescription(current);
        onChange(current);
        render();
      });
    });

    body.querySelectorAll<HTMLElement>('.m-stepper').forEach((stepper) => {
      const idx = parseInt(stepper.dataset.mealIdx!, 10);
      stepper.querySelector<HTMLButtonElement>('.m-step-dec')!.addEventListener('click', () => {
        current.meals[idx].bolusUnits = Math.max(0, current.meals[idx].bolusUnits - 1);
        savePrescription(current);
        onChange(current);
        render();
      });
      stepper.querySelector<HTMLButtonElement>('.m-step-inc')!.addEventListener('click', () => {
        current.meals[idx].bolusUnits = Math.min(99, current.meals[idx].bolusUnits + 1);
        savePrescription(current);
        onChange(current);
        render();
      });
    });
  }

  render();
  return teardown;
}
```

- [ ] **Step 2 — Add submode + edit-prescription rows to settings**

In `mobile-settings-sheet.ts`, the settings sheet now needs two more rows: MDI submode and Edit prescription. Modify the `render()` body, inserting these between the Patient-case row and the Display-unit row:

```html
<div class="m-set-row" data-act="submode">
  <span class="m-set-lbl">MDI submode</span>
  <div class="m-seg m-seg-sm">
    <button class="m-seg-item ${deps.submode === 'LIVE' ? 'm-seg-active' : ''}" data-v="LIVE">LIVE</button>
    <button class="m-seg-item ${deps.submode === 'PRESCRIPTION' ? 'm-seg-active' : ''}" data-v="PRESCRIPTION">PRESCR</button>
  </div>
</div>
<div class="m-set-row m-set-row-tap ${deps.submode === 'LIVE' ? 'm-set-row-disabled' : ''}" data-act="edit-presc">
  <span class="m-set-lbl">Edit prescription</span>
  <span class="m-set-val">${deps.submode === 'LIVE' ? 'disabled in LIVE ›' : '›'}</span>
</div>
```

Add to the `SettingsSheetDeps` interface:

```ts
submode: 'LIVE' | 'PRESCRIPTION';
setSubmode: (s: 'LIVE' | 'PRESCRIPTION') => void;
openPrescriptionSheet: () => void;
```

Wire the new handlers inside `render()`:

```ts
body.querySelector<HTMLElement>('[data-act="submode"]')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
  b.addEventListener('click', () => {
    deps.submode = b.dataset.v as any;
    deps.setSubmode(deps.submode);
    render();
  });
});

body.querySelector<HTMLElement>('[data-act="edit-presc"]')!.addEventListener('click', () => {
  if (deps.submode === 'LIVE') return;
  deps.openPrescriptionSheet();
});
```

- [ ] **Step 3 — Append prescription styles**

```css
/* === Prescription sub-sheet === */
.m-sheet-side-wide { width: 62%; max-width: 540px; }
.m-presc-section { margin-top: 14px; }
.m-presc-section-label {
  font-size: 9px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}
.m-presc-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--bg-elevated);
  font-size: 11px;
}
.m-presc-time { color: var(--text-secondary); font-family: ui-monospace, monospace; min-width: 50px; }
.m-presc-grams { color: var(--text-muted); font-size: 10px; flex: 1; }

.m-stepper {
  display: inline-flex;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.m-stepper .m-step-dec, .m-stepper .m-step-inc {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
  padding: 4px 12px;
  cursor: pointer;
}
.m-stepper .m-step-val {
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  color: var(--accent-blue);
  font-weight: 700;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.m-presc-tiers { display: flex; gap: 4px; }
.m-presc-tier {
  flex: 1;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  text-align: center;
  font-size: 10px;
  color: var(--text-secondary);
}
.m-presc-note { font-size: 9px; color: var(--text-muted); margin-top: 6px; font-style: italic; }
.m-set-row-disabled { opacity: 0.4; pointer-events: none; }
```

- [ ] **Step 4 — Wire submode + prescription in `mobile.ts`**

This **replaces** the `createSettingsSheet(...)` call from Task 8 — the deps object grows. Add these new imports at the top of `mobile.ts`:

```ts
import type { Prescription } from '@cgmsim/shared';
import { mountPrescriptionSheet, loadPrescription, savePrescription } from './mobile-prescription-sheet';
```

Add submode state, prescription state, and helpers BEFORE the `createSettingsSheet(...)` call:

```ts
let submode: 'LIVE' | 'PRESCRIPTION' = (localStorage.getItem('cgmsim.mobile.submode') as any) || 'LIVE';
const prescription = loadPrescription();

function applySubmode(s: 'LIVE' | 'PRESCRIPTION') {
  submode = s;
  localStorage.setItem('cgmsim.mobile.submode', s);
  sim.setTherapyParam({ mdiSubmode: s, prescription });
}
function applyPrescriptionChange(p: Prescription) {
  sim.setTherapyParam({ prescription: p });
}

// Apply current values immediately on boot — must run AFTER applyCaseToSim,
// because the case-apply overwrites the therapy profile (including submode +
// prescription). Re-call applySubmode at the end of each `startSim` / `restartSim`
// helper too.
applySubmode(submode);
```

Replace the previous `createSettingsSheet(...)` call with the expanded deps:

```ts
const settingsSheet = createSettingsSheet(app, {
  sim, renderer, prefs,
  setDisplayUnit: (u) => layout.setDisplayUnit(u),
  reopenOnboarding: openOnboarding,
  restartSim,
  submode,
  setSubmode: applySubmode,
  openPrescriptionSheet: () => mountPrescriptionSheet(app, prescription, applyPrescriptionChange),
});
```

Update `startSim` and `restartSim` to call `applySubmode(submode)` after `applyCaseToSim(...)` so the submode + prescription survive a case-apply.

- [ ] **Step 5 — Build and hand-test**

```bash
npm run build:mobile
```

Verify:
- Open settings → MDI submode toggle visible. Edit prescription is greyed out in LIVE.
- Toggle to PRESCRIPTION → Edit prescription becomes tappable.
- Tap Edit prescription → sub-sheet slides in. 5 meal slots, sliding-scale chips.
- Decrement a slot's bolusUnits → number updates → close sub-sheet → wait for next mealtime trigger → meal + bolus auto-fire.
- Toggle Eating/Fasting → chart auto-fires correction at fasting hours.

- [ ] **Step 6 — Commit**

```bash
git add packages/ui/src/mobile/mobile-prescription-sheet.ts packages/ui/src/mobile/mobile-settings-sheet.ts packages/ui/src/mobile/mobile-styles.css packages/ui/src/mobile/mobile.ts
git commit -m "$(cat <<'EOF'
PRESCRIPTION submode + prescription sub-sheet editor

LIVE/PRESCRIPTION segmented control in settings. Sub-sheet with 5
meal-slot ±steppers, eating/fasting toggle, read-only sliding-scale
chips. Persisted under cgmsim.mobile.submode and
cgmsim.mobile.prescription.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Speed control — tap pause + long-press slider

The speed pill currently shows `⏸ ×360` but does nothing. This task wires it up.

**Files:**
- Create: `packages/ui/src/mobile/mobile-speed.ts`
- Modify: `packages/ui/src/mobile/mobile-styles.css`
- Modify: `packages/ui/src/mobile/mobile.ts`

- [ ] **Step 1 — Create `mobile-speed.ts`**

```ts
import type { InlineSimulator } from '../inline-simulator';

const LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 3600];

export interface SpeedDeps {
  sim: InlineSimulator;
  pill: HTMLElement;
  host: HTMLElement;
  initialThrottle: number;
}

export function createSpeedControl(deps: SpeedDeps) {
  let throttle = deps.initialThrottle;
  let running = true;

  function snap(t: number): number {
    return LADDER.reduce((best, v) => Math.abs(v - t) < Math.abs(best - t) ? v : best, LADDER[0]);
  }

  function paint() {
    deps.pill.textContent = `${running ? '▶' : '⏸'} ×${throttle}`;
  }

  function setRunning(r: boolean) {
    running = r;
    if (running) deps.sim.resume();
    else deps.sim.pause();
    paint();
  }

  function setThrottle(t: number) {
    throttle = snap(t);
    deps.sim.setThrottle(throttle);
    paint();
  }

  // Long-press detection
  let lpTimer: number | null = null;
  let longPressed = false;

  deps.pill.addEventListener('pointerdown', () => {
    longPressed = false;
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
      const v = LADDER[idx];
      setThrottle(v);
      readout.textContent = String(v);
    });
  }

  deps.sim.setThrottle(throttle);
  paint();

  return { setRunning, setThrottle, getThrottle: () => throttle, isRunning: () => running };
}
```

- [ ] **Step 2 — Append speed-control styles**

```css
.m-sheet-speed { padding-bottom: 24px; }
.m-speed-readout { text-align: center; font-size: 18px; color: var(--text-primary); margin-bottom: 8px; }
.m-speed-slider { width: 100%; }
.m-speed-ticks { display: flex; justify-content: space-between; font-size: 8px; color: var(--text-muted); margin-top: 4px; }
```

- [ ] **Step 3 — Wire in `mobile.ts`**

```ts
import { createSpeedControl } from './mobile-speed';

const speed = createSpeedControl({
  sim,
  pill: layout.speedPill,
  host: app,
  initialThrottle: 360,
});

// Replace the previous `sim.setThrottle(360); sim.resume();` with delegation through speed:
// (createSpeedControl already calls setThrottle and starts in running=true, but does NOT call resume — call it explicitly)
sim.resume();
```

- [ ] **Step 4 — Build and hand-test**

Verify:
- Tap speed pill → pause icon flips, sim freezes.
- Tap again → resumes.
- Long-press speed pill (500ms) → bottom sheet with slider opens.
- Drag slider → throttle changes in real time, readout + pill update.
- Dismiss sheet → pill stays at the new value.

- [ ] **Step 5 — Commit**

```bash
git add packages/ui/src/mobile/mobile-speed.ts packages/ui/src/mobile/mobile-styles.css packages/ui/src/mobile/mobile.ts
git commit -m "$(cat <<'EOF'
Speed pill — tap to pause, long-press for throttle slider

Single-tap toggles pause/play. 500ms long-press opens a bottom
sheet with a throttle slider snapped to the standard ladder.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Canvas gestures — pinch zoom, two-finger pan, single-tap pause, marker popover

Adds touch gesture handling on the canvas itself.

**Files:**
- Create: `packages/ui/src/mobile/mobile-gestures.ts`
- Modify: `packages/ui/src/mobile/mobile-styles.css`
- Modify: `packages/ui/src/mobile/mobile.ts`

- [ ] **Step 1 — Create `mobile-gestures.ts`**

```ts
import type { CGMRenderer } from '../canvas-renderer';

const ZOOM_LADDER = [180, 360, 720, 1440];

export interface GestureDeps {
  canvas: HTMLCanvasElement;
  renderer: CGMRenderer;
  onSingleTap: () => void;     // tap-to-pause
  onMarkerTap: (clientX: number, clientY: number) => void; // hit-test markers
  hostForPopover: HTMLElement;
}

export function attachCanvasGestures(deps: GestureDeps): void {
  const c = deps.canvas;
  let activePointers = new Map<number, PointerEvent>();
  let pinchStartDist = 0;
  let pinchStartZoomMin = 0;
  let panStartX = 0;
  let panMode: 'none' | 'pinch' | 'pan' = 'none';
  let suppressTap = false;

  c.addEventListener('pointerdown', (e) => {
    activePointers.set(e.pointerId, e);
    suppressTap = false;
    if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      pinchStartDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      pinchStartZoomMin = deps.renderer.zoomMinutes;
      panStartX = (pts[0].clientX + pts[1].clientX) / 2;
      panMode = 'pinch';
      suppressTap = true;
    }
  });

  c.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, e);
    if (panMode === 'pinch' && activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      const ratio = pinchStartDist / Math.max(1, dist); // pinch out -> zoom in (smaller minutes)
      const target = pinchStartZoomMin * ratio;
      // Snap to ladder
      const snapped = ZOOM_LADDER.reduce((best, v) => Math.abs(v - target) < Math.abs(best - target) ? v : best, ZOOM_LADDER[0]);
      if (snapped !== deps.renderer.zoomMinutes) deps.renderer.setZoom(snapped);
      suppressTap = true;
    }
  });

  function endPointer(e: PointerEvent) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) panMode = 'none';
    if (activePointers.size === 0 && !suppressTap) {
      // Single tap. Decide marker hit vs. pause.
      const x = e.clientX, y = e.clientY;
      // Defer marker hit-test to caller; if it returns false (no marker hit), call single tap.
      // We'll wire this via a small protocol: caller handles marker via onMarkerTap and onSingleTap is invoked here.
      // To keep things simple: call BOTH and let the marker-popover module decide whether to suppress.
      deps.onMarkerTap(x, y);
      // onSingleTap is invoked by the popover module if no marker is found (see Step 3).
    }
  }
  c.addEventListener('pointerup', endPointer);
  c.addEventListener('pointercancel', endPointer);

  // Persist last zoom on user change
  deps.renderer.onViewChange(() => {
    try {
      const raw = localStorage.getItem('cgmsim.mobile.ui-prefs');
      const prefs = raw ? JSON.parse(raw) : {};
      prefs.lastZoom = deps.renderer.zoomMinutes;
      localStorage.setItem('cgmsim.mobile.ui-prefs', JSON.stringify(prefs));
    } catch { /* localStorage may be disabled */ }
  });
}
```

- [ ] **Step 2 — Add a marker hit-test helper + popover**

Append to `mobile-gestures.ts`:

```ts
import type { CGMTracePoint, SimEvent } from '@cgmsim/shared';

export interface MarkerHitResult {
  kind: 'meal' | 'bolus' | 'longActing' | 'smb';
  simTimeMs: number;
  value: number;
  unitLabel: string;
}

export function showMarkerPopover(host: HTMLElement, x: number, y: number, hit: MarkerHitResult): void {
  // Remove any existing popover first
  host.querySelectorAll('.m-marker-popover').forEach((n) => n.remove());

  const pop = document.createElement('div');
  pop.className = 'm-marker-popover';
  const t = new Date(hit.simTimeMs);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  pop.textContent = `${hit.kind}: ${hit.value} ${hit.unitLabel} @ ${hh}:${mm}`;
  pop.style.left = `${x}px`;
  pop.style.top = `${y - 36}px`;
  host.appendChild(pop);

  setTimeout(() => pop.remove(), 2000);
}
```

- [ ] **Step 3 — Marker hit-testing**

The renderer doesn't expose a public hit-test method. Two options:

**Option A** — Add `CGMRenderer.hitTestMarker(clientX, clientY): MarkerHitResult | null`. Cleaner, but requires editing canvas-renderer.ts.

**Option B** — Track event positions in `mobile.ts` from the `sim.onEvent` callback, computing canvas-local x/y at the time the marker is placed. Brittle (you have to mirror the renderer's coordinate logic).

**Choose Option A.** Open `packages/ui/src/canvas-renderer.ts`. Find the method that draws event markers (search for `'meal'` or `pushEvents`). Add a public method:

```ts
public hitTestMarker(clientX: number, clientY: number): MarkerHitResult | null {
  const rect = this.canvas.getBoundingClientRect();
  const px = (clientX - rect.left) * this.dpr;
  const py = (clientY - rect.top) * this.dpr;
  for (const ev of this.eventsForHitTest /* internal array of {kind, simTimeMs, value, drawX, drawY, drawR} */) {
    const dx = px - ev.drawX;
    const dy = py - ev.drawY;
    const r = Math.max(16 * this.dpr, ev.drawR + 8 * this.dpr);
    if (dx * dx + dy * dy <= r * r) {
      return { kind: ev.kind, simTimeMs: ev.simTimeMs, value: ev.value, unitLabel: ev.kind === 'meal' ? 'g' : 'U' };
    }
  }
  return null;
}
```

The actual implementation depends on the renderer's internal data structures — you may need to maintain a parallel `eventsForHitTest` array populated when `pushEvents` is called. Keep changes minimal: only add the array + the `hitTestMarker` method, do not refactor the existing draw code.

If editing canvas-renderer.ts feels too risky, **defer marker popovers to v2** and call `onSingleTap` for any tap. Note the deferral in CLAUDE.md and the "Open questions / deferred to v2" section of the spec.

- [ ] **Step 4 — Wire gestures in `mobile.ts`**

```ts
import { attachCanvasGestures, showMarkerPopover } from './mobile-gestures';

attachCanvasGestures({
  canvas,
  renderer,
  onSingleTap: () => speed.setRunning(!speed.isRunning()),
  onMarkerTap: (x, y) => {
    const hit = (renderer as any).hitTestMarker?.(x, y);
    if (hit) {
      showMarkerPopover(app, x, y, hit);
    } else {
      speed.setRunning(!speed.isRunning());
    }
  },
  hostForPopover: app,
});
```

- [ ] **Step 5 — Append popover styles**

```css
.m-marker-popover {
  position: absolute;
  background: rgba(22, 27, 34, 0.95);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-primary);
  white-space: nowrap;
  z-index: 200;
  transform: translateX(-50%);
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 6 — Build and hand-test**

In Chrome DevTools, enable device toolbar → iPhone landscape. Touch emulation is partially supported (single touch = pointer; pinch via Ctrl+drag).

Verify:
- Single tap on chart → pause/play toggles.
- Tap a marker (or near one within 16px) → popover appears with kind/value/time, auto-dismisses after 2s.
- Pinch (Ctrl+drag in DevTools) → zoom snaps between 3h/6h/12h/24h.
- Two-finger pan: **explicitly deferred to v2.** The spec listed pan as a v1 gesture, but on landscape phones pinch-zoom + the renderer's auto-follow-live behavior covers the common navigation needs. Pan would require either re-enabling `touch-action` on the canvas (which conflicts with our gesture handlers) or adding a `setPanOffset` API to `CGMRenderer`. Both are non-trivial and the demand is unclear until real-device testing. Add to the spec's "Open questions / deferred to v2" section.

- [ ] **Step 7 — Commit**

```bash
git add packages/ui/src/mobile/mobile-gestures.ts packages/ui/src/mobile/mobile-styles.css packages/ui/src/mobile/mobile.ts
# also packages/ui/src/canvas-renderer.ts if Option A was taken
git commit -m "$(cat <<'EOF'
Canvas gestures — pinch zoom, single-tap pause, marker popover

Pinch snaps zoom to 3h/6h/12h/24h. Single tap toggles pause unless
a marker is within 16px (then shows a popover with the value and
timestamp). Two-finger pan deferred until real-device feedback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Portrait guard + iOS polish + bundle size + smoke scenario + CLAUDE.md

Final task. Locks in the orientation guard, a few iOS-specific CSS bits, runs the smoke scenario, and updates docs.

**Files:**
- Modify: `packages/ui/src/mobile/mobile.ts`
- Modify: `packages/ui/src/mobile/mobile-styles.css`
- Modify: `CLAUDE.md`

- [ ] **Step 1 — Add the portrait/unsupported guard**

Append to `mobile-styles.css`:

```css
/* === Orientation guard === */
.m-orientation-guard {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--bg-base);
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  text-align: center;
}
@media (orientation: portrait), (max-width: 479px) {
  .m-orientation-guard { display: flex; }
  #app > *:not(.m-orientation-guard) { display: none !important; }
}
.m-orientation-guard svg { width: 64px; height: 64px; color: var(--text-secondary); }
.m-orientation-guard p { font-size: 14px; color: var(--text-secondary); }
```

In `mobile.ts`, after the `<canvas>` is mounted, add the guard div:

```ts
app.insertAdjacentHTML('beforeend', `
  <div class="m-orientation-guard">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
    <p>Rotate your device to landscape</p>
  </div>
`);
```

- [ ] **Step 2 — Bundle size check**

```bash
npm run build:mobile
ls -la packages/ui/dist/cgmsim-v4-mobile.html
gzip -c packages/ui/dist/cgmsim-v4-mobile.html | wc -c
```

Expected: raw ≤ 100 kB, gzipped ≤ 30 kB. If over budget:
- Confirm `drop_console: true` is active (default: it is).
- Check whether the `inline-simulator.js` runtime file shipped a duplicate of the `.ts` (CLAUDE.md notes the UI `.js` files should be gitignored and not bundled).
- Consider removing the light-theme code paths from `canvas-renderer.ts` for mobile via Vite `define` flags — defer to v2 unless we're more than 10% over.

- [ ] **Step 3 — Run the smoke scenario**

Open `dist/cgmsim-v4-mobile.html` in a desktop browser at 852×393. Step through:

1. `localStorage.clear()` then reload.
2. Onboarding appears → tap "Average adult" → tap "Start sim →".
3. Chart starts ticking at ×360.
4. "+" → MEAL → enter `45` → normal → "Add now".  Amber dot appears, COB pill jumps to `45 g`.
5. "+" → RAPID → enter `4` → "Inject now". Blue dot, IOB pill jumps to ~4 U.
6. "+" → LONG-ACTING → Toujeo → enter `20` → "Inject now". Teal dot.
7. ☰ → toggle "MDI submode" to PRESCR. Wait for next mealtime trigger (use long-press → speed → max). Verify auto-meal + auto-bolus fire.
8. ☰ → "Edit prescription" → decrement slot 13:00 by 2 → close.
9. ☰ → "Restart simulation" → confirm. Chart clears, IOB/COB reset, sim restarts at t=0 with average-adult case.
10. Reload page → lands directly in sim (no onboarding) with the same case.

If anything fails, fix it before commit. Console should be silent (no errors).

- [ ] **Step 4 — Update CLAUDE.md**

Open `CLAUDE.md` and:

(a) In the "Project structure" section, after the `packages/ui/dist/cgmsim-v4-standalone.html` bullet, add:

```
- `packages/ui/dist/cgmsim-v4-mobile.html` — Mobile companion build (output of `build:mobile` in packages/ui). iPhone-landscape, MDI-only, dark-only, no save/load. Reuses simulator engine and `CGMRenderer` untouched.
```

(b) In the "Commands" block, after `build:standalone`, add:

```bash
npm run build:mobile     # Produces dist/cgmsim-v4-mobile.html (root shortcut, forwards to packages/ui)
```

(c) In "After every code change", change "Always rebuild the standalone file" to:

```
Always rebuild **both** standalone files before reporting work as done if you touched simulator or shared code. UI-only changes only need the relevant build.

```bash
npm run build:standalone   # desktop
npm run build:mobile       # mobile companion
```

The two builds are independent — building one does not rebuild the other.
```

(d) Add a new top-level section after "Prednisone scenario", called "Mobile companion build". Use this draft (tune to match the rest of CLAUDE.md's voice if needed):

```markdown
## Mobile companion build

A second standalone HTML target for students playing solo on iPhone-landscape.
Built independently from the desktop standalone via `npm run build:mobile`,
producing `packages/ui/dist/cgmsim-v4-mobile.html`. Reuses the simulator
engine and `CGMRenderer` untouched; mobile UI lives under
`packages/ui/src/mobile/`.

**Scope (v1, intentionally tight):** MDI-only therapy with both LIVE and
PRESCRIPTION submodes. No AID/Pump, no Premix/Prednisone scenarios, no
JSON save/load, no comparison run. Patient physiology is locked to the
case template — no in-session ISF/CR/DIA/weight editing. Dark theme only.

**Layout:** edge-to-edge canvas with floating overlays (Layout C from
brainstorming). BG chip centered top, IOB/COB pills top-corners, hamburger
☰ for settings, speed pill bottom-left (tap = pause, long-press =
throttle slider), floating + button bottom-right opens the action sheet
(meal / rapid bolus / long-acting → custom in-DOM keypad → confirm).

**Engine extension:** `InlineSimulator.injectLongActingNow(type, units)`
adds one-shot long-acting injection without using the morning/evening
schedule. Stamps peak/duration from current weight. Existing scheduled-LA
paths unchanged — desktop behaviour does not change.

**Persistence:** localStorage only, with mobile-specific keys
(`cgmsim.mobile.case`, `cgmsim.mobile.submode`, `cgmsim.mobile.prescription`,
`cgmsim.mobile.ui-prefs`) so the desktop and mobile builds can't fight over
schema.

**Build configs:** `packages/ui/vite.config.ts` (desktop, unchanged) +
`packages/ui/vite.mobile.config.ts` (mobile, parallel). Both produce a
single self-contained HTML via `vite-plugin-singlefile`.

Spec: `docs/superpowers/specs/2026-05-10-mobile-companion-design.md`.
```

- [ ] **Step 5 — Final commit**

```bash
git add packages/ui/src/mobile/mobile.ts packages/ui/src/mobile/mobile-styles.css CLAUDE.md
git commit -m "$(cat <<'EOF'
Ship mobile companion v1 — orientation guard, docs, smoke verified

Portrait and <480px-landscape viewports show a "rotate device"
overlay. CLAUDE.md gains a "Mobile companion build" section and
notes that build:standalone and build:mobile are independent.
Smoke scenario passes locally.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6 — Real-device test (recommended but not blocking)**

If a real iPhone is available: serve `dist/cgmsim-v4-mobile.html` over LAN (`python3 -m http.server -b 0.0.0.0 8080`) and open from iOS Safari in landscape. Walk through the same smoke scenario. Note any touch-target sizing or gesture issues for v2.

---

## Self-review (run before declaring this plan done)

- [ ] **Spec coverage** — every section in the spec is covered by a task: build infra (T2), engine extension (T1), main layout (T3+T4), action sheet (T6+T7), settings (T8), prescription (T9), speed (T10), gestures (T11), portrait + ship (T12). ✓
- [ ] **Type consistency** — `LongActingType` used in T1 and T7 — same set of strings. `Prescription` used in T9 imported from `@cgmsim/shared`. `MobilePrefs` defined once in T8. ✓
- [ ] **No placeholders** — every step has either complete code, an exact command, or a self-contained instruction. The marker hit-test in T11 has Option A (concrete) and an explicit deferral path; not a TBD.
- [ ] **Sub-skill called out** — header says use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. ✓

---

## Open notes for the executor

1. **The `.js`/`.ts` parity rule** — `packages/simulator/src/*.js` are runtime files; `packages/ui/src/*.js` are gitignored and unused. If your engine change is in the simulator package, edit both `.ts` and `.js`. If it's in `inline-simulator.ts` (UI package), only `.ts` matters since UI imports use Vite-resolved paths.

2. **Dual-build CI** — there is no CI in this repo; manual rebuild discipline lives in CLAUDE.md. Rebuild both standalones if you touched the simulator or shared types.

3. **The renderer's hit-test method (T11 Step 3)** — if adding it ends up requiring more than ~30 lines of changes to canvas-renderer.ts, defer marker popovers to v2 and ship without them. Keeping the renderer untouched is a stronger architectural property than having popovers.

4. **iOS Safari quirks to watch** — `100vh` includes the URL bar on iOS, which can cause a 70px gap. The `#app { height: 100vh }` in mobile-styles.css may need to swap to `100dvh` (dynamic viewport height) once you test on a real device. Defer until then.

5. **Touch target audit** — Apple HIG specifies 44×44pt minimum. The spec compliance is mostly there (FAB 56, hamburger 40 — bump to 44 if a tester complains, speed pill 44, action tiles >88).
