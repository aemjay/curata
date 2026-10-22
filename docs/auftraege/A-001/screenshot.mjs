// A-001 Schritt 5/6: Startbildschirm-Screenshot, WebGPU-Status, chrome://gpu, Konsolenfehler.
// Aufruf: PW_PATH=<pfad>/node_modules/playwright/index.mjs node docs/auftraege/A-001/screenshot.mjs [headful]
// Playwright liegt bewusst NICHT im Repo (Zero-Build); PW_PATH zeigt auf eine lokale Installation.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { chromium } = await import(process.env.PW_PATH ? new URL('file:///' + process.env.PW_PATH.replace(/\\/g, '/')).href : 'playwright');
const outDir = dirname(fileURLToPath(import.meta.url));
const headful = process.argv.includes('headful');
const url = process.env.APP_URL || 'http://localhost:8000/';

// Standard: installiertes Google Chrome (channel 'chrome'), neuer Headless-Modus (nicht headless-shell), GPU bleibt aktiv.
// Playwrights Chromium 131 startet auf Windows Build 26300 nicht („Side-by-Side-Konfiguration ungültig").
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || 'chrome',
  headless: !headful,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const konsole = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') konsole.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => konsole.push(`[pageerror] ${e.message}`));
page.on('requestfailed', r => konsole.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(5000);
await page.screenshot({ path: join(outDir, 'start.png'), fullPage: true });

const diag = await page.evaluate(async () => {
  const chips = [...document.querySelectorAll('.start-stat-chip')].map(c => c.innerText.replace(/\s+/g, ' ').trim());
  let adapter = null;
  if (navigator.gpu) {
    try {
      const a = await navigator.gpu.requestAdapter();
      adapter = a ? { info: a.info ? { vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description } : null, fallback: a.isFallbackAdapter ?? null } : 'kein Adapter';
    } catch (e) { adapter = 'Fehler: ' + e.message; }
  }
  return { userAgent: navigator.userAgent, hasNavigatorGpu: !!navigator.gpu, adapter, chips };
});

const gpuPage = await browser.newPage();
await gpuPage.goto('chrome://gpu');
await gpuPage.waitForTimeout(2000);
const gpuText = await gpuPage.evaluate(() => {
  // chrome://gpu rendert in Shadow-DOM; innerText über alle Shadow-Roots einsammeln.
  const collect = n => (n.shadowRoot ? collect(n.shadowRoot) : '') + [...n.children].map(collect).join('') + (n.children.length === 0 && n.textContent ? n.textContent + '\n' : '');
  return collect(document.body);
});

await browser.close();

const mode = headful ? 'headful' : 'headless-new';
// Nur WebGPU-relevante Zeilen behalten (Rohdump enthält lokale Pfade/Profilverzeichnisse).
const lines = gpuText.split('\n').map(s => s.trim()).filter(s => s && s !== '*');
const featureIdx = lines.indexOf('WebGPU:');
const adapters = [];
lines.forEach((l, i) => { if (/^<.*> .* backend - /.test(l)) adapters.push({ adapter: l, status: lines[lines.indexOf('[WebGPU Status]', i) + 2] }); });
const gpuSummary = [`Graphics Feature Status — WebGPU: ${lines[featureIdx + 1]}`, '', 'Dawn-Adapter → [WebGPU Status]:', ...adapters.map(a => `- ${a.adapter}: ${a.status}`)].join('\n');
writeFileSync(join(outDir, `gpu-${mode}.txt`), gpuSummary + '\n');
writeFileSync(join(outDir, `diag-${mode}.json`), JSON.stringify({ mode, ...diag }, null, 2));
writeFileSync(join(outDir, 'konsole.txt'), konsole.length ? konsole.join('\n') + '\n' : 'keine Fehler/Warnungen\n');
console.log(JSON.stringify({ mode, ...diag, konsoleEintraege: konsole.length }, null, 2));
