# Asistent porad – Secure Offline (preview 0.1)

Podle zadání „Manager Assistant Secure Offline“ (spec.md na Drive). Webová PWA, běží v telefonu.

- **Secure režim:** service worker blokuje veškerou síť mimo vlastní aplikaci, akce jdou jen do outboxu.
- **Meeting Vault:** audio se ukládá po 5 s kusech (write-once) do IndexedDB, po poradě SHA-256 otisk; auditní log s řetězením otisků.
- **Přepis:** Whisper (tiny/base/small) přes transformers.js 3.0.2 přímo v zařízení; model se stáhne jednou předem.
- **Mluvčí:** ruční označování během porady (automatická diarizace = fáze 2).
- **Analýza + AI oponentura:** pravidlová, deterministická; vlastník/termín se nikdy nedomýšlí, každý nález má odkaz na úsek nahrávky.
- **Export:** tisk/PDF, Markdown, CSV, JSON balík s otisky. **Outbox:** e-mail, kalendář (.ics) – uvolnění až po ukončení secure režimu a potvrzení.

Omezení preview: bez LLM shrnutí (fáze 2), bez šifrování úložiště heslem (fáze 2), dlouhé porady (> 45 min) mohou na slabším telefonu narazit na paměť.
