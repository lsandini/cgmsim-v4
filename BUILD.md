# Build Guide

CGMSIM v4 is an npm-workspaces monorepo with three packages:

| Package | Role |
|---|---|
| `packages/shared` | TypeScript type definitions only — no runtime code |
| `packages/simulator` | Physiological engine (deltaBG, EGP, IOB, PID, G6 noise). Pure TypeScript, browser-agnostic |
| `packages/ui` | Vite SPA — Canvas renderer, panel, IndexedDB persistence. Vanilla TypeScript, no framework |

## Prerequisites

- Node.js **20.19+** or **22.12+** (Vite 8 minimum). Tested on Node 22.
- npm 10+ (ships with Node 20)

## Setup (once after cloning)

```bash
npm install
```

Run this from the repo root only — npm workspaces installs all three packages and wires up their cross-references automatically. **Do not** run `npm install` inside individual `packages/*/` directories.

---

## Workflow paths

You almost always want one of these two:

### A. Live development with hot reload

```bash
npm run dev
```

Starts Vite at `http://localhost:5173`. Edit any `.ts` file in any package and the browser hot-reloads. Use this for everything except producing the final deliverable.

### B. Build the standalone HTML (the teaching deliverable)

```bash
npm run build:standalone
```

Run from the repo root — there's a workspace shortcut that forwards to `packages/ui`. Output: **`packages/ui/dist/cgmsim-v4-standalone.html`** — a single self-contained HTML file with all CSS, JS, and assets inlined. Open it directly in any browser; no server, no install. This is the file you ship to teachers.

Inlining is done by the [`vite-plugin-singlefile`](https://www.npmjs.com/package/vite-plugin-singlefile) plugin (configured in `packages/ui/vite.config.ts`). The plugin produces `dist/index.html` with the JS bundle inlined; the npm script then renames it to `cgmsim-v4-standalone.html`.

> Always rebuild this after every change before reporting work as done.

---

## Other commands

```bash
npm run typecheck   # tsc --build across all packages — catches type errors
npm run test        # Vitest 4 unit tests in packages/simulator (102 tests)
```

These run from the repo root and cover all packages.

---

## `npm run build` vs `npm run build:standalone`

Both produce the same single-file standalone — the plugin always inlines. The only difference is what runs around the Vite step:

| Command | Where | What it does |
|---|---|---|
| `npm run build` | repo root | `tsc --noEmit` → `vite build` → rename. Type-checks everything first. Also builds `packages/shared` and `packages/simulator` declaration files into their `dist/` directories. |
| `npm run build:standalone` | repo root | `vite build` → rename. Skips typecheck and the other workspaces. Faster iteration. |

For day-to-day shipping use `build:standalone`. Use `build` (or `npm run typecheck` separately) when you want type validation — e.g., before committing.

---

## Architecture notes for new contributors

A few things look unusual in the codebase but are intentional. Knowing them up front prevents confusion.

**1. The runtime entry is TypeScript, not compiled JS.**
`packages/ui/index.html` loads `/src/main.ts` directly via Vite's TypeScript handler. There's no precompile step. The `@cgmsim/shared` package even sets `"main": "./src/index.ts"` in its `package.json`. **No `dist/` directory is required for `dev` or `build:standalone` to work.**

**2. UI `.js` files are not used.**
The `ui/tsconfig.json` has `"noEmit": true` so `tsc --build` does not generate `.js` siblings next to UI sources. Vite reads `.ts` directly. Only edit `.ts` for UI code.

**3. Simulator `.js` files ARE the runtime.**
`packages/simulator/src/*.js` files are hand-maintained and resolved directly by Vite when imported via cross-package `.js` paths (e.g., `'../../simulator/src/deltaBG.js'` from UI code). Their `.ts` siblings are the type-checked source of truth — but the `.js` files are what runs at build time and **must be kept manually in sync**. `TICK_MINUTES` in all simulator `.js` files is **5**.

This is the one place where you must edit *both* `.ts` and `.js` for the same change.

**4. Sourcemaps and `tsbuildinfo` are gitignored.**
`*.js.map` files for simulator runtime, all UI `.js` and `.map`, and `*.tsbuildinfo` are ignored. Don't commit them. `packages/simulator/tsconfig.json` has `sourceMap: false` so `tsc --build` no longer emits `.js.map` into `dist/` — the simulator `.js` files in `src/` are hand-maintained and shouldn't carry trailing `//# sourceMappingURL` comments. If you ever copy `dist/*.js` back into `src/`, strip those comments.

---

## Where to edit

| Area | File |
|---|---|
| Simulation physics (deltaBG, EGP, IOB, carbs, PID, G6 noise) | `packages/simulator/src/` *(edit `.ts` and `.js` together)* |
| Canvas rendering (chart, basal panel, event markers) | `packages/ui/src/canvas-renderer.ts` |
| UI logic (buttons, panels, startup wiring) | `packages/ui/src/main.ts` |
| HTML layout and CSS | `packages/ui/index.html` |
| Type definitions (shared types between simulator and UI) | `packages/shared/src/index.ts` |
| Unit tests | `packages/simulator/src/physics.test.ts` *and* `physics.test.js` |

---

## Troubleshooting

**`npm run dev` fails with module-resolution errors.**
You probably ran `npm install` inside a sub-package. From the repo root: `rm -rf node_modules packages/*/node_modules && npm install`.

**`npm run build:standalone` succeeds but `dist/` is empty / has multiple files.**
Confirm `vite-plugin-singlefile` is loaded — `packages/ui/vite.config.ts` should `import { viteSingleFile } from 'vite-plugin-singlefile'` and include `viteSingleFile()` in `plugins`. Without the plugin, Vite will produce a split `index.html` + `assets/index-XXXX.js` instead of one inlined file.

**Tests pass via `npm run test` but the standalone behaves differently.**
You probably edited a simulator `.ts` without updating its `.js` sibling. Diff them and align — see Architecture note 3.
