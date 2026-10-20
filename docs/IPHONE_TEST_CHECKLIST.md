# iPhone 16 Pro / Safari 26 test checklist — **NOT YET VERIFIED**

Testing so far ran only in headless Chromium (Linux). Mark each item on a real device:

- [ ] Open the HTTPS deployment in Safari and Add to Home Screen. Launches standalone.
- [ ] Settings → device table shows `webgpu: true` and a GPU adapter name.
- [ ] Import MP3 from Files. Stats appear. Playback is audible.
- [ ] Pinch-zoom and pan the waveform. Tap to seek.
- [ ] DSP separation on a 3–4 min song finishes without a reload (note the time).
- [ ] Model Manager: import RVC v2 `.onnx` (~55 MB) and `vec-768-layer-12.onnx` (~360 MB). Test load reports the backend.
- [ ] Preview 15 s conversion in BALANCED. Record time, backend, and whether WebGPU fell back.
- [ ] Full conversion in LIGHT for a 3 min vocal (watch for an OOM reload).
- [ ] Audible timbre change and melody kept (A/B buttons).
- [ ] Pitch editor: drag a note, render the phrase, hear the change.
- [ ] Mixer playback, then Mastering measure.
- [ ] Export WAV and MP3 via the share sheet → Files. Both play in the Files app.
- [ ] Kill the app, reopen: project restored.
- [ ] Airplane mode, reopen: app and project load, conversion works with cached models.
- [ ] Safari Web Inspector → Network: no requests to other origins while processing.
- [ ] v0.2: Edit / upgrade → Build feature index from 1–2 min of samples (note the time) → convert with index rate 0.75. Is the timbre match score higher than with index rate 0?
- [ ] v0.2: Link a real `rmvpe.onnx`, Test load, convert with RMVPE. Melody correlation should be ≥ 0.9 on a clean vocal.
- [ ] v0.2: Export a dataset .zip and open it in the Files app.
