# Architecture

```
File ─► decode.ts (Web Audio / WAV parser) ─► PCM {sampleRate, Float32Array[]}
     ─► analysis.ts (peak, RMS, BPM, key) · loudness.ts (LUFS, true peak)
     ─► separation.ts (DSP center mask)        ─► vocal / instrumental stems
vocal ─► ai/coverPipeline.ts
          ├─ ai/rvc.ts  RvcEngine
          │    resample→16 kHz · content encoder ONNX (50 fps) · repeat×2 → 100 fps
          │    YIN F0 (hop 160) · rvcMath.shapeF0 (transpose/correction/vibrato/stability/octave)
          │    coarsePitch (RVC mel bins) · generator ONNX (phone, phone_lengths, pitch, pitchf, ds, rnd)
          │    chunking + equal-power overlap-add (rvcMath.overlapAdd)
          ├─ resample to project rate · latency alignment (envelope x-corr)
          ├─ expression (envelope) + consonant (unvoiced) preservation · voice blend
          └─ humanvoice.ts (post DSP) ─► converted track
tracks ─► render.ts (OfflineAudioContext: gain/automation, EQ, comp, pan, reverb, delay; JS de-ess, width, limiter)
       ─► wav.ts / mp3.ts (LAME) ─► download / iOS share sheet
```

* **Adapters.** `RvcEngine` is the first voice-conversion adapter. To add another architecture, write a class with `load(backend)`, `convert(mono, sr, params, onProgress, signal)` and `release()`, and select it in `coverPipeline.getEngine`.
* **Memory.** One model set is loaded at a time (`getEngine` releases the previous one). Audio is processed one chunk at a time. Settings → "Release loaded models" frees memory.
* **Storage.** IndexedDB holds projects, singers, presets and PCM assets (raw Float32 blobs). Models go to OPFS, with IndexedDB as a fallback. The service worker Cache Storage holds the app shell and the ORT wasm.
* **Backends.** `onnxruntime-web/webgpu` is used, with a WebGPU session tried first and WASM as the fallback. Threads are enabled only when `crossOriginIsolated` is true.
