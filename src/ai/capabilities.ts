export interface Capabilities {
  webgpu: boolean; gpuAdapter: string | null; gpuFeatures: string[]; maxBufferMB: number | null;
  wasm: boolean; wasmSimd: boolean; wasmThreads: boolean; crossOriginIsolated: boolean;
  audioWorklet: boolean; offlineAudio: boolean; opfs: boolean; indexedDB: boolean; serviceWorker: boolean;
  deviceMemoryGB: number | null; cores: number; storageQuotaMB: number | null; storageUsedMB: number | null;
  userAgent: string; isIOS: boolean; recommendedMode: 'LIGHT' | 'BALANCED' | 'HIGH';
}

const simdProbe = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export async function detectCapabilities(): Promise<Capabilities> {
  let gpuAdapter: string | null = null, gpuFeatures: string[] = [], maxBufferMB: number | null = null, webgpu = false;
  try {
    const gpu = (navigator as any).gpu;
    if (gpu) {
      const ad = await gpu.requestAdapter();
      if (ad) {
        webgpu = true;
        const info = ad.info ?? (await ad.requestAdapterInfo?.());
        gpuAdapter = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'WebGPU adapter';
        gpuFeatures = [...ad.features];
        maxBufferMB = Math.round(ad.limits.maxBufferSize / 1048576);
      }
    }
  } catch { webgpu = false; }
  const wasm = typeof WebAssembly === 'object';
  let wasmSimd = false;
  try { wasmSimd = wasm && WebAssembly.validate(simdProbe); } catch { /* */ }
  let storageQuotaMB: number | null = null, storageUsedMB: number | null = null;
  try { const e = await navigator.storage?.estimate(); if (e) { storageQuotaMB = Math.round((e.quota ?? 0) / 1048576); storageUsedMB = Math.round((e.usage ?? 0) / 1048576); } } catch { /* */ }
  let opfs = false; try { await navigator.storage.getDirectory(); opfs = true; } catch { /* */ }
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const mem = (navigator as any).deviceMemory ?? null;
  const recommendedMode = isIOS ? (webgpu ? 'BALANCED' : 'LIGHT') : mem && mem < 4 ? 'LIGHT' : webgpu ? 'HIGH' : 'BALANCED';
  return {
    webgpu, gpuAdapter, gpuFeatures, maxBufferMB, wasm, wasmSimd,
    wasmThreads: typeof SharedArrayBuffer !== 'undefined' && (globalThis as any).crossOriginIsolated === true,
    crossOriginIsolated: (globalThis as any).crossOriginIsolated === true,
    audioWorklet: typeof AudioWorkletNode !== 'undefined', offlineAudio: typeof OfflineAudioContext !== 'undefined',
    opfs, indexedDB: typeof indexedDB !== 'undefined', serviceWorker: 'serviceWorker' in navigator,
    deviceMemoryGB: mem, cores: navigator.hardwareConcurrency || 1, storageQuotaMB, storageUsedMB,
    userAgent: ua, isIOS, recommendedMode,
  };
}

export const QUALITY = {
  LIGHT: { chunkSeconds: 6, crossfadeSeconds: 0.25, maxLoadedModels: 1, backend: 'wasm' as const, previewSeconds: 10 },
  BALANCED: { chunkSeconds: 12, crossfadeSeconds: 0.35, maxLoadedModels: 1, backend: 'webgpu' as const, previewSeconds: 15 },
  HIGH: { chunkSeconds: 20, crossfadeSeconds: 0.5, maxLoadedModels: 2, backend: 'webgpu' as const, previewSeconds: 20 },
};
export type QualityMode = keyof typeof QUALITY | 'CUSTOM';
