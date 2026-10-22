```
Auftrag:   A-002
Titel:     Diagnoseläufe auf drei heterogenen Bibliotheken (Ablaufplan Schritt 2)
Ziel:      lokal
Status:    ENTSCHEIDUNG: Eingaben fehlen — D:ClaudeCurata-Diagnose mit stadt, familie, natur (je ≥300 Fotos) und familie-unverzichtbar.txt existiert nicht
Erstellt:  2026-10-22 (Cloud-Session)
Branch:    auftrag/A-002
Voraussetzung: A-001 FERTIG (GPU aktiv, Playwright mit channel 'chrome', Push-Recht)
```

## Zweck (Nutzer-Sicht)
Wir wollen wissen, wo Curata einen Nutzer im Stich lässt, bevor wir an der Auswahl bauen: Wirft die App das einzige Bild einer wichtigen Person weg, weil es unscharf ist? Wählt sie dreimal dasselbe Motiv? Fehlt ihr, was dem Nutzer wichtig ist? Dafür laufen drei möglichst verschiedene Bibliotheken mit **Standard-Einstellungen** durch, und die Ergebnisse werden ohne Bilder ins Repo gebracht. Die Cloud-Session wertet aus (Befundbericht, Entscheidung D3).

## Eingaben von Michael (vor dem Start prüfen)
Drei Ordner, je ≥300 Fotos, unter `D:\Claude\Curata-Diagnose\`:
- `stadt\` — Städtetrip, Sehenswürdigkeiten
- `familie\` — Personen-dominant (Familie, Freunde)
- `natur\` — Landschaft/Natur (Vergleich zur Feldabnahme 468 Fotos)

Zusätzlich für **einen** Ordner (bevorzugt `familie`) die Datei `D:\Claude\Curata-Diagnose\familie-unverzichtbar.txt`: 10–20 Dateinamen, die Michael **vor** dem Blick auf die Auswahl notiert hat. Das ist die einzige echte Nutzer-Wahrheit in diesem Auftrag.

Fehlt ein Ordner oder die Liste: Status `ENTSCHEIDUNG: <was fehlt>` setzen, committen, pushen, Michael in der Session fragen. Mit den vorhandenen Ordnern trotzdem beginnen.

## Schritte je Bibliothek (Reihenfolge: natur, stadt, familie)
1. **Sauberer Zustand.** App laden, „Alle lokalen Daten löschen" ausführen (Bestätigungsdialog per Playwright annehmen), neu laden. Startbildschirm muss „0 Fotos" zeigen.
2. **Fotos hinzufügen** per Playwright auf den Datei-Input: bevorzugt `page.setInputFiles('input[webkitdirectory]', ordnerpfad)` (Playwright ≥ 1.46 unterstützt Ordner); Fallback `input[type=file][multiple]` mit allen Dateipfaden in Blöcken von 200. Warten, bis der Chip „Fotos" die erwartete Zahl zeigt und „Weiter zur Verarbeitung" aktiv ist. Zahl der geladenen Fotos, HEIC-Anteil, GPS-Anteil aus den Chips notieren.
3. **Einstellungen nicht anfassen** (Ausgewogen / Ausgewogen / Moment vor Technik / Auto / keine Obergrenze). Screenshot `start-<name>.png`.
4. **Verarbeitung starten** und warten, bis der Review-Bildschirm erscheint (Nav-Schritt „Review" aktiv). Timeout 3 Stunden. Alle 60 s den sichtbaren Stufenfortschritt in `lauf-<name>.log` protokollieren (Stufe, Fortschritt, Uhrzeit), damit Laufzeiten je Stufe ablesbar sind. Bei Fehler: Screenshot, Konsole sichern, Status `BLOCKIERT: <Grund>`.
5. **Review nicht manuell verändern.** Keine Overrides setzen (die Auto-Auswahl soll unverfälscht sein). Screenshot `review-<name>.png` (ganze Seite) und zusätzlich je Kapitel einen Screenshot mit Dichte „Alle Verwürfe", falls das ohne Umbau per Klick erreichbar ist (sonst weglassen).
6. **Export:** Im Export-Bildschirm „Diagnose exportieren" (`diagnose.json`) und `selection.json` per Playwright-Download sichern nach `docs/auftraege/A-002/<name>/`. **Kein ZIP, kein Kontaktbogen** (enthalten Bilder).
7. **Stellvertreter-Review (Proxy) durch die lokale Session.** Thumbnails (max. 512 px Kante) aller Fotos **außerhalb des Repos** erzeugen (z. B. `D:\Claude\Curata-Diagnose\_thumbs\<name>\`; Pillow + pillow-heif oder ImageMagick). Dann pro Szene (aus `selection.json`/`diagnose.json`) die Bilder ansehen und wie ein Fotobuch-Macher urteilen, **nicht** wie ein Techniker: emotionaler und erzählerischer Wert, Personen-Konstellationen, Vielfalt. Ergebnis `proxy-review.json`:
   ```json
   { "library": "natur", "judge": "claude-local-proxy",
     "unverzichtbar": ["IMG_0012.JPG", "..."],
     "remove": [ { "file": "...", "reason": "Dublette von IMG_0011 in derselben Szene" } ],
     "bringBack": [ { "file": "...", "reason": "einzige Aufnahme der ganzen Gruppe am Tisch" } ],
     "sceneNotes": [ { "sceneId": "...", "note": "Umzug nur mit 1 Bild vertreten, verdient 3" } ] }
   ```
   Für `familie` zusätzlich Michaels Liste als `michael-unverzichtbar.txt` daneben kopieren (nur Dateinamen).
8. **Protokoll** `protokoll-<name>.md`: Fotos/HEIC/GPS, Laufzeit gesamt und je Stufe, Backend (GPU/WASM laut Diagnose-Metadaten), Zahl Auto-Picks, Auffälligkeiten in zehn Zeilen Klartext.
9. Commit je Bibliothek: `auftrag(A-002): <name> — Lauf + Exporte + Proxy-Review`.

## Optional (nur wenn Zeit): Determinismus-Beleg
Für `natur` nach Abschluss die Seite neu laden und im Review „Auswahl neu berechnen" ohne Änderung ausführen; `selection.json` erneut exportieren als `selection-rerun.json`. Gleiche Auswahl erwartet.

## Ergebnis
`docs/auftraege/A-002.ergebnis.md`: Tabelle je Bibliothek (Fotos, Laufzeit, Picks, Backend), Pfade der Artefakte, was nicht ging, grobe erste Eindrücke des Proxy-Reviewers (drei Sätze je Bibliothek). Status `FERTIG`. Push auf `auftrag/A-002`.

## Bewusst nicht
Kein App-Code, keine Einstellungen außer Default, keine manuellen Overrides in der App, keine Bilder/Thumbnails/EXIF im Repo, keine Interpretation der Ursachen (das macht die Cloud-Seite mit Blick auf alle drei Läufe).

## Datenschutz
`diagnose.json` enthält laut App-Beschreibung keine Bilder, Thumbnails, Embeddings, GPS- oder EXIF-Rohfelder, aber Dateinamen und englische Bildbeschreibungen. Wer das nicht im Repo haben will, meldet es vor dem Push (`ENTSCHEIDUNG:`).
