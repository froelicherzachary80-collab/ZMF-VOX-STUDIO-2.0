# Models & licensing

ZMF ships **no model weights and no voices**. You import models yourself and confirm you have the right to use them.

| Component | Expected format | Typical source | License notes |
|---|---|---|---|
| RVC voice | ONNX export of an RVC v1/v2 generator. Inputs `phone, phone_lengths, pitch, pitchf, ds, rnd`, output audio | RVC WebUI "Export Onnx" | RVC code is MIT. **The voice is the speaker's.** Only use your own voice or a voice whose owner consents. |
| Content encoder | ContentVec / HuBERT-base ONNX, `[1,1,N]` @16 kHz → `[1,T,768|256]` | ContentVec (MIT), HuBERT (MIT, fairseq) | Check the license of the specific ONNX conversion you use |
| F0 | Built-in YIN (no model) | — | — |
| Runtime | onnxruntime-web 1.20 | Microsoft | MIT |
| MP3 encoder | @breezystack/lamejs (LAME port) | — | LGPL-3.0, loaded as a separate dynamically imported chunk |
| UI | React 18 | Meta | MIT |

RMVPE (a better F0 extractor) and Demucs/HTDemucs (neural separation) are possible next adapters. Neither has been integrated, because neither has been verified to fit iPhone Safari's memory and operator support.

No celebrity or third-party voices are distributed. Every singer profile records a permission confirmation, and the "label synthetic content" flag is on by default.

`scripts/make-test-models.py` builds tiny **test fixtures** that match the RVC interface. They produce a sine wave that follows `pitchf`. They are not voices and exist only so CI can test the inference plumbing.
