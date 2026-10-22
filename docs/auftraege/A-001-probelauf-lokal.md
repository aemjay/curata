```
Auftrag:   A-001
Titel:     Probelauf lokal — Umgebung, App-Start, Browser, Rückweg ins Repo
Ziel:      lokal
Status:    FERTIG
Erstellt:  2026-10-22 (Cloud-Session)
Branch:    auftrag/A-001
```

## Zweck
Bevor echte Diagnoseläufe (Ablaufplan Schritt 2) lokal laufen, muss einmal bewiesen sein, dass die lokale Session (a) das Repo hat, (b) die App startet und im Browser bedienen kann, (c) weiß, ob die Maschine GPU-Beschleunigung für die Modelle hat, und (d) Ergebnisse zurück ins Repo pushen kann. Kein App-Code wird geändert.

## Schritte
1. **Repo.** Falls nicht vorhanden: `git clone https://github.com/aemjay/curata.git`. Dann `git fetch origin && git checkout -b auftrag/A-001 origin/claude/affectionate-gauss-0tyi70`. Status dieser Datei auf `LÄUFT` setzen, committen.
2. **Umgebung erfassen** und in `docs/auftraege/A-001/umgebung.md` schreiben: Betriebssystem + Version, CPU-Kerne, RAM, freier Plattenplatz, Node-Version (`node -v`), Python-Version, Git-Push-Rechte vorhanden (`git push --dry-run origin auftrag/A-001`), installierter Browser.
3. **Verifikationsgate:** `bash scripts/verify.sh` ausführen, Ausgabe nach `docs/auftraege/A-001/verify.txt`. Fehlt `node`, das notieren (Gate degradiert zur Warnung).
4. **App starten:** `cd photobook && python3 -m http.server 8000` im Hintergrund (oder `npx serve`), prüfen, dass `http://localhost:8000` antwortet.
5. **Browser-Steuerung einrichten.** Bevorzugt Playwright (`npx --yes playwright@1.49.1 install chromium`, dann ein kurzes Node-Skript unter `docs/auftraege/A-001/screenshot.mjs`). Alternativ die Claude-Browser-Integration, falls in der Session verfügbar. Wichtig: Chromium **mit** GPU starten (nicht headless-shell, sondern `headless: false` oder `--headless=new` mit `--enable-unsafe-webgpu`), sonst ist das WebGPU-Ergebnis in Schritt 6 nicht aussagekräftig.
6. **Startbildschirm prüfen:** Seite laden, 5 Sekunden warten, Screenshot nach `docs/auftraege/A-001/start.png`. Den auf dem Startbildschirm angezeigten WebGPU-Status (Eingangsdiagnose) ablesen und in `umgebung.md` eintragen. Zusätzlich `chrome://gpu` laden und den Abschnitt „WebGPU" als Text in `umgebung.md` übernehmen. Browser-Konsole auf Fehler prüfen (CDN-Importe von esm.sh/jsdelivr müssen laden); Fehler nach `docs/auftraege/A-001/konsole.txt`.
7. **Kein Foto-Lauf.** Dieser Auftrag lädt keine Fotos und startet keine Verarbeitung.
8. **Ergebnis** in `docs/auftraege/A-001.ergebnis.md`: (1) alle vier Zwecke a–d je mit „ja/nein + Beleg", (2) **WebGPU verfügbar: ja/nein** als eigene Zeile, (3) was nicht ging und warum, (4) geschätzte Zeit für die Einrichtung. Status in dieser Datei auf `FERTIG` oder `BLOCKIERT: <Grund>`.
9. `git add docs/auftraege && git commit && git push -u origin auftrag/A-001`. Falls Push fehlschlägt: Status `BLOCKIERT: kein Push-Recht`, Ergebnis trotzdem lokal committen und Michael in der Session sagen, dass GitHub-Anmeldung auf diesem Rechner fehlt.

## Bewusst nicht
Kein App-Code, kein CSS, keine Modelldownloads erzwingen (die App lädt Modelle erst beim Lauf), keine Fotos.

## Erwartung der Cloud-Seite
Mit dem Ergebnis entscheidet die Cloud-Session, ob die Diagnoseläufe (Schritt 2) auf dieser Maschine sinnvoll sind. Entscheidend ist die WebGPU-Zeile: Ohne GPU läuft die App im langsamen WASM-Modus, und eine VM ohne GPU-Durchreichung bringt gegenüber der Cloud keinen Geschwindigkeitsvorteil, nur den Datenschutzvorteil (Fotos bleiben lokal).
