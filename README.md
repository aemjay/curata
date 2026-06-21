# Curata

Browser-lokales Zero-Build-Foto-Kurationstool: lokale Urlaubsfoto-Auswahl → Buch-Skelett. Vanilla JS + Preact/htm, IndexedDB, ONNX Runtime Web (CLIP, Florence-2, MediaPipe, EdgeFace). Keine Server-Komponente, kein Build, keine Bundler — alle Abhängigkeiten/Modelle zur Laufzeit per CDN/HF-Hub.

## Repo-Layout
```
photobook/            Die App (statisch ausgeliefert; index.html als Einstieg)
docs/konzept/         KONZEPT-Dokumente = Quelle der Wahrheit (SoT)
docs/status/          Abnahme-/Provenienz-Notizen (verifizierte SHA256)
scripts/verify.sh     Verifikations-Gate (node --check, Zirkel-Guard, FROZEN-Warnung)
CLAUDE.md             Verbindliche Instruktionen für Claude Code
```

## Lokal starten
ES-Module + `fetch` funktionieren **nicht** über `file://`. Einen statischen Server nutzen:
```
cd photobook
python3 -m http.server 8000
# Browser: http://localhost:8000
```
Alternativ `npx serve` aus `photobook/`.

## Verifizieren
```
bash scripts/verify.sh
```
Prüft Syntax aller JS, das Zirkelimport-Gate und warnt bei Änderungen an FROZEN-Pfaden (`scripts/frozen-paths.txt`).

## Deploy
Statisch, Publish-Verzeichnis = `photobook/`.
- **Netlify (empfohlen):** Repo verbinden, Build-Command leer, Publish-Dir `photobook`. Auto-Deploy bei Push.
- **Netlify Drop:** Ordner `photobook/` manuell hochladen (Fallback, kein Repo nötig).
- **GitHub Pages:** Pages liefert nur aus Repo-Root oder `/docs`. Für Pages müsste die App nach Root verschoben oder ein Pages-Workflow ergänzt werden — Netlify ist mit der `photobook/`-Struktur reibungsärmer.

## Arbeitsloop
1. KONZEPT in `docs/konzept/` schreiben/anpassen (SoT zuerst).
2. Claude Code auf einem Branch implementieren lassen (ein Delta pro Branch).
3. `bash scripts/verify.sh` + Diff/PR prüfen.
4. Merge → Deploy.

Details und die FROZEN-Liste: siehe `CLAUDE.md`.

## Weitere KONZEPT-Dokumente
Aktuell enthalten: Presets-Initial-StartScreen (v1.1), Review-E4-HeaderIA (v1.1), Pipeline-SoT (v7). Weitere historische KONZEPTe (Dubletten, Kuratierung-Phase-A, Ingest-Performance, A-UI-Sammelrunde), falls vorhanden, nach `docs/konzept/` legen.
