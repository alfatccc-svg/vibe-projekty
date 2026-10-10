// Lokální úložiště (IndexedDB) + Meeting Vault + auditní log s řetězením otisků.
const DB_NAZEV = 'asistent-porad';
const VERZE = 1;
const STORY = ['porady', 'audio', 'segmenty', 'nalezy', 'outbox', 'audit', 'nastaveni'];

let dbPromise;
function db() {
  if (!dbPromise) dbPromise = new Promise((ok, chyba) => {
    const r = indexedDB.open(DB_NAZEV, VERZE);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('porady', { keyPath: 'id' });
      const a = d.createObjectStore('audio', { keyPath: 'key' }); a.createIndex('meeting', 'meeting_id');
      const s = d.createObjectStore('segmenty', { keyPath: 'id' }); s.createIndex('meeting', 'meeting_id');
      const n = d.createObjectStore('nalezy', { keyPath: 'id' }); n.createIndex('meeting', 'meeting_id');
      const o = d.createObjectStore('outbox', { keyPath: 'id' }); o.createIndex('meeting', 'meeting_id');
      const l = d.createObjectStore('audit', { keyPath: 'seq', autoIncrement: true }); l.createIndex('object', 'object_id');
      d.createObjectStore('nastaveni', { keyPath: 'klic' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => chyba(r.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(d => new Promise((ok, chyba) => {
    const t = d.transaction(store, mode);
    let vysledek, vyjimka;
    Promise.resolve().then(() => fn(t.objectStore(store))).then(v => { vysledek = v; },
      e => { vyjimka = e; try { t.abort(); } catch {} });
    t.oncomplete = () => ok(vysledek);
    t.onerror = () => chyba(vyjimka || t.error);
    t.onabort = () => chyba(vyjimka || t.error);
  }));
}
const req = r => new Promise((ok, chyba) => { r.onsuccess = () => ok(r.result); r.onerror = () => chyba(r.error); });

export const uloz = (store, obj) => tx(store, 'readwrite', s => req(s.put(obj)));
export const nacti = (store, key) => tx(store, 'readonly', s => req(s.get(key)));
export const vse = store => tx(store, 'readonly', s => req(s.getAll()));
export const podlePorady = (store, id) => tx(store, 'readonly', s => req(s.index('meeting').getAll(id)));
export const smazVse = () => db().then(d => { d.close(); dbPromise = null; return new Promise((ok, chyba) => {
  const r = indexedDB.deleteDatabase(DB_NAZEV); r.onsuccess = ok; r.onerror = () => chyba(r.error); r.onblocked = ok; }); });

/** Write-once: kus audia se zapíše jen pokud pod klíčem ještě nic není. */
export function ulozAudioKus(meeting_id, poradi, blob) {
  const key = meeting_id + ':' + String(poradi).padStart(6, '0');
  return tx('audio', 'readwrite', async s => {
    const existuje = await req(s.getKey(key));
    if (existuje !== undefined) throw new Error('Originál audia je neměnný – zápis odmítnut.');
    return req(s.add({ key, meeting_id, poradi, blob, ulozeno: new Date().toISOString() }));
  });
}

export async function audioPorady(meeting_id) {
  const kusy = (await podlePorady('audio', meeting_id)).sort((a, b) => a.poradi - b.poradi);
  if (!kusy.length) return null;
  return new Blob(kusy.map(k => k.blob), { type: kusy[0].blob.type || 'audio/webm' });
}

export async function sha256(dataOrBlob) {
  const buf = dataOrBlob instanceof Blob ? await dataOrBlob.arrayBuffer()
    : typeof dataOrBlob === 'string' ? new TextEncoder().encode(dataOrBlob) : dataOrBlob;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Auditní log: každá událost nese otisk předchozí → změna historie je odhalitelná. */
export async function audit(actor, action, object_id, old_hash = null, new_hash = null) {
  const vsechny = await vse('audit');
  const posledni = vsechny[vsechny.length - 1];
  const prev = posledni ? posledni.chain : '0'.repeat(64);
  const udalost = { timestamp: new Date().toISOString(), actor, action, object_id, old_hash, new_hash, prev };
  udalost.chain = await sha256(prev + JSON.stringify([udalost.timestamp, actor, action, object_id, old_hash, new_hash]));
  await uloz('audit', udalost);
  return udalost;
}

export async function overRetezAuditu() {
  const vsechny = await vse('audit');
  let prev = '0'.repeat(64);
  for (const u of vsechny) {
    const ocekavany = await sha256(prev + JSON.stringify([u.timestamp, u.actor, u.action, u.object_id, u.old_hash, u.new_hash]));
    if (u.prev !== prev || u.chain !== ocekavany) return { ok: false, seq: u.seq };
    prev = u.chain;
  }
  return { ok: true, pocet: vsechny.length };
}

export async function nastaveni(klic, vychozi) {
  const r = await nacti('nastaveni', klic);
  return r ? r.hodnota : vychozi;
}
export const nastav = (klic, hodnota) => uloz('nastaveni', { klic, hodnota });
export { STORY };
