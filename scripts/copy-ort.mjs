// Copies the WebGPU/JSEP ONNX Runtime Web WASM binaries (the only ones the webgpu bundle loads) into public/ort so they are served (and cached) locally.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
const src = 'node_modules/onnxruntime-web/dist', dst = 'public/ort';
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) if (/^ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/.test(f)) cpSync(`${src}/${f}`, `${dst}/${f}`);
console.log('ORT wasm copied to', dst);
