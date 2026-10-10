// Analytická vrstva + AI oponentura (pravidlová, offline, deterministická).
// Primární extraktor navrhuje nálezy; nezávislý ověřovatel je kontroluje proti
// zdrojovým úsekům přepisu. Vlastník ani termín se nikdy nedomýšlí.

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const VZORY = {
  rozhodnuti: [
    [/\brozhodl[aiy]? jsme\b|\brozhodujeme\b|\brozhodnuto\b|\bje rozhodnuto\b/, 0.9],
    [/\bschvalujeme\b|\bschvaleno\b|\bschvalen[aoy]?\b|\bodsouhlas/, 0.85],
    [/\bdohodli jsme se\b|\bdohodnuto\b|\bdomluveno\b|\bdomluvili jsme se\b/, 0.8],
    [/\bplati,? ze\b|\bjdeme do toho\b|\bzamitame\b|\bzamitnuto\b/, 0.7],
    [/\bwe decided\b|\bdecision\b|\bapproved\b|\bagreed\b/, 0.8],
  ],
  ukol: [
    [/\bma za ukol\b|\bukol pro\b|\bukolujeme\b|\bdostava ukol\b/, 0.9],
    [/\b(zajisti|pripravi|posle|udela|vyresi|nachysta|zkontroluje|zavola|objedna|domluvi|zpracuje|dodá|doda|svola)\b/, 0.75],
    [/\b(zajistim|pripravim|poslu|udelam|vyresim|nachystam|zkontroluju|zkontroluji|zavolam|objednam|domluvim|zpracuju|zpracuji|dodam|svolam|vezmu si)\b/, 0.75],
    [/\b(je potreba|musime|mel by|mela by|meli by)\b/, 0.5],
    [/\baction item\b|\bwill (send|prepare|check|call|do)\b|\bto do\b/, 0.7],
  ],
  otazka: [
    [/\?\s*$/, 0.7],
    [/\botevrena otazka\b|\bneni jasne\b|\bnevime\b|\bje treba zjistit\b|\bzjistit\b|\bnevyreseno\b/, 0.75],
    [/\bopen question\b|\bunclear\b/, 0.7],
  ],
  riziko: [
    [/\brizik|\bhrozi\b|\bobava\b|\bobavam se\b/, 0.85],
    [/\bproblem\b|\bzpozdeni\b|\bnestihneme\b|\bblokuje\b|\bchybi\b|\bpresahne\b|\bprekroc/, 0.7],
    [/\brisk\b|\bdelay\b|\bblocker\b|\bissue\b/, 0.75],
  ],
};

// Slovesa v 1. osobě → vlastník = mluvčí úseku (jen pokud je mluvčí pojmenovaný).
const PRVNI_OSOBA = /\b(zajistim|pripravim|poslu|udelam|vyresim|nachystam|zkontroluju|zkontroluji|zavolam|objednam|domluvim|zpracuju|zpracuji|dodam|svolam|vezmu si|i will|i'll)\b/;

const DNY = 'pondeli|pondelka|utery|uterka|stredu|streda|stredy|ctvrtek|ctvrtka|patek|patku|sobotu|sobota|soboty|nedeli|nedele';
const MESICE = 'ledna|unora|brezna|dubna|kvetna|cervna|cervence|srpna|zari|rijna|listopadu|prosince';
const TERMINY = [
  new RegExp(`\\b(do|nejpozdeji do|nejpozdeji v|v|ve|na|pristi|tento|tenhle)\\s+(${DNY})\\b`),
  new RegExp(`\\b(do\\s+)?\\d{1,2}\\.\\s?(\\d{1,2}\\.|${MESICE})(\\s?\\d{4})?`),
  /\b(do\s+)?(zitra|pozitri|dnes|dneska)\b/,
  /\b(do\s+)?(konce|pulky|poloviny)\s+(tydne|mesice|roku|kvartalu|ctvrtleti)\b/,
  /\b(pristi|tento|do pristiho)\s+(tyden|tydne|mesic|mesice)\b/,
  /\bdo\s+(\d+|dvou|tri|ctyr|peti|deseti|ctrnacti)\s+(dnu|dni|tydnu|tydnu|mesicu)\b/,
  /\bdo\s+pristi\s+porady\b/,
  /\b(by|until|before)\s+(monday|tuesday|wednesday|thursday|friday|tomorrow|end of (the )?(week|month))\b/,
];

function najdiTermin(textN) {
  for (const re of TERMINY) { const m = textN.match(re); if (m) return m[0].trim(); }
  return null;
}

function najdiJmena(textN, ucastnici) {
  return ucastnici.filter(j => {
    const k = norm(j).trim();
    if (k.length < 2) return false;
    // jméno i v pádech: Petra/Petro/Petře → kmen bez posledního písmene
    const kmen = k.length > 4 ? k.slice(0, -1) : k;
    return new RegExp(`\\b${kmen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`).test(textN);
  });
}

// Původní text odpovídající normalizovanému úseku (pro zobrazení termínu s diakritikou).
function vyrez(text, textN, kus) {
  const i = textN.indexOf(kus);
  return i >= 0 ? text.slice(i, i + kus.length) : kus;
}

let pocitadlo = 0;
const noveId = () => 'f' + Date.now().toString(36) + (pocitadlo++).toString(36);

/** Primární extraktor. segments: [{id, speaker_id, start_ms, end_ms, text}] */
export function primarniAnalyza(segments, ucastnici, jmenaMluvcich) {
  const nalezy = [];
  for (const s of segments) {
    const tN = norm(s.text);
    for (const [typ, vzory] of Object.entries(VZORY)) {
      let skore = 0;
      for (const [re, w] of vzory) if (re.test(tN)) skore = Math.max(skore, w);
      if (!skore) continue;
      if (typ === 'ukol' && /\?\s*$/.test(tN)) continue; // otázka není úkol
      // úkol potřebuje sloveso činnosti; samotné „musíme“ je slabé
      const f = { id: noveId(), type: typ, text: s.text.trim(), owner: null, owner_zdroj: null,
        deadline: null, confidence_primary: skore, evidence_segment_ids: [s.id] };
      if (typ === 'ukol' || typ === 'rozhodnuti') {
        const jm = najdiJmena(tN, ucastnici);
        if (jm.length === 1) { f.owner = jm[0]; f.owner_zdroj = 'jmeno-v-textu'; }
        else if (jm.length > 1) { f.owner = jm.join(', '); f.owner_zdroj = 'jmeno-v-textu'; }
        else if (PRVNI_OSOBA.test(tN)) {
          const kdo = jmenaMluvcich[s.speaker_id];
          if (kdo) { f.owner = kdo; f.owner_zdroj = 'mluvci-1-osoba'; }
        }
        const t = najdiTermin(tN);
        if (t) f.deadline = vyrez(s.text, tN, t);
      }
      nalezy.push(f);
    }
  }
  // Úsek, který je rozhodnutím i úkolem, necháme jako obojí jen při silném signálu úkolu.
  return nalezy.filter(f => !(f.type === 'ukol' && f.confidence_primary < 0.6 &&
    nalezy.some(g => g !== f && g.type === 'rozhodnuti' && g.evidence_segment_ids[0] === f.evidence_segment_ids[0])));
}

/** Nezávislá oponentura: ověří každý nález proti zdroji. Nepřebírá skóre primární vrstvy. */
export function oponentura(nalezy, segments, jmenaMluvcich, ucastnici) {
  const podleId = new Map(segments.map(s => [s.id, s]));
  return nalezy.map(f => {
    const duvody = [];
    let skore = 1;
    const dukazy = f.evidence_segment_ids.map(id => podleId.get(id)).filter(Boolean);
    if (!dukazy.length) {
      return { ...f, confidence_opponent: 0, verification_status: 'nepodlozeno',
        konflikt: 'Chybí zdrojový úsek přepisu.' };
    }
    const zdroj = dukazy.map(d => d.text).join(' ');
    const zN = norm(zdroj);
    // text nálezu musí být doslova ve zdroji
    if (!zN.includes(norm(f.text).slice(0, 40))) { skore -= 0.5; duvody.push('Text nálezu neodpovídá zdroji.'); }
    if (f.owner) {
      if (f.owner_zdroj === 'jmeno-v-textu') {
        const vsechna = f.owner.split(',').map(x => x.trim());
        const nalezena = najdiJmena(zN, vsechna);
        if (nalezena.length !== vsechna.length) { skore -= 0.5; duvody.push('Vlastník ve zdroji nezazněl.'); }
        else if (f.type === 'ukol' && !PRVNI_OSOBA.test(zN) && !/\b(ma za ukol|ukol pro|zajisti|pripravi|posle|udela|vyresi|zkontroluje|zavola|objedna|domluvi|zpracuje|doda|svola|nachysta)\b/.test(zN)) {
          skore -= 0.2; duvody.push('Jméno zaznělo, ale přiřazení úkolu není jednoznačné.');
        }
      } else if (f.owner_zdroj === 'mluvci-1-osoba') {
        const mluvci = jmenaMluvcich[dukazy[0].speaker_id];
        if (mluvci !== f.owner) { skore -= 0.5; duvody.push('Vlastník neodpovídá mluvčímu.'); }
        else { skore -= 0.1; duvody.push('Vlastník odvozen z mluvčího („udělám…“) – ověřte označení mluvčího.'); }
      }
    } else if (f.type === 'ukol') {
      skore -= 0.3; duvody.push('Vlastník nezazněl – nedoplňuji.');
    }
    if (f.deadline) {
      if (!zN.includes(norm(f.deadline))) { skore -= 0.5; duvody.push('Termín ve zdroji nezazněl.'); }
    } else if (f.type === 'ukol') {
      skore -= 0.15; duvody.push('Termín nezazněl – nedoplňuji.');
    }
    if (dukazy.some(d => d.text.trim().split(/\s+/).length < 4)) { skore -= 0.15; duvody.push('Velmi krátký úsek – možná nepřesný přepis.'); }
    skore = Math.max(0, Math.min(1, Math.round(skore * 100) / 100));
    const stav = skore >= 0.75 ? 'overeno' : skore >= 0.45 ? 'castecne' : 'nepodlozeno';
    const rozdil = Math.abs(skore - f.confidence_primary) >= 0.3;
    return { ...f, confidence_opponent: skore, verification_status: stav,
      konflikt: (rozdil || stav !== 'overeno') && duvody.length ? duvody.join(' ') : null,
      vyzaduje_kontrolu: Math.min(skore, f.confidence_primary) < 0.6 };
  });
}

/** Shrnutí bez LLM: jen to, co je doloženo. */
export function shrnuti(nalezy) {
  const c = t => nalezy.filter(f => f.type === t);
  const r = c('rozhodnuti'), u = c('ukol'), o = c('otazka'), k = c('riziko');
  const kontrola = nalezy.filter(f => f.vyzaduje_kontrolu).length;
  const body = [];
  body.push(`Rozhodnutí: ${r.length}, úkoly: ${u.length}, otevřené otázky: ${o.length}, rizika: ${k.length}.`);
  if (r.length) body.push('Hlavní rozhodnutí: ' + r.filter(f => f.verification_status !== 'nepodlozeno').slice(0, 3).map(f => '„' + zkrat(f.text) + '“').join('; ') + '.');
  const bezVlastnika = u.filter(f => !f.owner).length;
  if (bezVlastnika) body.push(`${bezVlastnika} úkol(ů) nemá v nahrávce uvedeného vlastníka.`);
  const bezTerminu = u.filter(f => !f.deadline).length;
  if (bezTerminu) body.push(`${bezTerminu} úkol(ů) nemá v nahrávce uvedený termín.`);
  if (kontrola) body.push(`${kontrola} nález(ů) vyžaduje lidskou kontrolu (nízká jistota).`);
  return body;
}

export const zkrat = (t, n = 110) => t.length > n ? t.slice(0, n - 1) + '…' : t;
export const _test = { norm, najdiTermin, najdiJmena };
