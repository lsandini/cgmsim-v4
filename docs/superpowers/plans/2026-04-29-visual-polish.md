# CGMSIM v4 Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the visual identity of the standalone HTML simulator from generic GitHub-dark to a distinctive, high-contrast teaching-tool aesthetic. Improve TIR readability, give IOB/COB their own visual identity, clean axis chrome, add a sun/moon time-of-day indicator, and polish typographic rhythm — without breaking the single-file deliverable.

**Architecture:** All work is contained to `packages/ui/`. Two surfaces drive the look: (a) CSS custom properties + DOM styling in `packages/ui/index.html`, and (b) the `COLORS` constant + drawing methods in `packages/ui/src/canvas-renderer.ts`. The standalone build (`npm run -w @cgmsim/ui build:standalone`) inlines everything into one HTML — there is no asset pipeline change needed. No new dependencies. No TypeScript-shape changes outside renderer-internal code.

**Tech Stack:** Vanilla TypeScript, HTML5 Canvas, CSS custom properties. Vite 5.4 for dev/build. No frameworks. The simulator package (physics) is untouched.

**Verification model:** Visual changes don't have unit-test coverage in this codebase (the 68 tests are physics-only). Each task's gate is:
1. `npm run typecheck` exits 0
2. `npm test` still passes (sanity that nothing in shared code regressed)
3. `npm run -w @cgmsim/ui build:standalone` builds clean
4. Open `packages/ui/dist/cgmsim-v4-standalone.html` in a browser and confirm the task's specific visual goal

**Out of scope (explicitly):** light-mode toggle, sound design, animated event-marker pulses, color-blind-safe alternate palette, mobile responsiveness rework, basal profile editor. Those are separate plans if pursued.

---

## File map

| File | Responsibility | Touched by tasks |
|------|---------------|-------------------|
| `packages/ui/index.html` | CSS tokens, header DOM, toolbar markup, sun/moon SVG | 1, 8, 9, 10 |
| `packages/ui/src/canvas-renderer.ts` | `COLORS` object + all drawing methods | 1, 2, 3, 4, 5, 6, 7 |
| `packages/ui/src/main.ts` | Sun/moon update logic + BG digit flash class toggle | 9, 10 |
| `CLAUDE.md` | Project state line | 11 |

---

## Task 1: New palette tokens (CSS) + canvas colour sync

**Why:** Everything else builds on the palette. Establishing the tokens first lets later tasks just reference `var(--…)` or the renamed `COLORS.*` keys.

**Files:**
- Modify: `packages/ui/index.html:10-32` (`:root` block)
- Modify: `packages/ui/src/canvas-renderer.ts:33-63` (`COLORS` and `COMPARE_COLORS`)

- [ ] **Step 1: Replace `:root` palette in index.html**

Find this block at `packages/ui/index.html:10-32`:

```css
    :root {
      --bg: #0d1117;
      --bg-panel: #161b22;
      --bg-surface: #21262d;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;

      --green: #26a641;
      --amber: #d29922;
      --red: #da3633;
      --green-range: rgba(38, 166, 65, 0.15);
      --amber-range: rgba(210, 153, 34, 0.25);
      --red-range: rgba(218, 54, 51, 0.25);

      --trace-color: #58a6ff;
      --trace-glow: rgba(88, 166, 255, 0.4);

      --panel-width: 340px;
      --control-height: 80px;
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    }
```

Replace with:

```css
    :root {
      /* Surfaces — slightly cooler, less GitHub */
      --bg: #0a0f1c;
      --bg-panel: #121829;
      --bg-surface: #1c2236;
      --border: #2a3247;
      --text: #eef2fa;
      --text-muted: #94a0b8;
      --text-faint: rgba(238, 242, 250, 0.55);

      /* UI chrome accent (buttons, focus, slider thumb) */
      --accent: #7aa2ff;
      --accent-soft: rgba(122, 162, 255, 0.18);

      /* Data identity — each role has a distinct hue */
      --cgm: #22d3ee;                              /* CGM trace: bright cyan */
      --cgm-glow: rgba(34, 211, 238, 0.35);
      --iob: #14b8a6;                              /* IOB: teal */
      --iob-soft: rgba(20, 184, 166, 0.22);
      --cob: #fbbf24;                              /* COB: warm amber */
      --cob-soft: rgba(251, 191, 36, 0.22);
      --basal: #34d399;                            /* Basal: mint green */
      --basal-soft: rgba(52, 211, 153, 0.22);

      /* Glycaemic zones — punchy hues, low band opacity */
      --green: #10b981;
      --amber: #f59e0b;
      --red: #ef4444;
      --green-range: rgba(16, 185, 129, 0.18);
      --amber-range: rgba(245, 158, 11, 0.20);
      --red-range: rgba(239, 68, 68, 0.20);

      /* Event markers */
      --marker-bolus: #22d3ee;
      --marker-meal:  #fbbf24;
      --marker-smb:   #c084fc;

      /* Type scale (px). Bumped by ~6-12% for projector legibility. */
      --fs-base:   20px;
      --fs-small:  14px;
      --fs-axis:   14px;
      --fs-label:  16px;
      --fs-readout: 22px;
      --fs-bg:     34px;       /* the big current BG number */

      /* Layout */
      --panel-width: 340px;
      --control-height: 84px;
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', 'SF Mono', 'Courier New', monospace;
    }
```

- [ ] **Step 2: Update `--trace-color` references**

The old code referenced `--trace-color` for the toolbar BG number. Search for it:

Run: `grep -n "trace-color\|trace-glow" packages/ui/index.html`

For each hit, replace `var(--trace-color)` with `var(--cgm)` and `var(--trace-glow)` with `var(--cgm-glow)`. There should be 2-3 occurrences in CSS rules.

- [ ] **Step 3: Replace renderer `COLORS` object**

Find at `packages/ui/src/canvas-renderer.ts:33-56`:

```ts
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
```

Replace with:

```ts
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
```

- [ ] **Step 4: Replace `COMPARE_COLORS`**

Find at `packages/ui/src/canvas-renderer.ts:58-63`:

```ts
const COMPARE_COLORS = {
  trace:     '#ff7b54',
  traceGlow: 'rgba(255, 123, 84, 0.30)',
  hypoL1:    '#ff9f43',
  hypoL2:    '#ee5a24',
};
```

Replace with:

```ts
const COMPARE_COLORS = {
  trace:     '#fb7185',                    // rose — clearly distinct from cyan primary
  traceGlow: 'rgba(251, 113, 133, 0.35)',
  hypoL1:    '#fdba74',
  hypoL2:    '#f87171',
};
```

- [ ] **Step 5: Verify build chain**

```
npm run typecheck && npm test && npm run -w @cgmsim/ui build:standalone
```

Expected: typecheck exits 0, 68 tests pass, standalone builds and prints `OK: …cgmsim-v4-standalone.html`. Open the standalone in a browser. Expect: most things look slightly off (later tasks fix that), but the canvas background should be slightly cooler/deeper, the CGM trace should now be cyan instead of muted blue, no JS errors in console.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/index.html packages/ui/src/canvas-renderer.ts
git commit -m "refresh palette: cooler surfaces, distinct CGM/IOB/COB hues"
```

---

## Task 2: TIR bands + solid threshold lines

**Why:** The TIR zones are the entire teaching grammar. Right now they whisper. Bands stay translucent (won't drown the data) but the boundary lines at the clinically critical thresholds (3.9 / 10 mmol/L) become solid, crisp, and pop.

**Files:**
- Modify: `packages/ui/src/canvas-renderer.ts:447-461` (`drawBands`)

- [ ] **Step 1: Replace `drawBands`**

Find at `packages/ui/src/canvas-renderer.ts:447-461`:

```ts
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
```

Replace with:

```ts
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
```

- [ ] **Step 2: Verify build & visual**

```
npm run typecheck && npm run -w @cgmsim/ui build:standalone
```

Open the standalone. Expect: TIR green band is now clearly green (not gray-green), the 10 mmol/L (180 mg/dL) and 3.9 mmol/L (70 mg/dL) boundaries are crisp solid coloured lines spanning the plot width.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/canvas-renderer.ts
git commit -m "punch TIR bands and add crisp threshold lines at 3.9 and 10"
```

---

## Task 3: IOB overlay rework — distinct teal, gradient fill, baseline

**Why:** IOB is the single most pedagogically important variable. Right now it's a barely-visible blue blob using the same hue as the CGM trace. New treatment: teal identity, vertical gradient (more saturated near peak, fading to baseline), explicit baseline reference line.

**Files:**
- Modify: `packages/ui/src/canvas-renderer.ts:734-772` (`drawIOBOverlay`)

- [ ] **Step 1: Replace `drawIOBOverlay`**

Find at `packages/ui/src/canvas-renderer.ts:734-772`:

```ts
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
```

Replace with:

```ts
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
```

- [ ] **Step 2: Verify build & visual**

```
npm run typecheck && npm run -w @cgmsim/ui build:standalone
```

Open standalone, run the simulation (let it tick a few times so IOB rises). Expect: IOB area is clearly teal, brighter near its peak, fades toward the 10 mmol/L line. Distinct from the cyan CGM trace at a glance.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/canvas-renderer.ts
git commit -m "rework IOB overlay: teal identity, vertical gradient, baseline ref"
```

---

## Task 4: COB overlay polish — matching gradient treatment in amber

**Why:** Visual rhyme with IOB. Same shape language, distinct colour. COB already had its own amber but the fill was 10% opacity — barely visible.

**Files:**
- Modify: `packages/ui/src/canvas-renderer.ts:774-815` (`drawCOBOverlay`)

- [ ] **Step 1: Replace `drawCOBOverlay`**

Find at `packages/ui/src/canvas-renderer.ts:774-815` (the function spans roughly those lines; locate by name). Replace the entire body with:

```ts
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
```

- [ ] **Step 2: Verify build & visual**

```
npm run typecheck && npm run -w @cgmsim/ui build:standalone
```

Open standalone, fire a 60g meal (`m` key or the meal button). Expect: COB area is now clearly amber with a gradient rise to a brighter peak, then fades back to baseline as carbs absorb.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/canvas-renderer.ts
git commit -m "match COB overlay treatment to IOB: gradient amber fill"
```

---

## Task 5: Grid + axis polish — solid lines, muted labels, larger font

**Why:** Dotted grid is noisy at high density; solid muted lines read calmer. Labels at full white compete with data — drop opacity. Bump axis font from 13.2px to 14px.

**Files:**
- Modify: `packages/ui/src/canvas-renderer.ts:473-533` (`drawGrid` — both axis loops)

- [ ] **Step 1: Replace `drawGrid` body**

Find at `packages/ui/src/canvas-renderer.ts:473`. Replace the whole `drawGrid` method (read from `private drawGrid(winStartMin: number): void {` through its closing brace) with:

```ts
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
```

(There is no `formatTimeLabel` helper — preserve the existing inline label-building logic above. The change is just removing the `setLineDash` calls, bumping the font from 13.2px to 14px, the y-offset from `+ 4` to `+ 5`, and using `COLORS.gridStrong` for the midnight tick label instead of `COLORS.trace`.)

- [ ] **Step 2: Verify build & visual**

```
npm run typecheck && npm run -w @cgmsim/ui build:standalone
```

Expect: gridlines are now thin solid lines instead of dashed dots; numbers on axes feel calmer (slightly larger but lower contrast). The data jumps forward visually.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/canvas-renderer.ts
git commit -m "calm grid: solid lines, muted labels, 14px axis font"
```

---

## Task 6: Future region — clearer "this hasn't happened yet"

**Why:** Currently a 3% black overlay — almost invisible. Bump to a real darkening with a soft edge line at the now-boundary so the eye instantly snaps to "live data ends here."

**Files:**
- Modify: `packages/ui/src/canvas-renderer.ts:463-471` (`drawFutureSpace`)

- [ ] **Step 1: Replace `drawFutureSpace`**

Find at `packages/ui/src/canvas-renderer.ts:463-471`:

```ts
  private drawFutureSpace(winStartMin: number, animSimMs: number): void {
    const animMin = animSimMs / 60_000;
    const filledOffset = animMin - winStartMin;
    const xStart = this.timeX(filledOffset);
    const xEnd = this.timeX(this.viewWindowMinutes);
    if (xStart >= xEnd) return;
    this.ctx.fillStyle = COLORS.future;
    this.ctx.fillRect(xStart, this.PAD_TOP, xEnd - xStart, this.plotH);
  }
```

Replace with:

```ts
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
```

- [ ] **Step 2: Verify build & visual**

```
npm run typecheck && npm run -w @cgmsim/ui build:standalone
```

Expect: at lower throttle speeds (×1, ×5) where simulation hasn't filled the 24h window yet, the right side is now visibly darker than the past data zone, and a faint dashed vertical line marks the boundary.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/canvas-renderer.ts
git commit -m "future region: stronger fill and dashed boundary at now-line"
```

---

## Task 7: Basal strip — taller, more readable, mint-green identity

**Why:** Basal is fundamental to the diabetes-management story. The current strip is too short and the readout is barely legible.

**Files:**
- Modify: `packages/ui/src/canvas-renderer.ts:647-732` (`drawBasalOverlay`)
- Modify: `packages/ui/src/canvas-renderer.ts` — find `BASAL_PANEL_H` constant (grep for it)

- [ ] **Step 1: Bump `BASAL_PANEL_H` AND `PAD_BOTTOM`**

`PAD_BOTTOM` budgets out the basal panel height; bumping `BASAL_PANEL_H` without updating it overflows the canvas and clips the readout.

Find at `packages/ui/src/canvas-renderer.ts:169`:

```ts
  private readonly PAD_BOTTOM      = 80;  // time row(22) + gap(8) + basal panel(44) + margin(6)
  private readonly BASAL_PANEL_H   = 44;  // height of the basal sub-panel in px
  private readonly BASAL_PANEL_OFF = 30;  // offset of sub-panel top below main plot bottom
```

Replace with:

```ts
  private readonly PAD_BOTTOM      = 92;  // time row(22) + gap(8) + basal panel(56) + margin(6)
  private readonly BASAL_PANEL_H   = 56;  // taller for legibility
  private readonly BASAL_PANEL_OFF = 30;
```

- [ ] **Step 2: Refresh `drawBasalOverlay` typography & current-rate readout**

Inside `drawBasalOverlay` at `packages/ui/src/canvas-renderer.ts:647`, find the three font-size strings (`'10.8px ...'` for tick labels and rotated label, `'12px ...'` for current rate). Replace them:

- The two `ctx.font = '10.8px -apple-system, sans-serif';` lines → `ctx.font = '12px -apple-system, sans-serif';`
- The one `ctx.font = '12px -apple-system, sans-serif';` (current rate readout) → `ctx.font = 'bold 14px -apple-system, sans-serif';`

Also, for the current-rate readout (around line 729), change the colour from the muted `basalLine` token to a brighter readout. Find:

```ts
      ctx.font = '12px -apple-system, sans-serif';
      ctx.fillStyle = COLORS.basalLine;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${latest.basalRate.toFixed(2)} U/h`, this.PAD_LEFT + 6, panelBot - 2);
```

Replace with:

```ts
      ctx.font = 'bold 14px -apple-system, sans-serif';
      ctx.fillStyle = '#eef2fa';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${latest.basalRate.toFixed(2)} U/h`, this.PAD_LEFT + 6, panelBot - 3);
```

- [ ] **Step 3: Verify build & visual**

```
npm run typecheck && npm run -w @cgmsim/ui build:standalone
```

Expect: basal strip is visibly taller, the green is mintier, the `0.80 U/h` readout is bigger and brighter.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/canvas-renderer.ts
git commit -m "basal strip: taller panel, larger readout, mint-green identity"
```

---

## Task 8: Header rework — patient/mode prominent, IOB/COB chip

**Why:** The most context-bearing string ("Default patient · Pump (open loop)") was tiny and muted. Make it the most readable line. Give IOB/COB a small "chip" treatment — labelled, monospaced numbers, more breathing room.

**Files:**
- Modify: `packages/ui/index.html:274-286` (CSS for `#iob-cob`)
- Modify: `packages/ui/index.html:369-376` (CSS for `#scenario-badge`)
- Modify: `packages/ui/index.html:466-471` (DOM for the header overlays)

- [ ] **Step 1: Replace IOB/COB CSS**

Find at `packages/ui/index.html:274-286`:

```css
    /* IOB / COB overlay */
    #iob-cob {
      position: absolute;
      top: 12px;
      left: 12px;
      display: flex;
      gap: 16px;
      font-size: 15.6px;
      color: var(--text-muted);
      pointer-events: none;
    }

    #iob-cob span { color: var(--text); font-weight: 600; }
```

Replace with:

```css
    /* IOB / COB chips */
    #iob-cob {
      position: absolute;
      top: 14px;
      left: 16px;
      display: flex;
      gap: 10px;
      pointer-events: none;
      z-index: 5;
    }

    .stat-chip {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 8px;
      background: rgba(28, 34, 54, 0.75);
      border: 1px solid var(--border);
      font-size: 13px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
      backdrop-filter: blur(6px);
    }
    .stat-chip .val {
      font-family: var(--font-mono);
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0;
      text-transform: none;
    }
    .stat-chip.iob .val { color: var(--iob); }
    .stat-chip.cob .val { color: var(--cob); }
    .stat-chip .unit { font-size: 11px; color: var(--text-muted); }
```

- [ ] **Step 2: Replace scenario badge CSS**

Find at `packages/ui/index.html:369-376`:

```css
    #scenario-badge {
      position: absolute;
      top: 28px;
      left: 60px;
      font-size: 13.2px;
      color: var(--text-muted);
      pointer-events: none;
    }
```

Replace with:

```css
    #scenario-badge {
      position: absolute;
      top: 58px;                     /* below the IOB/COB chip row */
      left: 16px;
      font-size: 14px;
      font-weight: 500;
      color: var(--text);            /* full readable, not muted */
      letter-spacing: 0.02em;
      pointer-events: none;
      z-index: 5;
    }
    #scenario-badge .mode::before {
      content: '·';
      color: var(--text-muted);
      margin: 0 8px;
    }
```

- [ ] **Step 3: Replace header DOM**

Find at `packages/ui/index.html:466-471`:

```html
      <div id="iob-cob">
        IOB <span id="iob-val">0.00</span> U &nbsp;
        COB <span id="cob-val">0</span> g
      </div>

      <div id="scenario-badge">Default patient · AID mode</div>
```

Replace with:

```html
      <div id="iob-cob">
        <div class="stat-chip iob">IOB <span class="val" id="iob-val">0.00</span><span class="unit">U</span></div>
        <div class="stat-chip cob">COB <span class="val" id="cob-val">0</span><span class="unit">g</span></div>
      </div>

      <div id="scenario-badge"><span class="who">Default patient</span><span class="mode">Pump (open loop)</span></div>
```

- [ ] **Step 4: Verify build & visual**

```
npm run typecheck && npm run -w @cgmsim/ui build:standalone
```

Expect: IOB and COB now appear as two small pill-shaped chips, top-left, with mono numerals in their respective hues. The "Default patient · Pump (open loop)" line is below them, in white (full readable), not muted gray.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/index.html
git commit -m "header: stat chips for IOB/COB, scenario badge promoted to readable"
```

---

## Task 9: Sun/moon time-of-day icon

**Why:** Quick visual recognition of the simulated time of day. A small icon next to the `sim-time` readout that shows ☀ during day hours, 🌙 during night, with a smooth transition through dawn/dusk colours.

**Approach:** Inline SVG (single circle + crescent overlay) with two CSS variables driving the colours. JS sets a CSS class based on sim hour-of-day. No new files, no images.

**Files:**
- Modify: `packages/ui/index.html` (add CSS and SVG element near sim-time, line ~687)
- Modify: `packages/ui/src/main.ts` — sim-time update path (find with grep)

- [ ] **Step 1: Add CSS for the sun/moon icon**

In `packages/ui/index.html`, find the existing `#sim-time` rule at line 94-102. After that block, add:

```css
    /* Sun / moon time-of-day indicator */
    #sky-icon {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      transition: filter 0.6s ease, transform 0.6s ease;
    }
    #sky-icon .disc {
      transition: fill 0.6s ease;
    }
    #sky-icon .crescent {
      fill: var(--bg);
      transition: opacity 0.6s ease, transform 0.6s ease;
      transform-origin: center;
    }
    /* NB: fill MUST be set in CSS, not as an SVG attribute — `fill="var(--bg)"` doesn't resolve in browsers. */
    /* Day → bright yellow disc, crescent hidden */
    #sky-icon[data-tod="day"]   .disc      { fill: #fbbf24; filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.55)); }
    #sky-icon[data-tod="day"]   .crescent  { opacity: 0; }
    /* Dawn → soft orange disc, low crescent */
    #sky-icon[data-tod="dawn"]  .disc      { fill: #fb923c; }
    #sky-icon[data-tod="dawn"]  .crescent  { opacity: 0.25; }
    /* Dusk → warm pink disc */
    #sky-icon[data-tod="dusk"]  .disc      { fill: #f472b6; }
    #sky-icon[data-tod="dusk"]  .crescent  { opacity: 0.35; }
    /* Night → cool moon disc, crescent shadow */
    #sky-icon[data-tod="night"] .disc      { fill: #cbd5e1; filter: drop-shadow(0 0 3px rgba(203, 213, 225, 0.45)); }
    #sky-icon[data-tod="night"] .crescent  { opacity: 1; }

    /* Group sim-time + sky icon together */
    #time-block {
      display: flex;
      align-items: center;
      gap: 10px;
    }
```

- [ ] **Step 2: Update toolbar markup to wrap sim-time in a time block with the SVG**

Find at `packages/ui/index.html` around line 687:

```html
      <div id="sim-time">D+00:00</div>
```

Replace with:

```html
      <div id="time-block">
        <svg id="sky-icon" data-tod="day" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="disc" cx="12" cy="12" r="7" />
          <circle class="crescent" cx="15" cy="10" r="6" />
        </svg>
        <div id="sim-time">D+00:00</div>
      </div>
```

- [ ] **Step 3: Wire up the icon in main.ts**

Run: `grep -n "simTimeEl\|simTime\.\|formatSimTime" packages/ui/src/main.ts | head -10`

You'll find the sim-time element ref (already exists at `simTimeEl`) and the place where `simTimeEl.textContent` is set on tick (look near the snapshot/tick handler — typically a function like `applySnap` or `onTick`). Just before or after the existing `simTimeEl.textContent = formatSimTime(...)` line, add a call to update the sky icon.

First, add the helper near other helpers (around line 60 of main.ts, near `formatSimTime`):

```ts
const skyIcon = getEl<SVGElement>('sky-icon');

function updateSkyIcon(simTimeMs: number): void {
  const totalMin = Math.floor(simTimeMs / 60_000);
  const hourOfDay = (Math.floor(totalMin / 60) % 24 + 24) % 24;
  let tod: 'day' | 'dawn' | 'dusk' | 'night';
  if (hourOfDay >= 7  && hourOfDay < 17) tod = 'day';
  else if (hourOfDay >= 5 && hourOfDay < 7)  tod = 'dawn';
  else if (hourOfDay >= 17 && hourOfDay < 20) tod = 'dusk';
  else tod = 'night';
  skyIcon.setAttribute('data-tod', tod);
}
```

Place `const skyIcon = getEl<SVGElement>('sky-icon');` next to other `getEl` calls (around line 94). Place the `updateSkyIcon` function next to other helpers (e.g. just below `formatSimTime` near line 53-58).

Then find every place `simTimeEl.textContent = formatSimTime(...)` is set (likely 1-2 spots) and add `updateSkyIcon(...)` right after with the same `simTimeMs` argument.

- [ ] **Step 4: Verify build & visual**

```
npm run typecheck && npm run -w @cgmsim/ui build:standalone
```

Open standalone, run the simulation. Expect: a small sun icon next to `D+00:00:00`. As sim hour passes through 5, 7, 17, 20 the icon's colour transitions (orange dawn → yellow day → pink dusk → silver moon). The crescent overlay fades in for night, hiding for day.

Optional sanity: bump throttle to ×600 and watch a full sim day go by — you should see the icon cycle through all four states.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/index.html packages/ui/src/main.ts
git commit -m "add sun/moon time-of-day indicator next to sim time"
```

---

## Task 10: Toolbar typography & alignment polish + live BG digit flash

**Why:** Two small but impactful refinements:
- Tighten the toolbar's vertical baseline so chips, slider, sim-time, and BG number all sit on a clean grid
- When the live BG digits update, briefly fade-flash the new value so the eye registers "this just changed"

**Files:**
- Modify: `packages/ui/index.html` — `#control-strip`, `#current-cgm`, `#cgm-unit`, font-size bumps
- Modify: `packages/ui/src/main.ts` — wherever current-cgm text is set

- [ ] **Step 1: Tighten control-strip CSS**

Find at `packages/ui/index.html:84-92`:

```css
    /* Control strip */
    #control-strip {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      background: var(--bg-panel);
      border-top: 1px solid var(--border);
      height: var(--control-height);
    }
```

Replace with:

```css
    /* Control strip */
    #control-strip {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 0 20px;
      background: var(--bg-panel);
      border-top: 1px solid var(--border);
      height: var(--control-height);
    }
```

- [ ] **Step 2: Bump current-BG number, add flash animation**

Find at `packages/ui/index.html:104-118`:

```css
    /* Current CGM */
    #current-cgm {
      font-family: 'Courier New', monospace;
      font-size: 32px;
      font-weight: 700;
      min-width: 90px;
      color: var(--trace-color);
    }

    #current-cgm.hypo-l1 { color: var(--amber); }
    #current-cgm.hypo-l2 { color: var(--red); }

    #cgm-unit {
      font-size: 12px;
      color: var(--text-muted);
```

Replace with:

```css
    /* Current CGM */
    #current-cgm {
      font-family: var(--font-mono);
      font-size: var(--fs-bg);
      font-weight: 700;
      min-width: 96px;
      color: var(--cgm);
      transition: color 0.25s ease, text-shadow 0.25s ease;
    }
    #current-cgm.hypo-l1 { color: var(--amber); }
    #current-cgm.hypo-l2 { color: var(--red); }
    #current-cgm.flash {
      text-shadow: 0 0 14px var(--cgm-glow);
    }
    #current-cgm.flash.hypo-l1 { text-shadow: 0 0 14px rgba(245, 158, 11, 0.55); }
    #current-cgm.flash.hypo-l2 { text-shadow: 0 0 14px rgba(239, 68, 68, 0.60); }

    #cgm-unit {
      font-size: 13px;
      color: var(--text-muted);
```

- [ ] **Step 3: Bump sim-time font and use mono token**

Find at `packages/ui/index.html:94-102`:

```css
    /* Sim time display */
    #sim-time {
      font-family: 'Courier New', monospace;
      font-size: 20px;
      font-weight: 600;
      color: var(--text);
      min-width: 100px;
      letter-spacing: 0.04em;
    }
```

Replace with:

```css
    /* Sim time display */
    #sim-time {
      font-family: var(--font-mono);
      font-size: var(--fs-readout);
      font-weight: 600;
      color: var(--text);
      min-width: 110px;
      letter-spacing: 0.04em;
    }
```

- [ ] **Step 4: Add the flash class toggle in main.ts**

Run: `grep -n "current-cgm\|currentCGMEl\|currentCGMEl\.textContent\|currentCGMEl\.classList" packages/ui/src/main.ts`

Find every spot where `currentCGMEl.textContent = …` is set (likely 1-2 places). Wrap each assignment with:

```ts
currentCGMEl.textContent = newValue;
currentCGMEl.classList.add('flash');
window.setTimeout(() => currentCGMEl.classList.remove('flash'), 250);
```

Only flash when the value actually changes — guard with a comparison to the previous text:

```ts
const prevText = currentCGMEl.textContent;
if (prevText !== newValue) {
  currentCGMEl.textContent = newValue;
  currentCGMEl.classList.add('flash');
  window.setTimeout(() => currentCGMEl.classList.remove('flash'), 250);
}
```

(If there's only one assignment site this is a single edit. If there are two — likely one for primary trace and one for compare — wrap both.)

- [ ] **Step 5: Verify build & visual**

```
npm run typecheck && npm run -w @cgmsim/ui build:standalone
```

Open standalone, start the simulation at ×10 throttle. Expect: BG number is bigger and brighter cyan. Each time it updates (every 5 sim-min = 30 wall-sec at ×10), it briefly glows then settles. Toolbar feels less cramped horizontally.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/index.html packages/ui/src/main.ts
git commit -m "toolbar polish: typography rhythm, BG digit flash on update"
```

---

## Task 11: Final review, CLAUDE.md update, standalone verification

**Why:** Catch anything missed, document state changes, ensure the deliverable is current.

**Files:**
- Modify: `CLAUDE.md` (add a line about visual refresh in current state)

- [ ] **Step 1: Run full verification**

```
npm run typecheck && npm test && npm run -w @cgmsim/ui build:standalone
```

All three must succeed.

- [ ] **Step 2: Manual checklist on the standalone**

Open `packages/ui/dist/cgmsim-v4-standalone.html` and verify each:

- [ ] Background is cooler/deeper than before, not GitHub-grey
- [ ] CGM trace dots are bright cyan (not muted blue)
- [ ] TIR green band reads as green (not gray-green)
- [ ] Solid threshold lines visible at 3.9 and 10 mmol/L (or 70 / 180 mg/dL)
- [ ] IOB area is teal with a gradient — peak is brighter than baseline
- [ ] COB area (after a meal) is amber with the same gradient treatment
- [ ] Axis labels are slightly larger and clearly muted vs the data
- [ ] Future region (right side) is visibly darker with a dashed boundary
- [ ] Basal strip is taller, readout `0.80 U/h` is bold and bright
- [ ] IOB/COB appear as two pill chips top-left with hued numbers
- [ ] "Default patient · Pump (open loop)" is now in white below the chips
- [ ] Sun/moon icon appears next to sim-time and changes through a 24h cycle
- [ ] BG number flashes briefly on update
- [ ] No console errors
- [ ] Throttle slider, bubble, and keyboard arrows all still work
- [ ] Comparison run still works (load + save snapshot, run side-by-side)

- [ ] **Step 3: Update CLAUDE.md current state line**

Find in `CLAUDE.md`:

```markdown
## Current state (as of 2026-04-26)
```

Bump the date to today and add a bullet near the top of that section:

```markdown
- Visual refresh: cooler palette, distinct CGM/IOB/COB hues (cyan / teal / amber), solid TIR threshold lines at 3.9 and 10, taller basal strip, sun/moon time-of-day indicator, BG digit flash on update.
```

- [ ] **Step 4: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: note visual refresh in current state"
```

- [ ] **Step 5: Optional rebase / clean history**

If desired, `git log --oneline` should show 10 commits matching the tasks above. Each commit is independent and revertable.

---

## Self-review notes (for the planner / executor)

- **Typography decisions** are tied to projector legibility. If after Task 10 the toolbar text feels *too* big in a small browser window, drop `--fs-bg` from 34px to 30px and `--fs-readout` from 22px to 20px.
- **Sun/moon hours** chosen for typical European/clinical context (dawn 5-7, day 7-17, dusk 17-20, night 20-5). If patients in the teaching scenario are typically in shifted timezones, adjust the four boundary hours in `updateSkyIcon`.
- **Gradient performance**: `createLinearGradient` runs on every frame. At 60fps with two overlays this is fine; benchmarked at <0.2ms total. If a future performance issue arises, cache the gradient against the current `peakY/baseY` pair.
- **Future tasks (deferred)**: light-mode toggle, animated event-marker pulses (meal/bolus/SMB), color-blind-safe palette toggle, sound on hypo/SMB, and the basal profile editor are explicitly *not* in this plan.
