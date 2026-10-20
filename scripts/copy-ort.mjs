// Copies ONNX Runtime Web WASM binaries into public/ort so they are served (and cached) locally.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
const src = 'node_modules/onnxruntime-web/dist', dst = 'public/ort';
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) if (/^ort-wasm.*\.(wasm|mjs)$/.test(f)) cpSync(`${src}/${f}`, `${dst}/${f}`);
console.log('ORT wasm copied to', dst);
