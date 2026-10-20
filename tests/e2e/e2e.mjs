// End-to-end acceptance test in headless Chromium against the production build.
// Usage: npm run build && node tests/e2e/e2e.mjs
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { Mp3Encoder } from '@breezystack/lamejs';

const FIX = 'tests/fixtures', OUT = 'tests/e2e/out';
mkdirSync(OUT, { recursive: true });
if (!existsSync(`${FIX}/rmvpe.onnx`)) execSync(`python3 scripts/make-test-models.py ${FIX}`, { stdio: 'inherit' });

// --- Fixture audio (generated here => no third-party rights issues) ---
const sr = 44100, sec = 12, n = sr * sec;
const L = new Float32Array(n), R = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const t = i / sr, note = [220, 247, 262, 294][Math.floor(t / 1.5) % 4];
  const vib = 1 + 0.005 * Math.sin(2 * Math.PI * 5.5 * t);
  let v = 0; for (let k = 1; k <= 6; k++) v += Math.sin(2 * Math.PI * note * vib * k * t) / k; // harmonic "voice", centre
  const gate = (t % 1.5) < 1.3 ? 1 : 0;
  const side = 0.15 * Math.sin(2 * Math.PI * 110 * t) * Math.sign(Math.sin(2 * Math.PI * 2 * t)); // "instrument", anti-phase
  L[i] = 0.25 * v * gate + side; R[i] = 0.25 * v * gate - side;
}
function wav(chs) {
  const len = chs[0].length, b = Buffer.alloc(44 + len * chs.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + len * chs.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(chs.length, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * chs.length * 2, 28); b.writeUInt16LE(chs.length * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(len * chs.length * 2, 40);
  let o = 44; for (let i = 0; i < len; i++) for (const c of chs) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i])) * 32767), o); o += 2; }
  return b;
}
writeFileSync(`${FIX}/song.wav`, wav([L, R]));
const i16 = (f) => Int16Array.from(f, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767));
const enc = new Mp3Encoder(2, sr, 128); const parts = [Buffer.from(enc.encodeBuffer(i16(L), i16(R))), Buffer.from(enc.flush())];
writeFileSync(`${FIX}/song.mp3`, Buffer.concat(parts));

// --- Serve dist ---
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => { server.stdout.on('data', (d) => String(d).includes('4173') && r()); setTimeout(r, 6000); });
const BASE = 'http://localhost:4173/';

const results = []; const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const requests = []; page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'x' : undefined));

try {
  await page.goto(BASE + '#cover'); await page.waitForSelector('text=AI Cover Studio');
  // 1. MP3 import
  await page.setInputFiles('input[type=file] >> nth=0', `${FIX}/song.mp3`);
  await page.waitForSelector('text=Est. BPM', { timeout: 30000 });
  const lenTxt = await page.locator('.stat:has-text("Length") b').innerText();
  check('Import real MP3', /0:1[12]/.test(lenTxt), `length ${lenTxt}`);
  // 2. WAV import
  await page.setInputFiles('input[type=file] >> nth=0', `${FIX}/song.wav`);
  await page.waitForFunction(() => document.body.innerText.includes('44100 Hz'));
  const stats = await page.locator('.stats').first().innerText();
  check('Import real WAV + stats', stats.includes('44100') && stats.includes('0:12'), stats.replace(/\n/g, ' '));
  // 4. Waveform drawn from samples (non-empty canvas)
  const painted = await page.evaluate(() => { const c = document.querySelector('canvas.wave'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n / (d.length / 4); });
  check('Waveform rendered', painted > 0.05, `${(painted * 100).toFixed(1)}% pixels painted`);
  // 3. Playback
  await page.click('button:has-text("▶ Play") >> nth=0'); await page.waitForTimeout(800);
  const pos = await page.locator('.transport small').first().innerText();
  check('Playback runs', /0:00\.[1-9]|0:0[1-9]/.test(pos), pos);
  await page.click('.transport button');
  // 5. Separation
  await page.click('button:has-text("Run DSP separation")');
  await page.waitForSelector('text=Instrumental stem', { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => document.body.innerText.includes('Vocal stem') && !document.body.innerText.includes('Separating'), null, { timeout: 60000 });
  const [d1] = await Promise.all([page.waitForEvent('download'), page.click('p:has-text("Vocal stem") button:has-text("WAV")')]);
  await d1.saveAs(`${OUT}/vocal.wav`);
  const [d2] = await Promise.all([page.waitForEvent('download'), page.click('p:has-text("Instrumental") button:has-text("WAV")')]);
  await d2.saveAs(`${OUT}/inst.wav`);
  const rms = (f) => { const b = readFileSync(f); let s = 0, c = 0; for (let o = 44; o + 1 < b.length; o += 2) { const v = b.readInt16LE(o) / 32768; s += v * v; c++; } return Math.sqrt(s / c); };
  const corr = (fa, fb) => { const a = readFileSync(fa), b = readFileSync(fb); let s = 0, ea = 0, eb = 0; for (let o = 44; o + 1 < Math.min(a.length, b.length); o += 4) { const x = a.readInt16LE(o), y = b.readInt16LE(o); s += x * y; ea += x * x; eb += y * y; } return s / Math.sqrt(ea * eb); };
  const rv = rms(`${OUT}/vocal.wav`), ri = rms(`${OUT}/inst.wav`), cvi = corr(`${OUT}/vocal.wav`, `${OUT}/inst.wav`);
  check('Separation outputs audible, different stems', rv > 0.02 && ri > 0.02 && Math.abs(cvi) < 0.5, `rms vocal ${rv.toFixed(3)}, inst ${ri.toFixed(3)}, corr ${cvi.toFixed(2)}`);

  // 6. Load model fixtures
  await page.goto(BASE + '#models'); await page.waitForSelector('text=Installed models');
  await page.check('text=I have the right to use this model');
  await page.selectOption('select >> nth=0', 'content-encoder');
  await page.setInputFiles('input[accept=".onnx"]', `${FIX}/content.onnx`); await page.waitForSelector('td:has-text("content.onnx")');
  await page.selectOption('select >> nth=0', 'rvc-voice');
  await page.setInputFiles('input[accept=".onnx"]', `${FIX}/voice.onnx`); await page.waitForSelector('td:has-text("voice.onnx")');
  await page.click('tr:has-text("voice.onnx") button:has-text("Test load")');
  await page.waitForSelector('text=✓ Loaded on', { timeout: 60000 });
  check('Load ONNX model in ONNX Runtime Web', true, await page.locator('small:has-text("Loaded on")').innerText());
  await page.click('tr:has-text("voice.onnx") button:has-text("Verify")'); await page.waitForSelector('text=integrity OK');
  check('Model integrity verify', true);
  await page.selectOption('select >> nth=0', 'f0-rmvpe');
  await page.setInputFiles('input[accept=".onnx"]', `${FIX}/rmvpe.onnx`); await page.waitForSelector('td:has-text("rmvpe.onnx")');

  // Singer
  await page.goto(BASE + '#lab'); await page.waitForSelector('text=Voice Clone Laboratory');
  await page.setInputFiles('input[type=file][multiple]', `${FIX}/song.wav`); await page.waitForSelector('text=song.wav');
  await page.click('button:has-text("Analyse voice")'); await page.waitForSelector('text=Median F0');
  await page.fill('label:has-text("Name") input', 'Test Fixture Singer');
  const sels = page.locator('label:has-text("RVC voice model") select');
  await sels.selectOption({ label: /voice\.onnx/ }).catch(async () => { const v = await sels.locator('option').nth(1).getAttribute('value'); await sels.selectOption(v); });
  const enc2 = page.locator('label:has-text("Content encoder") select'); const ev = await enc2.locator('option').nth(1).getAttribute('value'); await enc2.selectOption(ev);
  await page.check('text=I own this voice'); await page.click('button:has-text("Save singer")');
  await page.waitForSelector('text=neural RVC singer');
  check('Create singer linked to neural model', true);

  // Voice-clone upgrades
  await page.goto(BASE + '#singers'); await page.click('button:has-text("Edit / upgrade")');
  await page.waitForSelector('text=Voice clone upgrades');
  await page.waitForSelector('text=1 samples');
  const qtxt = await page.locator('details').first().innerText().catch(() => '');
  check('Recording quality check', /good|check|issues/.test(qtxt), qtxt.split('\n')[0]);
  await page.click('button:has-text("Build from samples")');
  await page.waitForSelector('text=/index: \\d+ × 768/', { timeout: 120000 });
  check('Build feature index from singer samples', true, await page.locator('span:has-text("index:")').first().innerText());
  await page.selectOption('label:has-text("RMVPE model") select', { index: 1 });
  await page.click('button:has-text("Compute fingerprint"), button:has-text("Recompute fingerprint")');
  const [dz] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('button:has-text("Export dataset .zip")')]);
  await dz.saveAs(`${OUT}/dataset.zip`);
  let zl = ''; try { zl = execSync(`python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(len(z.namelist()))" ${OUT}/dataset.zip`).toString().trim(); } catch (e) { zl = 'invalid: ' + e.message; }
  check('Export RVC training dataset zip', /^\d+$/.test(zl) && +zl >= 2, `${zl} files`);
  await page.click('button:has-text("Save singer")'); await page.waitForSelector('text=RMVPE');

  // 7-9. Convert
  await page.goto(BASE + '#cover'); await page.waitForSelector('text=Select AI voice');
  const sSel = page.locator('.card:has-text("Select AI voice") select'); const sv = await sSel.locator('option').nth(1).getAttribute('value'); await sSel.selectOption(sv);
  await page.selectOption('.card:has-text("Select AI voice") select', sv);
  await page.click('button:has-text("Preview")');
  await page.waitForSelector('text=Converted', { timeout: 120000 });
  const note = await page.locator('.notice.ok').first().innerText();
  const lsd = parseFloat(/distance from source ([\d.]+)/.exec(note)?.[1] ?? '0');
  check('Neural pipeline converts phrase (fixture model)', lsd > 3, note);
  const feats = await page.locator('p:has-text("F0:")').innerText();
  check('Upgrades active in conversion (RMVPE + index)', /RMVPE/.test(feats) && /vectors @/.test(feats), feats);
  const mt = await page.locator('.notice:has-text("Timbre match")').innerText().catch(() => '');
  check('Timbre match score reported', /source [\d.\-]+ → converted [\d.\-]+/.test(mt), mt.slice(0, 160));
  check('Measured timbre change', lsd > 3, `log-spectral distance ${lsd} dB`);
  // The RMVPE fixture has random weights (plumbing only), so check melody with the YIN extractor.
  await page.selectOption('label:has-text("Pitch extractor") select', 'yin');
  await page.click('button:has-text("Preview")');
  await page.waitForFunction(() => /F0: YIN/.test(document.body.innerText), null, { timeout: 120000 });
  const note2 = await page.locator('.notice.ok').first().innerText();
  const pc2 = parseFloat(/correlation ([\-\d.]+)/.exec(note2)?.[1] ?? 'NaN');
  check('Melody preserved (YIN F0 + index retrieval)', pc2 > 0.8, `log-F0 correlation ${pc2}`);
  await page.click('button:has-text("Render full vocal")');
  await page.waitForSelector('text=Full converted vocal in project', { timeout: 180000 });
  check('Full-length conversion', true);

  // 10-11 mix + DSP effect + 12/13 export
  await page.goto(BASE + '#master'); await page.click('button:has-text("Render & measure")');
  await page.waitForFunction(() => /LUFS/.test(document.querySelector('table')?.innerText ?? '') && !document.body.innerText.includes('Rendering'), null, { timeout: 120000 });
  check('Mastering meters from samples', true, (await page.locator('table').innerText()).replace(/\s+/g, ' '));
  await page.goto(BASE + '#export');
  const [w] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('button:has-text("Mix WAV")')]);
  await w.saveAs(`${OUT}/mix.wav`);
  const wb = readFileSync(`${OUT}/mix.wav`);
  check('Export readable WAV', wb.toString('ascii', 0, 4) === 'RIFF' && wb.length > sr * 4 * 10 && rms(`${OUT}/mix.wav`) > 0.01, `${wb.length} bytes, ICMT label ${wb.includes('AI-generated') ? 'present' : 'absent'}`);
  const [m] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('button:has-text("Mix MP3")')]);
  await m.saveAs(`${OUT}/mix.mp3`);
  const mb = readFileSync(`${OUT}/mix.mp3`); let sync = -1; for (let i = 0; i < mb.length - 1; i++) if (mb[i] === 0xff && (mb[i + 1] & 0xe0) === 0xe0) { sync = i; break; }
  let ffOk = 'ffprobe n/a'; try { ffOk = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${OUT}/mix.mp3`).toString().trim(); } catch { /* */ }
  check('Export readable MP3', sync >= 0 && mb.length > 50000, `${mb.length} bytes, duration ${ffOk}`);

  // 14 save & reopen
  await page.waitForTimeout(1200);
  await page.reload(); await page.goto(BASE + '#library'); await page.waitForSelector('text=Project Library');
  const lib = await page.locator('table').innerText();
  check('Save and reopen project', /song/.test(lib), lib.split('\n').slice(1, 3).join(' | '));
  await page.goto(BASE + '#mixer'); await page.waitForSelector('.channel');
  check('Project tracks restored after reload', (await page.locator('.channel').count()) >= 4, `${await page.locator('.channel').count()} channels`);

  // 15 offline
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload(); await page.goto(BASE + '#mixer');
  const offlineOk = await page.waitForSelector('.channel', { timeout: 15000 }).then(() => true).catch(() => false);
  check('Reopen offline with cached assets', offlineOk);
  await ctx.setOffline(false);

  // 16 network
  const foreign = requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  const posts = requests.filter((r) => r.method !== 'GET');
  check('No audio upload / external requests', !foreign.length && !posts.length, `${requests.length} requests, ${foreign.length} external, ${posts.length} non-GET`);
} catch (e) { check('E2E run', false, e.message); await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }); }
finally { await browser.close(); server.kill(); }
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
