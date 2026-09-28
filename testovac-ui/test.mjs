// ===== Vinčák – Testovač UI =====
// Proklikne stránku v headless Chromiu na mobilu i počítači a zapíše vysledek/vysledek.json + snímky.
// Vstupy (proměnné prostředí): CIL_URL (plná adresa stránky), IDENT (označení běhu).
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const URL_CIL = process.env.CIL_URL;
const OUT = 'vysledek';
fs.mkdirSync(OUT, { recursive: true });

const ZARIZENI = [
  { klic: 'mobil', nazev: 'Mobil (iPhone 13)', ctx: { ...devices['iPhone 13'] } },
  { klic: 'pocitac', nazev: 'Počítač 1366×800', ctx: { viewport: { width: 1366, height: 800 } } },
];

const vysledek = { url: URL_CIL, ident: process.env.IDENT || '', cas: new Date().toISOString(), zarizeni: [], chyby: [], varovani: [] };

const browser = await chromium.launch();
try {
  for (const z of ZARIZENI) {
    const ctx = await browser.newContext({ ...z.ctx, locale: 'cs-CZ' });
    const page = await ctx.newPage();
    const r = { klic: z.klic, nazev: z.nazev, js_chyby: [], konzole: [], nenactene: [], pristupnost: [], preteceni: false, tlacitek: 0, prokliknuto: 0, cas_ms: 0, http: 0 };
    page.on('pageerror', e => r.js_chyby.push(String(e.message || e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') r.konzole.push(m.text().slice(0, 200)); });
    page.on('requestfailed', q => r.nenactene.push((q.failure()?.errorText || 'chyba') + ' ' + q.url().slice(0, 120)));
    page.on('response', s => { if (s.status() >= 400) r.nenactene.push(s.status() + ' ' + s.url().slice(0, 120)); });
    const t0 = Date.now();
    try {
      const resp = await page.goto(URL_CIL, { waitUntil: 'networkidle', timeout: 45000 });
      r.http = resp ? resp.status() : 0;
    } catch (e) { r.js_chyby.push('Stránka se nenačetla: ' + String(e.message).slice(0, 150)); }
    r.cas_ms = Date.now() - t0;
    await page.waitForTimeout(800);

    // přetečení do strany (mobil)
    r.preteceni = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2).catch(() => false);
    r.text_znaku = await page.evaluate(() => (document.body?.innerText || '').trim().length).catch(() => 0);
    r.titulek = await page.title().catch(() => '');

    // snímek (před proklikáním)
    await page.screenshot({ path: `${OUT}/${z.klic}.png`, fullPage: false }).catch(() => {});

    // přístupnost (axe-core, WCAG 2 A/AA)
    try {
      await page.addScriptTag({ content: AXE });
      const ax = await page.evaluate(async () => {
        const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] });
        return res.violations.map(v => ({ id: v.id, dopad: v.impact, popis: v.help, prvku: v.nodes.length }));
      });
      r.pristupnost = ax;
    } catch (e) { r.pristupnost = [{ id: 'axe-nespusten', dopad: 'minor', popis: String(e.message).slice(0, 100), prvku: 0 }]; }

    // proklikání tlačítek (max 12, bez odesílání formulářů a odkazů pryč)
    try {
      const tl = page.locator('button:visible, [role="button"]:visible, input[type="button"]:visible');
      r.tlacitek = await tl.count();
      for (let i = 0; i < Math.min(r.tlacitek, 12); i++) {
        const b = tl.nth(i);
        const typ = (await b.getAttribute('type').catch(() => '')) || '';
        if (typ.toLowerCase() === 'submit') continue;
        const pred = page.url();
        await b.click({ timeout: 2000, trial: false }).then(() => r.prokliknuto++).catch(() => {});
        await page.waitForTimeout(250);
        if (page.url() !== pred) { await page.goBack({ timeout: 10000 }).catch(() => {}); }
      }
    } catch (e) {}
    if (z.klic === 'mobil') await page.screenshot({ path: `${OUT}/mobil-po-proklikani.png`, fullPage: false }).catch(() => {});

    vysledek.zarizeni.push(r);
    await ctx.close();
  }
} finally {
  await browser.close();
}

// Verdikt
const uniq = a => [...new Set(a)];
for (const r of vysledek.zarizeni) {
  if (r.http >= 400 || r.http === 0) vysledek.chyby.push(`${r.nazev}: stránka vrátila ${r.http || 'nic'}`);
  for (const e of uniq(r.js_chyby)) vysledek.chyby.push(`${r.nazev}: chyba JavaScriptu – ${e}`);
  for (const e of uniq(r.konzole).slice(0, 5)) vysledek.varovani.push(`${r.nazev}: konzole – ${e}`);
  for (const e of uniq(r.nenactene).slice(0, 5)) vysledek.varovani.push(`${r.nazev}: nenačteno – ${e}`);
  if (r.preteceni) vysledek.varovani.push(`${r.nazev}: stránka přetéká do strany (vodorovné posouvání)`);
  if (r.text_znaku < 20) vysledek.varovani.push(`${r.nazev}: stránka je skoro prázdná (${r.text_znaku} znaků textu)`);
  if (r.cas_ms > 8000) vysledek.varovani.push(`${r.nazev}: pomalé načtení (${(r.cas_ms / 1000).toFixed(1)} s)`);
}
// přístupnost – jen jednou (z mobilu), vážné a kritické jako varování
const mob = vysledek.zarizeni.find(r => r.klic === 'mobil');
if (mob) for (const v of mob.pristupnost.filter(v => v.dopad === 'serious' || v.dopad === 'critical'))
  vysledek.varovani.push(`Přístupnost (${v.dopad === 'critical' ? 'kritické' : 'vážné'}): ${v.popis} – ${v.prvku}×`);
vysledek.verdikt = vysledek.chyby.length ? 'chyby' : vysledek.varovani.length ? 'varovani' : 'ok';
fs.writeFileSync(`${OUT}/vysledek.json`, JSON.stringify(vysledek, null, 2));
console.log(JSON.stringify({ verdikt: vysledek.verdikt, chyby: vysledek.chyby, varovani: vysledek.varovani }, null, 2));
