# White Red Blue s.r.o. (WRBCZ) – web

Jednostránkový, scrollovací web společnosti White Red Blue s.r.o. (bez záložek, kotvová navigace v hlavičce).
Česky, responzivní od 360 px po 1920 px, světlý i tmavý režim podle nastavení systému (`prefers-color-scheme`; bez přepínače na stránce,
vynutit lze atributem `data-theme="light"` / `data-theme="dark"` na `<html>`).

## Soubory
- `index.html` – celý web v jednom souboru (CSS i JS inline, logo i favicona jako inline SVG). Stačí otevřít v prohlížeči.
- `logo-wrbcz.svg` – samostatná vektorová verze loga (rovnoběžník bílá / červená `#EC200D` / modrá `#0433FF`, tmavý obrys).
  Stránka ji nenačítá, logo má vložené přímo v HTML; soubor slouží pro další použití (tiskoviny, patička e-mailu apod.).

## Externí zdroje
Pouze písma z Google Fonts (Newsreader pro titulky, Manrope pro text). Bez obrázků, bez dalších skriptů.

## Co doplnit
- Kontaktní e-mail a telefon: v `index.html` je v sekci Kontakt komentář `<!-- DOPLNIT: e-mail, telefon -->`.
- Údaje z obchodního rejstříku (IČO, sídlo, datum vzniku) v hlavičce i patičce pocházejí z veřejných zdrojů – před nasazením ověřit.
- Text o zakladateli (vzdělání, praxe) vychází z veřejného profilu na LinkedIn – před nasazením ověřit a případně upravit v sekci `#zakladatel`.
- Po nasazení doplnit `<link rel="canonical">`, `og:url` a `og:image` (1200×630) s finální doménou – v `<head>` je komentář `<!-- DOPLNIT po nasazení: ... -->`.

## Zveřejnění
Stačí nahrát `index.html` na libovolný statický hosting (GitHub Pages, Netlify, Vercel, FTP u poskytovatele domény).
Žádný build ani server není potřeba.

## Úpravy textů
Každá část webu je v `index.html` samostatná `<section>` s `id`: `uvod` (hlavička s logem a claimem), `spolecnost`,
`cinnost`, `partneri`, `zakladatel`, `kontakt`; patička je `<footer>`. Barvy a písma jsou v `:root` na začátku `<style>`.

## Kontrola
Stránka prošla automatickou kontrolou (mobil / PC / široký monitor, světlý i tmavý režim): bez chyb JavaScriptu,
bez vodorovného přetékání, bez nálezů axe-core (WCAG 2 A/AA), `<title>` a `lang="cs"` nastaveny.
Stejnou kontrolu lze po změnách spustit Testovačem UI z tohoto repozitáře (`testovac-ui/test.mjs`, proměnná `CIL_URL`).
