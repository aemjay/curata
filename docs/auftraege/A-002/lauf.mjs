// A-002: ein Diagnoselauf je Bibliothek (Schritte 1–6 des Auftrags), Default-Einstellungen, keine Overrides.
// Aufruf: PW_PATH=<…>/node_modules/playwright/index.mjs node docs/auftraege/A-002/lauf.mjs <name> <ordner> [privatDir]
//  - repo-taugliche Artefakte (ohne Bilder) → docs/auftraege/A-002/<name>/
//  - Screenshots mit Fotos (Review) → <privatDir>/<name>/  (Default D:/Claude/Curata-Diagnose/_privat)
import { mkdirSync, appendFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const { chromium } = await import(process.env.PW_PATH ? new URL('file:///' + process.env.PW_PATH.replace(/\\/g, '/')).href : 'playwright');
const [name, folder, privRoot = 'D:/Claude/Curata-Diagnose/_privat'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!name || !folder) { console.error('usage: lauf.mjs <name> <ordner> [privatDir]'); process.exit(2); }
const url = process.env.APP_URL || 'http://localhost:8000/';
const outDir = join(dirname(fileURLToPath(import.meta.url)), name);
const privDir = join(privRoot, name);
mkdirSync(outDir, { recursive: true });
mkdirSync(privDir, { recursive: true });
const logFile = join(outDir, `lauf-${name}.log`);
const log = (msg) => { const line = `${new Date().toISOString()} ${msg}`; appendFileSync(logFile, line + '\n'); console.log(line); };
const expected = readdirSync(folder).filter(f => /\.(jpe?g|png|webp|heic|heif)$/i.test(f)).length;

const ctx = await chromium.launchPersistentContext(resolve(privRoot, '..', '_profil'), {
  channel: process.env.PW_CHANNEL || 'chrome',
  headless: true,
  acceptDownloads: true,
  viewport: { width: 1400, height: 900 },
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] || await ctx.newPage();
const konsole = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') konsole.push(`${new Date().toISOString()} [${m.type()}] ${m.text()}`); });
page.on('pageerror', e => konsole.push(`${new Date().toISOString()} [pageerror] ${e.message}`));
page.on('crash', () => log('PAGE-CRASH (Renderer abgestürzt)'));
page.on('close', () => log('Seite geschlossen'));
ctx.on('close', () => log('Browser-Kontext geschlossen'));
const saveKonsole = () => writeFileSync(join(outDir, 'konsole.txt'), konsole.length ? konsole.join('\n') + '\n' : 'keine Fehler/Warnungen\n');
const navActive = () => page.evaluate(() => document.querySelector('.nav-step-btn[aria-current="step"] .step-label')?.textContent?.trim() || null);
const chips = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.start-stat-chip')].map(c => [c.querySelector('.start-stat-label')?.textContent.trim(), c.querySelector('.start-stat-value')?.textContent.trim()])));

const resume = process.argv.includes('--resume');
try {
  if (resume) {
    // Fortsetzung nach Abbruch: Zustand aus IndexedDB, kein Clear/Upload.
    log(`Fortsetzung ${name}`);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(5000);
    if ((await navActive()) === 'Laden') throw new Error('Fortsetzung nicht möglich: App steht auf „Laden"');
  } else {
  log(`Start ${name}: ${folder} (${expected} Bilddateien)`);
  // 1) Sauberer Zustand
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  if ((await navActive()) !== 'Laden') await page.click('.nav-step-btn >> text=Laden').catch(() => {});
  const clearBtn = page.locator('button.privacy-clear-trigger');
  if (await clearBtn.isEnabled()) {
    await clearBtn.click();
    await page.click('.privacy-clear-confirm button.btn-danger');
    await page.waitForSelector('text=Alle lokalen Daten gelöscht.', { timeout: 60000 });
  }
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  log(`Nach Privacy-Clear: ${JSON.stringify(await chips())}`);

  // 2) Fotos hinzufügen (Ordner-Upload)
  await page.setInputFiles('input[webkitdirectory]', resolve(folder));
  await page.waitForFunction((n) => {
    const v = [...document.querySelectorAll('.start-stat-chip')].find(c => /FOTOS/i.test(c.textContent))?.querySelector('.start-stat-value')?.textContent.trim();
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Weiter zur Verarbeitung'));
    return Number(v) === n && btn && !btn.disabled;
  }, expected, { timeout: 20 * 60000, polling: 2000 });
  const c = await chips();
  log(`Geladen: ${JSON.stringify(c)}`);
  writeFileSync(join(outDir, 'chips.json'), JSON.stringify(c, null, 2));
  // 3) Einstellungen unverändert; Screenshot ohne Fotos (Startbildschirm zeigt keine Thumbnails)
  await page.screenshot({ path: join(outDir, `start-${name}.png`), fullPage: true });

  await page.click('button:has-text("Weiter zur Verarbeitung")');
  }

  // 4) Verarbeitung
  const t0 = Date.now();
  const deadline = t0 + 3 * 3600 * 1000;
  let last = '';
  while (true) {
    const st = await page.evaluate(() => ({
      nav: document.querySelector('.nav-step-btn[aria-current="step"] .step-label')?.textContent?.trim(),
      pct: document.querySelector('.progress-fill')?.style.width || null,
      stages: [...document.querySelectorAll('.stage-item')].map(s => `${s.querySelector('.stage-name')?.textContent.trim()}=${s.querySelector('.stage-status')?.textContent.trim()}`),
      error: [...document.querySelectorAll('.stage-item.error .stage-detail')].map(e => e.textContent.trim()).join(' | ') || null,
    }));
    const line = `nav=${st.nav} gesamt=${st.pct} | ${st.stages.join(' ; ')}`;
    if (line !== last) { log(line); last = line; }
    if (st.nav === 'Review') break;
    const openReview = page.locator('button', { hasText: 'Review öffnen' });
    if (await openReview.count() && await openReview.first().isEnabled()) {
      log(`Pipeline fertig nach ${((Date.now() - t0) / 60000).toFixed(1)} min → „Review öffnen"`);
      await openReview.first().click();
      await page.waitForTimeout(3000);
      continue;
    }
    if (st.error) throw new Error('Stufenfehler: ' + st.error);
    if (Date.now() > deadline) throw new Error('Timeout 3 h');
    await page.waitForTimeout(st.nav === 'Verarbeitung' ? 60000 : 5000);
  }
  log(`Review erreicht nach ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await page.waitForTimeout(5000);

  // 5) Review-Screenshots (enthalten Fotos → privat)
  await page.screenshot({ path: join(privDir, `review-${name}.png`), fullPage: true });
  const allBtn = page.locator('button', { hasText: 'Alle Verwürfe' }).first();
  if (await allBtn.count()) {
    await allBtn.click();
    await page.waitForTimeout(3000);
    const chapters = page.locator('section.review-chapter');
    const n = await chapters.count();
    for (let i = 0; i < n; i++) await chapters.nth(i).screenshot({ path: join(privDir, `review-${name}-kapitel${String(i + 1).padStart(2, '0')}-alle.png`) }).catch(e => log(`Kapitel ${i + 1} Screenshot: ${e.message}`));
    log(`Kapitel-Screenshots (Alle Verwürfe): ${n}`);
    // Ansicht zurück auf Default „Knapp“ (reiner UI-Zustand, keine Overrides)
    await page.locator('button', { hasText: 'Knapp' }).first().click().catch(() => {});
  }

  // 6) Export: nur JSON
  await page.click('.nav-step-btn >> text=Export');
  await page.waitForSelector('text=Diagnose exportieren', { timeout: 30000 });
  for (const [label, file] of [['selection.json', 'selection.json'], ['diagnose.json', 'diagnose.json']]) {
    const card = page.locator('.card', { has: page.locator(`text="${label}"`) });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), card.locator('button').click()]);
    await dl.saveAs(join(outDir, file));
    log(`Export gesichert: ${file}`);
  }
  log('FERTIG');
} catch (e) {
  log(`FEHLER: ${e.message}`);
  await page.screenshot({ path: join(privDir, `fehler-${name}.png`), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  saveKonsole();
  await ctx.close();
}
