# Testovač UI (Vinčák)

Spouští se z n8n (workflow „Vinčák – Testovač UI“) přes GitHub Actions → `.github/workflows/testovac-ui.yml`.
Otevře stránku v headless Chromiu jako **mobil** a **počítač**, zachytí chyby JavaScriptu, chyby v konzoli,
nenačtené soubory, přetékání do strany, přístupnost (axe-core, WCAG 2 A/AA), prokliká tlačítka a pořídí snímky.
Výsledek: artefakt `testovac-ui-<ident>` (vysledek.json + PNG), drží se 3 dny.

Nic tajného se sem nedává – workflow má jen právo číst repozitář.
