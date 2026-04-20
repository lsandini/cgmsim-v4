import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir   = resolve(__dirname, 'dist');
const assetsDir = resolve(distDir, 'assets');

const mainFile = readdirSync(assetsDir).find(f => f.startsWith('index') && f.endsWith('.js'));
if (!mainFile) { console.error('No main bundle found'); process.exit(1); }

let mainJs = readFileSync(resolve(assetsDir, mainFile), 'utf8');
let html   = readFileSync(resolve(distDir, 'index.html'), 'utf8');

// Remove external script tag, inline bundle directly
html = html.replace(/<script[^>]+src="\/assets\/[^"]*"[^>]*><\/script>/g, '');
html = html.replace('</head>', `<script type="module">\n${mainJs}\n</script>\n</head>`);

const outPath = resolve(distDir, 'cgmsim-v4-standalone.html');
writeFileSync(outPath, html, 'utf8');
console.log(`OK: ${outPath} (${(html.length/1024).toFixed(1)} kB)`);
