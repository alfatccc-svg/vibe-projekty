import { primarniAnalyza, oponentura, shrnuti, zkrat } from './analyza.js';
import { uloz, nacti, vse, podlePorady, smazVse, ulozAudioKus, audioPorady, sha256, audit,
  overRetezAuditu, nastaveni, nastav } from './uloziste.js';

// ---------- pomocné ----------
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...deti) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const d of deti.flat()) if (d !== null && d !== undefined && d !== false) e.append(d instanceof Node ? d : String(d));
  return e;
};
const cas = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const id = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function toast(t, ms = 3500) { const x = $('#toast'); x.textContent = t; x.classList.add('vidět'); clearTimeout(toast.t); toast.t = setTimeout(() => x.classList.remove('vidět'), ms); }
function stahni(nazev, obsah, typ) {
  const a = el('a', { href: URL.createObjectURL(new Blob([obsah], { type: typ })), download: nazev });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const TYPY = { rozhodnuti: 'Rozhodnutí', ukol: 'Úkol', otazka: 'Otevřená otázka', riziko: 'Riziko' };
const STAVY = { overeno: 'Ověřeno', castecne: 'Částečně doloženo', nepodlozeno: 'Nepodloženo' };

// ---------- stav ----------
const stav = { secure: false, model: 'onnx-community/whisper-base', automatizace: 'standard',
  porada: null, zaznam: null, typ: 'rozhodnuti' };

// ---------- navigace ----------
const historie = [];
function ukaz(view, nadpis, pridatDoHistorie = true) {
  const aktualni = document.querySelector('[data-view]:not([hidden])');
  if (pridatDoHistorie && aktualni && aktualni.dataset.view !== view && aktualni.dataset.view !== 'zpracovani' && aktualni.dataset.view !== 'zaznam')
    historie.push([aktualni.dataset.view, $('#nadpis').textContent]);
  if (view === 'zpracovani' || view === 'zaznam') { historie.length = 0; historie.push(['domu', 'Asistent porad']); }
  document.querySelectorAll('[data-view]').forEach(s => { s.hidden = s.dataset.view !== view; });
  $('#nadpis').textContent = nadpis || 'Asistent porad';
  $('#zpet').hidden = view === 'domu' || view === 'zaznam' || view === 'zpracovani';
  window.scrollTo(0, 0);
  if (view === 'domu') { historie.length = 0; vykresliDomu(); }
}
$('#zpet').onclick = () => { const [v, n] = historie.pop() || ['domu']; ukaz(v, n, false); };

// ---------- secure režim + stav sítě ----------
async function nastavSecure(zapnuto) {
  stav.secure = zapnuto;
  await nastav('secure', zapnuto);
  navigator.serviceWorker?.controller?.postMessage({ typ: 'secure', zapnuto });
  await audit('uzivatel', zapnuto ? 'secure-zapnut' : 'secure-ukoncen', 'relace');
  vykresliStavSite();
}
function vykresliStavSite() {
  const s = $('#stavSite');
  if (stav.secure) { s.textContent = '🔒 SECURE'; s.className = 'stav secure'; s.title = 'Síť blokována. Klepnutím ukončíte secure režim.'; }
  else if (navigator.onLine) { s.textContent = 'Online'; s.className = 'stav online'; s.title = ''; }
  else { s.textContent = 'Offline'; s.className = 'stav'; s.title = ''; }
}
$('#stavSite').onclick = async () => {
  if (!stav.secure) return;
  if (stav.zaznam) return toast('Nejdřív ukončete poradu.');
  if (confirm('Ukončit secure režim? Aplikace pak smí komunikovat se sítí a outbox půjde uvolnit.')) {
    await nastavSecure(false); toast('Secure režim ukončen.');
    if (stav.porada) vykresliOutbox();
  }
};
addEventListener('online', vykresliStavSite); addEventListener('offline', vykresliStavSite);

// ---------- model (Whisper v zařízení) ----------
let worker = null; const cekajici = new Map();
function zavolejWorker(zprava, naPostup) {
  if (!worker) {
    worker = new Worker('prepis-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      const c = cekajici.get(data.id); if (!c) return;
      if (data.typ === 'stahovani' || data.typ === 'postup') c.naPostup?.(data);
      else { cekajici.delete(data.id); data.typ === 'chyba' ? c.chyba(new Error(data.zprava)) : c.ok(data); }
    };
    worker.onerror = e => { for (const c of cekajici.values()) c.chyba(new Error(e.message || 'Chyba workeru')); cekajici.clear(); worker = null; };
  }
  const zid = id('w');
  return new Promise((ok, chyba) => { cekajici.set(zid, { ok, chyba, naPostup }); worker.postMessage({ ...zprava, id: zid }, zprava.audio ? [zprava.audio.buffer] : []); });
}
async function modelVCache() {
  try {
    const c = await caches.open('transformers-cache');
    const k = await c.keys();
    return k.some(r => r.url.includes(stav.model) && r.url.includes('decoder'));
  } catch { return false; }
}
$('#stahnoutModel').onclick = async () => {
  if (stav.secure) return toast('V secure režimu nelze stahovat. Ukončete jej klepnutím na 🔒.');
  const b = $('#stahnoutModel'); b.disabled = true;
  const soubory = {};
  try {
    await zavolejWorker({ typ: 'priprav', model: stav.model, povolitSit: true }, p => {
      soubory[p.soubor] = [p.hotovo, p.celkem];
      const [h, c] = Object.values(soubory).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
      $('#modelInfo').textContent = `Stahuji model… ${Math.round(h / 1e6)} / ${Math.round(c / 1e6)} MB`;
    });
    await audit('uzivatel', 'model-stazen', stav.model);
    toast('Model je připraven pro offline přepis.');
  } catch (e) { toast('Stažení selhalo: ' + e.message, 6000); }
  b.disabled = false; vykresliPripravenost();
};

async function vykresliPripravenost() {
  const ul = $('#pripravenost'); ul.replaceChildren();
  const polozka = (ok, t) => ul.append(el('li', {}, ok ? '✅ ' : '⚠️ ', t));
  polozka(!!navigator.serviceWorker?.controller, navigator.serviceWorker?.controller ? 'Aplikace funguje bez internetu' : 'Offline režim se připravuje – načtěte stránku ještě jednou');
  const m = await modelVCache();
  polozka(m, m ? 'Model pro přepis je v zařízení' : 'Model pro přepis není stažený (potřeba jednou, na Wi‑Fi)');
  let trvale = false; try { trvale = await navigator.storage?.persisted?.(); } catch {}
  polozka(trvale, trvale ? 'Úložiště je trvalé' : 'Úložiště může prohlížeč při nedostatku místa smazat');
  try { const o = await navigator.storage.estimate(); polozka(true, `Využito ${Math.round(o.usage / 1e6)} MB z ${Math.round(o.quota / 1e6)} MB`); } catch {}
  $('#modelInfo').textContent = 'Model: ' + stav.model.split('/')[1];
  $('#stahnoutModel').hidden = m;
}

// ---------- domů ----------
async function vykresliDomu() {
  vykresliPripravenost();
  const porady = (await vse('porady')).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const s = $('#seznamPorad'); s.replaceChildren();
  if (!porady.length) s.append(el('p', { class: 'prazdne' }, 'Zatím žádné porady.'));
  for (const p of porady) s.append(el('button', { class: 'polozka', onclick: () => otevriReview(p.id) },
    p.nazev, el('small', {}, new Date(p.created_at).toLocaleString('cs-CZ'), ' · ', p.status === 'zpracovano' ? 'zpracováno' : p.status, p.security_mode === 'secure' ? ' · 🔒' : '')));
  const ukoly = (await vse('nalezy')).filter(f => f.type === 'ukol' && f.review !== 'zamitnuto' && !f.splneno);
  const u = $('#otevreneUkoly'); u.replaceChildren();
  if (!ukoly.length) u.append(el('p', { class: 'prazdne' }, 'Žádné otevřené úkoly.'));
  const nazvy = Object.fromEntries(porady.map(p => [p.id, p.nazev]));
  for (const f of ukoly) u.append(el('div', { class: 'outbox-polozka' }, zkrat(f.text, 90),
    el('div', { class: 'mala' }, (f.owner || 'bez vlastníka'), ' · ', (f.deadline || 'bez termínu'), ' · ', nazvy[f.meeting_id] || ''),
    el('button', { class: 'dukaz', onclick: async () => { f.splneno = new Date().toISOString(); await uloz('nalezy', f); await audit('uzivatel', 'ukol-splnen', f.id); vykresliDomu(); } }, 'Označit jako splněný')));
}
$('#hledat').oninput = async e => {
  const q = norm(e.target.value.trim()); const v = $('#vysledkyHledani'); v.replaceChildren();
  if (q.length < 2) return;
  const porady = Object.fromEntries((await vse('porady')).map(p => [p.id, p]));
  const nalezy = (await vse('nalezy')).filter(f => norm(f.text + ' ' + (f.owner || '')).includes(q));
  const seg = (await vse('segmenty')).filter(s => norm(s.text).includes(q));
  for (const f of nalezy.slice(0, 20)) v.append(el('button', { class: 'polozka', onclick: () => otevriReview(f.meeting_id, f.evidence_segment_ids[0]) },
    TYPY[f.type] + ': ' + zkrat(f.text, 90), el('small', {}, porady[f.meeting_id]?.nazev || '', ' · ', new Date(porady[f.meeting_id]?.created_at || 0).toLocaleDateString('cs-CZ'))));
  for (const s of seg.filter(s => !nalezy.some(f => f.evidence_segment_ids.includes(s.id))).slice(0, 10))
    v.append(el('button', { class: 'polozka', onclick: () => otevriReview(s.meeting_id, s.id) }, '„' + zkrat(s.text, 90) + '“', el('small', {}, porady[s.meeting_id]?.nazev || '')));
  if (!v.children.length) v.append(el('p', { class: 'prazdne' }, 'Nic nenalezeno.'));
};

// ---------- příprava + záznam ----------
$('#novaPorada').onclick = () => ukaz('priprava', 'Nová porada');
$('#pSecure').onchange = e => { $('#pSecureRada').hidden = !e.target.checked; };
const ucastniciZ = s => s.split(',').map(x => x.trim()).filter(Boolean).slice(0, 8);

$('#startPorady').onclick = async () => {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return toast('Tento prohlížeč neumí nahrávat zvuk.');
  const ucastnici = ucastniciZ($('#pUcastnici').value);
  const secure = $('#pSecure').checked;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return toast('Bez přístupu k mikrofonu nelze nahrávat. Povolte mikrofon v nastavení prohlížeče.', 6000); }
  try { await navigator.storage?.persist?.(); } catch {}
  if (secure) { await nastavSecure(true); if (navigator.onLine) toast('Síť je blokována aplikací. Pro jistotu zapněte i režim Letadlo.', 6000); }
  const mluvci = (ucastnici.length ? ucastnici : ['Mluvčí 1', 'Mluvčí 2', 'Mluvčí 3', 'Mluvčí 4'])
    .reduce((o, j, i) => (o['s' + (i + 1)] = j, o), {});
  const typ = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const porada = { id: id('m'), nazev: $('#pNazev').value.trim() || 'Porada ' + new Date().toLocaleDateString('cs-CZ'),
    created_at: new Date().toISOString(), started_at: new Date().toISOString(), ended_at: null,
    security_mode: secure ? 'secure' : 'standard', language: $('#pJazyk').value, participants: ucastnici,
    mluvci, zmeny_mluvcich: [], audio_hash: null, audio_type: typ, status: 'nahravani' };
  await uloz('porady', porada);
  await audit('uzivatel', 'porada-zahajena', porada.id);
  const rec = new MediaRecorder(stream, typ ? { mimeType: typ } : {});
  let poradi = 0; const zapisy = [];
  rec.ondataavailable = e => { if (e.data.size) zapisy.push(ulozAudioKus(porada.id, poradi++, e.data).catch(err => toast('Chyba ukládání: ' + err.message))); };
  rec.start(5000); // každých 5 s se kus uloží → pád aplikace nezničí již nahrané
  const ctx = new AudioContext(); const an = ctx.createAnalyser(); ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  let wake = null; try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  const t0 = performance.now();
  stav.zaznam = { rec, stream, ctx, wake, zapisy, porada, t0, aktivni: null };
  const smycka = () => {
    if (!stav.zaznam) return;
    an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128));
    $('#zMeter').style.width = Math.min(100, m / 64 * 100) + '%';
    $('#zCas').textContent = cas(performance.now() - t0);
    requestAnimationFrame(smycka);
  };
  const box = $('#zMluvci'); box.replaceChildren();
  for (const [sid, jm] of Object.entries(mluvci)) box.append(el('button', { 'aria-pressed': 'false', 'data-sid': sid, onclick: () => oznacMluvciho(sid) }, jm));
  $('#zStav').textContent = secure ? '🔒 Secure – nic neopouští zařízení. Nezamykejte obrazovku.' : 'Nahrávám… Nezamykejte obrazovku.';
  ukaz('zaznam', porada.nazev);
  smycka();
};
function oznacMluvciho(sid) {
  const z = stav.zaznam; if (!z) return;
  z.aktivni = sid;
  z.porada.zmeny_mluvcich.push({ t_ms: Math.round(performance.now() - z.t0), speaker_id: sid });
  document.querySelectorAll('#zMluvci button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sid === sid)));
}
document.addEventListener('visibilitychange', () => {
  if (stav.zaznam && document.visibilityState === 'visible') navigator.wakeLock?.request('screen').then(w => { stav.zaznam && (stav.zaznam.wake = w); }).catch(() => {});
});

$('#stopPorady').onclick = async () => {
  const z = stav.zaznam; if (!z) return;
  $('#stopPorady').disabled = true;
  await new Promise(ok => { z.rec.onstop = ok; z.rec.stop(); });
  z.stream.getTracks().forEach(t => t.stop()); z.ctx.close(); z.wake?.release?.();
  await Promise.all(z.zapisy);
  stav.zaznam = null; $('#stopPorady').disabled = false;
  const p = z.porada; p.ended_at = new Date().toISOString(); p.status = 'nahrano';
  const audio = await audioPorady(p.id);
  if (!audio) { p.status = 'prazdna'; await uloz('porady', p); toast('Nic se nenahrálo.'); return ukaz('domu'); }
  p.audio_hash = await sha256(audio); p.audio_bytes = audio.size;
  await uloz('porady', p);
  await audit('system', 'audio-uzavreno', p.id, null, p.audio_hash);
  zpracuj(p.id);
};

// ---------- zpracování ----------
const KROKY = ['Uložení originálu a otisk SHA-256', 'Příprava zvuku', 'Přepis řeči v zařízení', 'Přiřazení mluvčích', 'Analýza: rozhodnutí, úkoly, rizika', 'AI oponentura (kontrola proti zdroji)', 'Uložení výsledků'];
function krok(i, info = '') {
  const ol = $('#kroky'); ol.replaceChildren(...KROKY.map((k, j) => el('li', { class: j < i ? 'hotovo' : j === i ? 'bezi' : '' }, (j < i ? '✓ ' : '') + k)));
  $('#zpProgres').style.width = Math.round(i / KROKY.length * 100) + '%'; $('#zpInfo').textContent = info;
}
async function naMono16k(blob) {
  const ctx = new AudioContext();
  const zdroj = await ctx.decodeAudioData(await blob.arrayBuffer()); ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(zdroj.duration * 16000), 16000);
  const s = off.createBufferSource(); s.buffer = zdroj; s.connect(off.destination); s.start();
  return (await off.startRendering()).getChannelData(0);
}
function mluvciV(porada, ms) {
  let sid = null; for (const z of porada.zmeny_mluvcich) { if (z.t_ms <= ms + 1500) sid = z.speaker_id; else break; }
  return sid;
}
async function zpracuj(meetingId) {
  ukaz('zpracovani', 'Zpracování');
  const p = await nacti('porady', meetingId);
  try {
    krok(1, `Originál: ${Math.round((p.audio_bytes || 0) / 1024)} kB, otisk ${p.audio_hash?.slice(0, 16)}…`);
    const pcm = await naMono16k(await audioPorady(p.id));
    const delka = pcm.length / 16000;
    if (!(await modelVCache()) && stav.secure) throw new Error('Model pro přepis není v zařízení. Nahrávka je bezpečně uložená – po ukončení secure režimu stáhněte model a dejte „Zpracovat znovu“.');
    krok(2, `Délka ${cas(delka * 1000)}. Přepis běží v telefonu, může trvat déle než porada.`);
    const t0 = performance.now();
    const v = await zavolejWorker({ typ: 'prepis', model: stav.model, povolitSit: !stav.secure, jazyk: p.language, audio: pcm }, d => {
      if (d.typ === 'postup') { $('#zpProgres').style.width = Math.round((2 + d.hotovo / d.delka) / KROKY.length * 100) + '%'; $('#zpInfo').textContent = `Přepsáno ${cas(d.hotovo * 1000)} z ${cas(d.delka * 1000)}`; }
      if (d.typ === 'stahovani') $('#zpInfo').textContent = `Stahuji model ${Math.round(d.hotovo / 1e6)} MB / ${Math.round(d.celkem / 1e6)} MB`;
    });
    p.stt_sekund = Math.round((performance.now() - t0) / 1000);
    krok(3);
    const segmenty = v.chunks.filter(c => c.text && c.text.trim()).map((c, i) => {
      const start = Math.round((c.timestamp[0] || 0) * 1000), end = Math.round((c.timestamp[1] ?? delka) * 1000);
      return { id: p.id + '-s' + String(i).padStart(4, '0'), meeting_id: p.id, speaker_id: mluvciV(p, start), start_ms: start, end_ms: end, text: c.text.trim(), confidence: null };
    });
    await dokonciAnalyzu(p, segmenty);
  } catch (e) {
    p.status = 'chyba'; p.chyba = e.message; await uloz('porady', p);
    await audit('system', 'zpracovani-selhalo', p.id);
    $('#zpInfo').textContent = '⚠️ ' + e.message;
    $('#kroky').after(el('button', { class: 'velke', onclick: e2 => { e2.target.remove(); ukaz('domu'); } }, 'Zpět na přehled'));
  }
}
async function dokonciAnalyzu(p, segmenty) {
  for (const s of await podlePorady('segmenty', p.id)) { /* přepis je write-once per zpracování */ }
  krok(4);
  const prim = primarniAnalyza(segmenty, p.participants, p.mluvci);
  krok(5);
  const nalezy = oponentura(prim, segmenty, p.mluvci, p.participants).map(f => ({ ...f, meeting_id: p.id, review: 'ceka' }));
  krok(6);
  for (const s of segmenty) await uloz('segmenty', s);
  for (const f of nalezy) await uloz('nalezy', f);
  p.transcript_hash = await sha256(JSON.stringify(segmenty.map(s => [s.id, s.start_ms, s.end_ms, s.text])));
  p.analysis_hash = await sha256(JSON.stringify(nalezy.map(f => [f.id, f.type, f.text, f.owner, f.deadline])));
  p.status = 'zpracovano'; await uloz('porady', p);
  await audit('system', 'prepis-ulozen', p.id, null, p.transcript_hash);
  await audit('system', 'analyza-ulozena', p.id, null, p.analysis_hash);
  if (stav.automatizace !== 'conservative') await pripravAkce(p, nalezy, true);
  krok(7);
  otevriReview(p.id);
}

// ---------- textový vstup ----------
$('#vlozitText').onclick = () => ukaz('text', 'Přepis z textu');
$('#tUkazka').onclick = () => {
  $('#tNazev').value = 'Ukázka – porada vedení'; $('#tUcastnici').value = 'Jan, Petra, Martin';
  $('#tText').value = ['Jan: Dobrý den, začínáme poradu vedení k rozpočtu na příští rok.',
    'Petra: Rozhodli jsme se, že nový server koupíme ještě v tomto kvartálu.',
    'Jan: Dobře. Petra připraví srovnání tří nabídek do pátku.',
    'Martin: Já zkontroluju licence a pošlu přehled do 20. 10.',
    'Petra: Riziko je, že dodavatel nestihne dodávku před koncem roku.',
    'Jan: Kdo zajistí školení pro nové zaměstnance?',
    'Martin: Musíme ještě vyřešit parkování.',
    'Jan: Schvalujeme rozpočet na marketing ve výši dvě stě tisíc.'].join('\n');
};
$('#tZpracovat').onclick = async () => {
  const radky = $('#tText').value.split('\n').map(r => r.trim()).filter(Boolean);
  if (!radky.length) return toast('Vložte přepis.');
  const ucastnici = ucastniciZ($('#tUcastnici').value);
  const mluvci = {}; const podleJmena = {};
  const p = { id: id('m'), nazev: $('#tNazev').value.trim() || 'Porada z textu', created_at: new Date().toISOString(),
    started_at: null, ended_at: null, security_mode: stav.secure ? 'secure' : 'standard', language: 'czech',
    participants: ucastnici, mluvci, zmeny_mluvcich: [], audio_hash: null, zdroj: 'text', status: 'zpracovani' };
  const segmenty = radky.map((r, i) => {
    const m = r.match(/^([^:]{1,30}):\s*(.+)$/); let sid = null, text = r;
    if (m) { const jm = m[1].trim(); text = m[2];
      if (!podleJmena[jm]) { podleJmena[jm] = 's' + (Object.keys(podleJmena).length + 1); mluvci[podleJmena[jm]] = jm; }
      sid = podleJmena[jm]; }
    return { id: p.id + '-s' + String(i).padStart(4, '0'), meeting_id: p.id, speaker_id: sid, start_ms: i * 10000, end_ms: i * 10000 + 9000, text, confidence: null };
  });
  if (!p.participants.length) p.participants = Object.values(mluvci);
  p.text_hash = await sha256($('#tText').value);
  await uloz('porady', p); await audit('uzivatel', 'prepis-vlozen', p.id, null, p.text_hash);
  ukaz('zpracovani', 'Zpracování'); krok(3);
  await dokonciAnalyzu(p, segmenty);
};

// ---------- review ----------
let audioUrl = null;
async function otevriReview(meetingId, zvyraznit) {
  const p = await nacti('porady', meetingId); if (!p) return;
  if (p.status !== 'zpracovano') {
    ukaz('review', p.nazev);
    $('#rNazev').textContent = p.nazev; $('#rMeta').textContent = 'Porada zatím není zpracovaná. ' + (p.chyba || '');
    $('#rShrnuti').replaceChildren(el('button', { class: 'velke', onclick: () => zpracuj(p.id) }, 'Zpracovat znovu'));
    ['#rNalezy', '#rPrepis', '#rMluvci', '#rOutbox', '#rAudit'].forEach(s => $(s).replaceChildren());
    $('#rOtisk').textContent = p.audio_hash ? 'SHA-256 originálu: ' + p.audio_hash : '';
    return;
  }
  stav.porada = p;
  ukaz('review', p.nazev);
  $('#rNazev').textContent = p.nazev;
  $('#rMeta').textContent = [new Date(p.created_at).toLocaleString('cs-CZ'), p.security_mode === 'secure' ? '🔒 secure' : 'standard',
    p.started_at && p.ended_at ? 'délka ' + cas(new Date(p.ended_at) - new Date(p.started_at)) : 'z textu',
    p.stt_sekund ? 'přepis trval ' + cas(p.stt_sekund * 1000) : null].filter(Boolean).join(' · ');
  $('#rOtisk').textContent = p.audio_hash ? 'SHA-256 originálu: ' + p.audio_hash : (p.text_hash ? 'SHA-256 vloženého textu: ' + p.text_hash : '');
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  const a = $('#rAudio'); const blob = p.audio_hash ? await audioPorady(p.id) : null;
  a.hidden = !blob; if (blob) { audioUrl = URL.createObjectURL(blob); a.src = audioUrl; }
  $('#overitOtisk').hidden = !p.audio_hash;
  await vykresliReview(zvyraznit);
}
async function vykresliReview(zvyraznit) {
  const p = stav.porada;
  const nalezy = await podlePorady('nalezy', p.id);
  const segmenty = (await podlePorady('segmenty', p.id)).sort((a, b) => a.start_ms - b.start_ms);
  $('#rShrnuti').replaceChildren(...shrnuti(nalezy.filter(f => f.review !== 'zamitnuto')).map(t => el('p', {}, t)));
  document.querySelectorAll('.zalozky button').forEach(b => {
    const n = nalezy.filter(f => f.type === b.dataset.typ).length;
    b.textContent = TYPY[b.dataset.typ].replace('Otevřená otázka', 'Otázky').replace('Úkol', 'Úkoly').replace('Riziko', 'Rizika') + ` (${n})`;
    b.setAttribute('aria-selected', String(b.dataset.typ === stav.typ));
  });
  const podleId = new Map(segmenty.map(s => [s.id, s]));
  const box = $('#rNalezy'); box.replaceChildren();
  const vyber = nalezy.filter(f => f.type === stav.typ).sort((a, b) => a.evidence_segment_ids[0].localeCompare(b.evidence_segment_ids[0]));
  if (!vyber.length) box.append(el('p', { class: 'prazdne' }, 'Nic nenalezeno.'));
  for (const f of vyber) {
    const s = podleId.get(f.evidence_segment_ids[0]);
    box.append(el('div', { class: 'nalez ' + (f.review === 'schvaleno' ? 'schvaleno' : f.review === 'zamitnuto' ? 'zamitnuto' : '') },
      el('p', {}, f.text),
      el('div', { class: 'radek' },
        el('span', { class: 'stitek ' + f.verification_status }, STAVY[f.verification_status]),
        `jistota ${Math.round(f.confidence_primary * 100)} % / oponentura ${Math.round(f.confidence_opponent * 100)} %`,
        f.vyzaduje_kontrolu ? el('span', { class: 'stitek castecne' }, 'zkontrolujte') : null),
      (f.type === 'ukol' || f.type === 'rozhodnuti') ? el('div', { class: 'radek' },
        'Vlastník: ', el('b', {}, f.owner || 'nezaznělo'), ' · Termín: ', el('b', {}, f.deadline || 'nezazněl')) : null,
      f.konflikt ? el('div', { class: 'konflikt' }, 'Oponentura: ', f.konflikt) : null,
      s ? el('button', { class: 'dukaz', onclick: () => prehraj(s) }, `▶ Důkaz ${cas(s.start_ms)}${s.speaker_id ? ' · ' + (p.mluvci[s.speaker_id] || '') : ''}`) : null,
      el('div', { class: 'akce' },
        el('button', { onclick: () => recenze(f, 'schvaleno') }, f.review === 'schvaleno' ? '✓ Schváleno' : 'Schválit'),
        el('button', { onclick: () => uprav(f) }, 'Upravit'),
        el('button', { onclick: () => recenze(f, 'zamitnuto') }, f.review === 'zamitnuto' ? 'Zamítnuto' : 'Zamítnout'))));
  }
  // mluvčí
  const m = $('#rMluvci'); m.replaceChildren();
  const pouzite = Object.keys(p.mluvci);
  if (!pouzite.length) m.append(el('p', { class: 'prazdne' }, 'Mluvčí nebyli označeni.'));
  for (const sid of pouzite) m.append(el('label', {}, `Mluvčí ${sid.slice(1)}`, el('input', { value: p.mluvci[sid], onchange: e => prejmenuj(sid, e.target.value) })));
  // přepis
  const pr = $('#rPrepis'); pr.replaceChildren();
  for (const s of segmenty) pr.append(el('div', { class: 'segment' + (s.id === zvyraznit ? ' zvyrazneny' : ''), id: 'seg-' + s.id },
    el('span', { class: 'kdy' }, cas(s.start_ms)), s.speaker_id ? el('span', { class: 'kdo' }, (p.mluvci[s.speaker_id] || '?') + ': ') : null, s.text));
  if (zvyraznit) { pr.closest('details').open = true; document.getElementById('seg-' + zvyraznit)?.scrollIntoView({ block: 'center' }); }
  vykresliOutbox(); vykresliAudit();
}
document.querySelectorAll('.zalozky button').forEach(b => b.onclick = () => { stav.typ = b.dataset.typ; vykresliReview(); });
function prehraj(s) {
  const a = $('#rAudio');
  document.querySelectorAll('.segment.zvyrazneny').forEach(x => x.classList.remove('zvyrazneny'));
  const d = document.getElementById('seg-' + s.id);
  if (d) { d.classList.add('zvyrazneny'); d.closest('details').open = true; }
  if (!a.hidden) { a.currentTime = s.start_ms / 1000; a.play().catch(() => {}); clearTimeout(prehraj.t); prehraj.t = setTimeout(() => a.pause(), Math.max(3000, s.end_ms - s.start_ms + 500)); }
  else d?.scrollIntoView({ block: 'center' });
}
async function recenze(f, hodnota) {
  const old = await sha256(JSON.stringify(f));
  f.review = f.review === hodnota ? 'ceka' : hodnota;
  await uloz('nalezy', f); await audit('uzivatel', 'nalez-' + f.review, f.id, old, await sha256(JSON.stringify(f)));
  vykresliReview();
}
async function uprav(f) {
  const text = prompt('Text', f.text); if (text === null) return;
  const owner = (f.type === 'ukol' || f.type === 'rozhodnuti') ? prompt('Vlastník (prázdné = nezaznělo)', f.owner || '') : f.owner;
  if (owner === null) return;
  const deadline = (f.type === 'ukol' || f.type === 'rozhodnuti') ? prompt('Termín (prázdné = nezazněl)', f.deadline || '') : f.deadline;
  if (deadline === null) return;
  const old = await sha256(JSON.stringify(f));
  Object.assign(f, { text: text.trim(), owner: owner.trim() || null, deadline: deadline.trim() || null, upraveno_uzivatelem: true, review: 'schvaleno',
    owner_zdroj: owner.trim() && owner.trim() !== f.owner ? 'uzivatel' : f.owner_zdroj });
  await uloz('nalezy', f); await audit('uzivatel', 'nalez-upraven', f.id, old, await sha256(JSON.stringify(f)));
  toast('Uloženo. Ruční úprava je zapsána v auditním logu.'); vykresliReview();
}
async function prejmenuj(sid, jmeno) {
  const p = stav.porada; const old = p.mluvci[sid]; p.mluvci[sid] = jmeno.trim() || old;
  if (!p.participants.includes(p.mluvci[sid])) p.participants = p.participants.map(x => x === old ? p.mluvci[sid] : x);
  await uloz('porady', p); await audit('uzivatel', 'mluvci-prejmenovan', p.id);
  // vlastníci odvození z mluvčího se aktualizují
  for (const f of await podlePorady('nalezy', p.id)) if (f.owner_zdroj === 'mluvci-1-osoba' && f.owner === old) { f.owner = p.mluvci[sid]; await uloz('nalezy', f); }
  vykresliReview();
}
$('#overitOtisk').onclick = async () => {
  const p = stav.porada; const h = await sha256(await audioPorady(p.id));
  const r = await overRetezAuditu();
  const ok = h === p.audio_hash;
  await audit('uzivatel', 'overeni-originalu', p.id, p.audio_hash, h);
  alert((ok ? '✅ Originál nahrávky je nezměněný.' : '❌ Originál se liší od otisku pořízeného po poradě!') +
    '\n\nOtisk: ' + h + '\n\nAuditní log: ' + (r.ok ? `řetěz ${r.pocet} událostí je neporušený.` : `porušen u události ${r.seq}!`));
  vykresliAudit();
};

// ---------- export ----------
async function data() {
  const p = stav.porada;
  const nalezy = (await podlePorady('nalezy', p.id)).filter(f => f.review !== 'zamitnuto');
  const segmenty = (await podlePorady('segmenty', p.id)).sort((a, b) => a.start_ms - b.start_ms);
  return { p, nalezy, segmenty };
}
const souborNazev = p => p.nazev.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').slice(0, 40);
function zapisMd({ p, nalezy, segmenty }) {
  const sekce = (typ, nadpis) => {
    const x = nalezy.filter(f => f.type === typ); if (!x.length) return '';
    return `\n## ${nadpis}\n` + x.map(f => {
      const s = segmenty.find(s => s.id === f.evidence_segment_ids[0]);
      const meta = (typ === 'ukol' || typ === 'rozhodnuti') ? ` — **${f.owner || 'vlastník nezazněl'}**, termín: ${f.deadline || 'nezazněl'}` : '';
      return `- ${f.text}${meta} _(${STAVY[f.verification_status]}, zdroj ${s ? cas(s.start_ms) : '?'}${f.review === 'schvaleno' ? ', schváleno' : ''})_`;
    }).join('\n') + '\n';
  };
  return `# Zápis: ${p.nazev}\n\nDatum: ${new Date(p.created_at).toLocaleString('cs-CZ')}  \nÚčastníci: ${p.participants.join(', ') || '—'}  \nRežim: ${p.security_mode}  \n` +
    (p.audio_hash ? `Otisk originálu (SHA-256): \`${p.audio_hash}\`\n` : '') +
    `\n## Shrnutí\n${shrnuti(nalezy).map(t => '- ' + t).join('\n')}\n` +
    sekce('rozhodnuti', 'Rozhodnutí') + sekce('ukol', 'Úkoly') + sekce('otazka', 'Otevřené otázky') + sekce('riziko', 'Rizika') +
    `\n_Vygenerováno asistentem porad (preview). Nálezy označené „Nepodloženo“ nebo „Částečně doloženo“ ověřte v nahrávce._\n`;
}
$('#exMd').onclick = async () => { const d = await data(); stahni(souborNazev(d.p) + '_zapis.md', zapisMd(d), 'text/markdown'); await audit('uzivatel', 'export-md', d.p.id); };
$('#exCsv').onclick = async () => {
  const d = await data(); const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const r = [['Úkol', 'Vlastník', 'Termín', 'Ověření', 'Zdroj (čas)', 'Schváleno'].map(q).join(';')]
    .concat(d.nalezy.filter(f => f.type === 'ukol').map(f => [f.text, f.owner || '', f.deadline || '', STAVY[f.verification_status],
      cas(d.segmenty.find(s => s.id === f.evidence_segment_ids[0])?.start_ms || 0), f.review === 'schvaleno' ? 'ano' : 'ne'].map(q).join(';')));
  stahni(souborNazev(d.p) + '_ukoly.csv', '﻿' + r.join('\r\n'), 'text/csv'); await audit('uzivatel', 'export-csv', d.p.id);
};
$('#exBalik').onclick = async () => {
  const d = await data(); const aud = (await vse('audit')).filter(a => a.object_id === d.p.id || d.nalezy.some(f => f.id === a.object_id));
  stahni(souborNazev(d.p) + '_balik.json', JSON.stringify({ meeting: d.p, transcript: d.segmenty, findings: d.nalezy, audit: aud }, null, 2), 'application/json');
  await audit('uzivatel', 'export-balik', d.p.id);
};
$('#exPdf').onclick = async () => {
  const d = await data(); const md = zapisMd(d);
  const html = md.split('\n').map(r => r.startsWith('# ') ? `<h1>${esc(r.slice(2))}</h1>` : r.startsWith('## ') ? `<h2>${esc(r.slice(3))}</h2>` : r.startsWith('- ') ? `<li>${esc(r.slice(2))}</li>` : r.trim() ? `<p>${esc(r)}</p>` : '').join('');
  const w = window.open('', '_blank');
  if (!w) return stahni(souborNazev(d.p) + '_zapis.html', `<meta charset=utf-8><body>${html}`, 'text/html');
  w.document.write(`<!doctype html><meta charset=utf-8><title>${esc(d.p.nazev)}</title><style>body{font:14px/1.5 system-ui;margin:24px;color:#000}h1{font-size:20px}h2{font-size:16px;margin-top:18px}li{margin:4px 0}</style>${html}`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300); await audit('uzivatel', 'export-pdf', d.p.id);
};
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_\((.+?)\)_/g, '<i>($1)</i>');

// ---------- outbox (secure release gate) ----------
async function pripravAkce(p, nalezy, automaticky) {
  const existujici = await podlePorady('outbox', p.id);
  const md = zapisMd({ p, nalezy, segmenty: await podlePorady('segmenty', p.id) });
  if (!existujici.some(o => o.type === 'email')) await uloz('outbox', { id: id('o'), meeting_id: p.id, type: 'email', created_at: new Date().toISOString(),
    payload: { predmet: 'Zápis: ' + p.nazev, telo: md.replace(/[*_`]/g, '') }, approval_state: 'navrzeno', release_state: 'ceka' });
  if (!automaticky) toast('E‑mail je připraven v outboxu.');
}
$('#doOutboxu').onclick = async () => { const d = await data(); const e = (await podlePorady('outbox', d.p.id)).find(o => o.type === 'email');
  if (e) { e.payload.telo = zapisMd(d).replace(/[*_`]/g, ''); await uloz('outbox', e); toast('E‑mail v outboxu aktualizován.'); } else await pripravAkce(d.p, d.nalezy, false);
  await audit('uzivatel', 'outbox-email', d.p.id); vykresliOutbox(); };
$('#doKalendare').onclick = async () => {
  const p = stav.porada; const kdy = prompt('Datum a čas navazující schůzky (např. 2026-10-17 10:00)'); if (!kdy) return;
  const d = new Date(kdy.replace(' ', 'T')); if (isNaN(d)) return toast('Neplatné datum.');
  await uloz('outbox', { id: id('o'), meeting_id: p.id, type: 'kalendar', created_at: new Date().toISOString(),
    payload: { nazev: 'Navazující: ' + p.nazev, zacatek: d.toISOString(), minut: 60 }, approval_state: 'navrzeno', release_state: 'ceka' });
  await audit('uzivatel', 'outbox-kalendar', p.id); vykresliOutbox();
};
async function vykresliOutbox() {
  const p = stav.porada; if (!p) return;
  const box = $('#rOutbox'); box.replaceChildren();
  const polozky = await podlePorady('outbox', p.id);
  if (!polozky.length) return box.append(el('p', { class: 'prazdne' }, 'Outbox je prázdný.'));
  if (stav.secure) box.append(el('div', { class: 'upozorneni' }, '🔒 Secure režim: akce se neodešlou. Uvolnění bude možné po ukončení secure režimu (klepněte na 🔒 nahoře).'));
  for (const o of polozky) {
    const popis = o.type === 'email' ? 'E‑mail: ' + o.payload.predmet : 'Kalendář: ' + o.payload.nazev + ' – ' + new Date(o.payload.zacatek).toLocaleString('cs-CZ');
    box.append(el('div', { class: 'outbox-polozka' }, popis,
      el('div', { class: 'mala' }, 'Schválení: ', o.approval_state === 'schvaleno' ? 'schváleno' : 'čeká', ' · Uvolnění: ', o.release_state === 'uvolneno' ? 'uvolněno ' + new Date(o.released_at).toLocaleString('cs-CZ') : 'čeká'),
      o.approval_state !== 'schvaleno' ? el('button', { class: 'druhe', onclick: () => schvalAkci(o) }, 'Schválit') : null,
      o.approval_state === 'schvaleno' && o.release_state !== 'uvolneno' ? el('button', { class: 'druhe', disabled: stav.secure, onclick: () => uvolni(o) }, 'Uvolnit (odeslat)') : null));
  }
}
async function schvalAkci(o) {
  o.approval_state = 'schvaleno'; await uloz('outbox', o); await audit('uzivatel', 'outbox-schvaleno', o.id);
  if (stav.automatizace === 'high' && !stav.secure) return uvolni(o, true);
  vykresliOutbox();
}
async function uvolni(o, bezDotazu) {
  if (stav.secure) return toast('Secure režim je aktivní – nic se neodesílá.');
  if (!bezDotazu && !confirm('Uvolnit akci? Teprve teď opustí data zařízení (otevře se e‑mail/kalendář).')) return;
  if (o.type === 'email') {
    const ucastnici = '';
    location.href = 'mailto:' + ucastnici + '?subject=' + encodeURIComponent(o.payload.predmet) + '&body=' + encodeURIComponent(o.payload.telo.slice(0, 1800));
  } else {
    const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const z = new Date(o.payload.zacatek), k = new Date(z.getTime() + o.payload.minut * 60000);
    stahni('schuzka.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Asistent porad//CS', 'BEGIN:VEVENT', 'UID:' + o.id + '@asistent-porad',
      'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(z), 'DTEND:' + f(k), 'SUMMARY:' + o.payload.nazev.replace(/[,;]/g, ' '), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'), 'text/calendar');
  }
  o.release_state = 'uvolneno'; o.released_at = new Date().toISOString(); await uloz('outbox', o);
  await audit('uzivatel', 'outbox-uvolneno', o.id); vykresliOutbox();
}
async function vykresliAudit() {
  const p = stav.porada; if (!p) return;
  const box = $('#rAudit'); box.replaceChildren();
  const ids = new Set([p.id, ...(await podlePorady('nalezy', p.id)).map(f => f.id), ...(await podlePorady('outbox', p.id)).map(o => o.id)]);
  for (const a of (await vse('audit')).filter(a => ids.has(a.object_id)))
    box.append(el('div', { class: 'audit' }, `${new Date(a.timestamp).toLocaleString('cs-CZ')} · ${a.actor} · ${a.action}${a.new_hash ? ' · ' + a.new_hash.slice(0, 12) + '…' : ''}`));
}

// ---------- nastavení ----------
$('#odkazNastaveni').onclick = e => { e.preventDefault(); ukaz('nastaveni', 'Nastavení'); };
$('#nModel').onchange = async e => { stav.model = e.target.value; await nastav('model', stav.model); worker?.terminate(); worker = null; toast('Model změněn – stáhněte jej na přehledu.'); };
$('#nAutomatizace').onchange = async e => { stav.automatizace = e.target.value; await nastav('automatizace', stav.automatizace); };
$('#nSmazat').onclick = async () => {
  if (!confirm('Smazat všechny porady, nahrávky a nastavení z tohoto zařízení? Nelze vrátit.')) return;
  if (prompt('Pro potvrzení napište SMAZAT') !== 'SMAZAT') return;
  await smazVse(); try { await caches.delete('transformers-cache'); } catch {}
  location.reload();
};

// ---------- start ----------
(async () => {
  stav.secure = await nastaveni('secure', false);
  stav.model = await nastaveni('model', stav.model); $('#nModel').value = stav.model;
  stav.automatizace = await nastaveni('automatizace', 'standard'); $('#nAutomatizace').value = stav.automatizace;
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
      const r = await navigator.serviceWorker.ready;
      r.active?.postMessage({ typ: 'secure', zapnuto: stav.secure });
      navigator.serviceWorker.addEventListener('controllerchange', () => { navigator.serviceWorker.controller?.postMessage({ typ: 'secure', zapnuto: stav.secure }); vykresliPripravenost(); });
    } catch (e) { console.warn('SW', e); }
  }
  // porada přerušená pádem/zavřením: originál je uložený po kusech → nabídni zpracování
  for (const p of await vse('porady')) if (p.status === 'nahravani') {
    const a = await audioPorady(p.id);
    if (a) { p.status = 'nahrano'; p.ended_at = p.ended_at || new Date().toISOString(); p.audio_hash = await sha256(a); p.audio_bytes = a.size; p.preruseno = true;
      await uloz('porady', p); await audit('system', 'audio-obnoveno-po-preruseni', p.id, null, p.audio_hash); toast('Přerušená porada byla obnovena z uložených částí.', 6000); }
    else { p.status = 'prazdna'; await uloz('porady', p); }
  }
  vykresliStavSite();
  ukaz('domu');
})();
