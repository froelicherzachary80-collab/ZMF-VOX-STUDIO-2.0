# Troubleshooting & mobile limitations

* **Out of memory / tab reloads on iPhone:** switch to **LIGHT** (Settings): 6 s chunks and WASM. Preview 10 s first, and export segments for long songs. iOS gives each tab a hard memory cap of roughly 1–1.5 GB.
* **WebGPU session fails:** some ONNX operators have no WebGPU kernel. The engine falls back to WASM on its own, and the backend actually used is shown after conversion.
* **Slow conversion:** without COOP/COEP headers WASM runs single-threaded. Host on Cloudflare Pages or Netlify with `public/_headers`.
* **Processing stops when the screen locks:** iOS suspends background tabs. Keep Safari in the foreground. Background processing is not guaranteed.
* **"does not look like an ONNX model":** you imported a `.pth`. Export to ONNX first.
* **Converted voice is silent or noisy:** the voice model and content encoder dimensions don't match (v1 = 256, v2 = 768), or the sample rate is set wrong. Check **Test load** and the input names.
* **Poor separation:** the built-in method is DSP and needs a stereo mix with a centered lead vocal. Use stems from a dedicated separator.
* **MP3 sample rate shows 44100/48000:** the browser decoder resamples to the device rate.
* **Export on iPhone:** the share sheet opens. Choose **Save to Files**.
* **Data lost?** Projects autosave to IndexedDB. Safari can evict storage for sites that haven't been visited for weeks unless the app is installed to the Home Screen. Back up with `.zmfproj` "With audio".
