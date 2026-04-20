# CGMSIM v4

Standalone browser-based glycaemic teaching simulator for structured diabetes education sessions.

Part of the [CGMSIM platform](https://cgmsim.com) — fourth generation, designed for instructor-controlled classroom use with no server or installation required.

## Quick start

Download `cgmsim-v4-standalone.html` and open it in any modern browser. That's it.

## Features

- Physiological glucose model with insulin PD profiles, carbohydrate absorption, EGP/dawn phenomenon, and Dexcom G6 sensor noise
- Three therapy modes: AID (PID controller), open-loop pump, MDI
- Adjustable simulation speed (x0.25 to x100) — run a full 14-day scenario in ~17 minutes
- Pause/resume at any point for discussion
- Side-by-side comparison runs with different parameters
- Session save/load (browser IndexedDB) and JSON export/import
- Dark theme optimized for projection in classrooms

## Development

```bash
npm install
npm run dev          # Dev server with hot reload at localhost:5173
npm run build        # Build all packages
```

See [BUILD.md](BUILD.md) for details on producing the standalone HTML.

## License

TBD
