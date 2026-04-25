# Deploying cgmsim-v4 to Surge

## Prerequisites

```bash
npm install -g surge
surge login   # one-time, uses lsandini@gmail.com
```

## Build the standalone file

From the project root:

```bash
npm run build:standalone
```

Output: `packages/ui/dist/cgmsim-v4-standalone.html`

## Deploy to Surge

Surge requires `index.html` at the root of the folder you deploy. Create a temporary deploy folder:

```bash
mkdir -p deploy
cp packages/ui/dist/cgmsim-v4-standalone.html deploy/index.html
surge deploy/ cgmsim.surge.sh
```

Replace `cgmsim.surge.sh` with your chosen subdomain (first come, first served on `*.surge.sh`).

## Teardown

```bash
surge teardown cgmsim.surge.sh
```

## Custom domain

If you want to serve from `cgmsim.com` or a subdomain:

1. Add a CNAME record pointing to `na-west1.surge.sh`
2. Deploy with your domain instead:

```bash
surge deploy/ cgmsim.com
```

## Notes

- Do not surge the full `packages/ui/dist/` folder — it contains unbundled Vite assets that are not needed.
- The standalone file is fully self-contained (no external dependencies).
- Surge free tier is public; anyone with the URL can access it.
