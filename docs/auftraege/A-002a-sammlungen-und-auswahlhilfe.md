```
Auftrag:   A-002a
Titel:     Diagnose-Sammlungen aus D:\Claude\Gemma\testbilder zusammenstellen + Klick-Auswahlhilfe für Michael
Ziel:      lokal
Status:    OFFEN
Erstellt:  2026-10-23 (Cloud-Session)
Branch:    auftrag/A-002
Vorstufe zu: A-002 (dort Status ENTSCHEIDUNG → nach A-002a auf LÄUFT setzen)
```

## Zweck
Michael hat keine fertig sortierten Reiseordner. Die lokale Session stellt die drei Diagnose-Sammlungen aus `D:\Claude\Gemma\testbilder` selbst zusammen und baut Michael eine einfache Seite im Browser, auf der er die „unverzichtbaren" Bilder des Familien-Ordners per Klick markiert. Nichts aus `testbilder` wird verändert; es wird nur kopiert.

## Teil 1 — Sammlungen bilden
1. `D:\Claude\Gemma\testbilder` rekursiv sichten: Anzahl Dateien, Formate, Aufnahmedaten (EXIF `DateTimeOriginal`, sonst Dateidatum), GPS-Anteil. Kurze Übersicht nach `docs/auftraege/A-002/testbilder-uebersicht.md` (nur Zahlen und Ordnernamen, keine Dateilisten mit Personenbezug).
2. Aufnahmen nach **Zeit** zu Reisen bündeln: Lücke > 3 Tage = neue Reise. Je Reise: Zeitraum, Fotoanzahl, GPS-Anteil, grober Charakter (per Stichprobe von 20 Thumbnails ansehen: Stadt / Personen / Natur / gemischt).
3. Drei Sammlungen wählen, möglichst verschieden, je ≥300 Fotos; wenn keine Reise 300 erreicht, die größte nehmen und das im Protokoll vermerken, nicht mehrere Reisen mischen:
   - `stadt` — Gebäude, Plätze, Sehenswürdigkeiten, eher wenige Personen
   - `familie` — fast immer Menschen im Bild
   - `natur` — Landschaft, kaum Menschen
   Gibt es keinen passenden Kandidaten für einen Typ: die nächstbeste Reise nehmen und den tatsächlichen Charakter im Protokoll nennen. Zwei Sammlungen sind besser als keine.
4. Kopieren nach `D:\Claude\Curata-Diagnose\<name>\` (Originale unverändert, keine Vorauswahl, keine Dubletten entfernen). Begründung der Wahl in `docs/auftraege/A-002/sammlungen.md`: je Sammlung Zeitraum, Anzahl, Charakter, warum gewählt.

## Teil 2 — Klick-Auswahlhilfe für Michael (nur `familie`)
1. Thumbnails (max. 400 px Kante) aller Fotos der Sammlung `familie` nach `D:\Claude\Curata-Diagnose\_auswahlhilfe\thumbs\` (außerhalb des Repos; HEIC mit pillow-heif oder ImageMagick).
2. Eine einzelne Datei `D:\Claude\Curata-Diagnose\_auswahlhilfe\index.html` bauen, ohne Abhängigkeiten, die über `python -m http.server` aus diesem Ordner läuft:
   - Raster aller Thumbnails in Aufnahmereihenfolge, Datum als Zwischenüberschrift je Tag.
   - Klick auf ein Bild = markiert (Rahmen + Haken), nochmal Klick = zurück. Zähler oben: „12 von 10–20 markiert".
   - Button „Liste speichern": lädt `familie-unverzichtbar.txt` herunter (ein Dateiname je Zeile, Original-Dateiname, nicht Thumbnail-Name). Markierungen zusätzlich in `localStorage`, damit ein Reload nichts verliert.
   - Kurzer Hinweis oben: „Markiere 10–20 Fotos, die auf keinen Fall im Fotobuch fehlen dürfen. Bauchgefühl, nicht Technik. Danach ‚Liste speichern' und die Datei nach D:\Claude\Curata-Diagnose\ legen."
3. Server starten und Michael in der Session die Adresse nennen (z. B. `http://localhost:8010`). Dann **anhalten** mit Status `ENTSCHEIDUNG: Michael markiert familie-unverzichtbar`, committen, pushen.

## Nach Michaels Liste
Sobald `D:\Claude\Curata-Diagnose\familie-unverzichtbar.txt` existiert: diesen Auftrag auf `FERTIG`, A-002 auf `LÄUFT` setzen und A-002 vollständig ausführen.

## Bewusst nicht
Keine Bilder, Thumbnails oder Dateilisten ins Repo (nur Zahlen und Begründungen). Keine Änderung an `testbilder`. Kein App-Code.
