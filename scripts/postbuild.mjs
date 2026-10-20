// Remove the duplicate hashed ORT wasm Vite emits; the runtime loads ./ort/ (wasmPaths), so this saves ~21 MB per deploy/cache.
import { readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
for (const f of readdirSync('dist/assets')) if (f.endsWith('.wasm')) rmSync(`dist/assets/${f}`);
const m = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
for (const [k, v] of Object.entries(m)) if (v.file.endsWith('.wasm')) delete m[k]; else if (v.assets) v.assets = v.assets.filter((a) => !a.endsWith('.wasm'));
writeFileSync('dist/.vite/manifest.json', JSON.stringify(m));
writeFileSync('dist/.nojekyll', ''); // GitHub Pages: serve .vite/ directory
