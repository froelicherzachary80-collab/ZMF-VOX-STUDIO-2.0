# ZMF VOX STUDIO+ (v0.1)

A local-first AI singing studio that runs in the browser as a PWA. You import a song, separate it into stems, convert the vocal with an RVC voice model you're allowed to use, then edit, mix, master and export it. All of this happens on your device. There is no backend, no account, no API key, and nothing gets uploaded.

> **Status: honest summary.** Everything marked ✅ below is implemented and covered by automated tests. **Nothing has been verified on a real iPhone yet** (see `docs/IPHONE_TEST_CHECKLIST.md`).

## What works and what doesn't

| Capability | Status | Notes |
|---|---|---|
| MP3/WAV import, local decode, waveform (pinch/scroll zoom, pan, seek) | ✅ | Web Audio decode, built-in WAV parser |
| Length / sample rate / channels / peak / RMS / BPM / key (with confidence) | ✅ | Onset-autocorrelation tempo, Krumhansl key estimate |
| Vocal / instrumental separation | ⚠️ **DSP only** | STFT center-channel mask. Not neural, and much weaker than Demucs. You can also supply your own stems. |
| Neural separation (Demucs/MDX ONNX) | ❌ | Not integrated. No model was verified to fit iPhone memory. |
| **RVC singing voice conversion** (ContentVec/HuBERT ONNX → F0 → RVC generator ONNX) | ✅ pipeline / ⚠️ models | Real ONNX Runtime Web inference (WebGPU with WASM fallback), chunked with overlap-add. **No voice weights are bundled.** Import your own RVC v1/v2 `.onnx` export plus a content encoder. CI exercises it with synthetic fixture models; it has **not** been tested with a real RVC voice yet. |
| F0: transpose, auto-octave to target range, pitch correction, vibrato scaling, stability | ✅ | Shapes the F0 that drives the generator |
| Consonant/unvoiced preservation, expression (envelope) preservation, voice blend | ✅ | Post-model signal blending |
| Formant control | ❌ | The RVC ONNX path has no formant input. Shown as unsupported. |
| Zero-shot cloning from a short sample | ❌ | No browser-verified model. Not offered. |
| On-device training | ❌ | RVC training needs a GPU for hours. Train elsewhere and import the model. |
| Voice analysis profiles (F0 range, centroid, loudness) | ✅ | Clearly labelled **analysis-only**, never "trained" |
| HUMANVOICE engine (de-click, gate, EQ, de-ess, compression, saturation) + 9 presets | ✅ | Post-production DSP, labelled as such |
| Piano-roll pitch editor (detect, move, bend, split/merge, vibrato, gain, undo/redo, A/B) | ✅ | Edits are re-rendered with a granular pitch shifter. Formants move with pitch. |
| Harmony / doubling / octave layers / chorus / humanize / presets | ✅ | Labelled **algorithmic (DSP)**, not neural |
| Multitrack mixer (gain, pan, M/S, EQ, comp, de-ess, reverb, delay, width, automation, draggable regions) | ✅ | Non-destructive, rendered with OfflineAudioContext |
| Mastering (EQ, bus comp, look-ahead limiter, width, LUFS, true peak, presets) | ✅ | BS.1770 loudness, 4× true-peak estimate |
| WAV (16-bit / 32-bit float) and MP3 (LAME) export, stems, iOS share sheet | ✅ | WAV carries an "AI-generated" INFO label when the content is synthetic |
| Project autosave/recovery, portable `.zmfproj` (optional bundled audio) | ✅ | IndexedDB, plus OPFS for models |
| Offline PWA | ✅ in Chromium | Verified headless; not yet on iOS |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 17 DSP/unit tests (Vitest)
npm run build        # static site in dist/
npm run e2e          # 19 end-to-end acceptance checks in headless Chromium (needs python3 + `pip install onnx` for fixtures)
```

### Getting a real voice working
1. Train an RVC model on a PC with RVC WebUI, or use one you have rights to. Export it to **ONNX** (RVC WebUI → "Export Onnx").
2. Get a content encoder ONNX that matches the voice: **768-dim** for RVC v2, **256-dim** for v1, e.g. a ContentVec `vec-768-layer-12.onnx`. Input `[1,1,N]` at 16 kHz.
3. **Model Manager** → confirm permission → import both files → **Test load**.
4. **Voice Clone Lab** → create a singer → link both models and set the sample rate (32k/40k/48k) → Save.
5. **AI Cover Studio** → import a song → separate → choose the singer → **Preview** (10–20 s) → **Render full vocal** → Mixer / Mastering / Export.

## Free static deployment
`dist/` is a plain static site with relative paths, so it works under any sub-path.
- **Cloudflare Pages / Netlify:** build command `npm run build`, output `dist`. `public/_headers` sets COOP/COEP, which turns on multithreaded WASM.
- **GitHub Pages:** publish `dist/`. Pages can't set COOP/COEP, so ONNX Runtime falls back to single-threaded WASM automatically. It's slower but works.
- HTTPS is required for the service worker, microphone and WebGPU.

## Documentation
- `docs/ARCHITECTURE.md`: pipeline, modules and adapters
- `docs/MODELS_AND_LICENSES.md`: model formats and licensing notes
- `docs/TROUBLESHOOTING.md`: mobile limitations and fixes
- `docs/IPHONE_TEST_CHECKLIST.md`: manual device test plan (**not yet executed**)
