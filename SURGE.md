# Deploying cgmsim-v4 to Surge

## Prerequisites

```bash
npm install -g surge
surge login   # one-time, uses lsandini@gmail.com
```

## Build the standalone files

From the project root:

```bash
npm run build:standalone   # desktop → packages/ui/dist/cgmsim-v4-standalone.html
npm run build:mobile       # mobile  → packages/ui/dist/cgmsim-v4-mobile.html
```

The two builds are independent and produce two separate self-contained HTML files.
Run desktop **first** then mobile — the mobile config has `emptyOutDir: false` to
preserve the desktop artefact, but the desktop config wipes `dist/` on every run,
so reversing the order will delete the mobile build.

## Deploy to Surge

Surge requires `index.html` at the root of the folder you deploy. Each build gets
its own deploy folder and its own subdomain — they're published independently.

### Desktop (cgmsim.surge.sh)

```bash
mkdir -p deploy/desktop
cp packages/ui/dist/cgmsim-v4-standalone.html deploy/desktop/index.html
surge deploy/desktop/ cgmsim.surge.sh
```

### Mobile (cgmsim-mobile.surge.sh)

```bash
mkdir -p deploy/mobile
cp packages/ui/dist/cgmsim-v4-mobile.html deploy/mobile/index.html
surge deploy/mobile/ cgmsim-mobile.surge.sh
```

Replace either subdomain with one of your own (first come, first served on
`*.surge.sh`). Students get the mobile URL on their phones; instructors use the
desktop URL on the classroom machine.

## Teardown

```bash
surge teardown cgmsim.surge.sh          # desktop
surge teardown cgmsim-mobile.surge.sh   # mobile
```

## Custom domain

If you want to serve from `cgmsim.com` or a subdomain (e.g.
`mobile.cgmsim.com`):

1. Add a CNAME record pointing to `na-west1.surge.sh`
2. Deploy with your domain instead:

```bash
surge deploy/desktop/ cgmsim.com
surge deploy/mobile/  mobile.cgmsim.com
```

## Notes

- Do not surge the full `packages/ui/dist/` folder — it contains unbundled Vite
  assets that are not needed, and you'd ship both HTMLs at one URL.
- Both standalone files are fully self-contained (no external dependencies).
- Surge free tier is public; anyone with the URL can access it.
- The mobile build is **iPhone-landscape only**; portrait viewports show a
  "rotate device" overlay. Don't share the mobile URL as a desktop URL — students
  on a desktop browser will see a working sim too, but it's tuned for ~852×393.
