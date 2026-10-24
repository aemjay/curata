# A-002 Protokoll — nz

Quelle: `D:\Claude\Gemma\testbilder\NZ` (Ersatz für `familie`; kein Personen-dominanter Ordner verfügbar). 2264 Fotos, Sony RX100/RX100 VI, Reise 21.02.–22.03.2019 laut EXIF (Kamerazeit); dazu 6 Bilder vom 01.01.2018 (zurückgesetzte Uhr) und 5 ohne Datum.

| Kennzahl | Wert |
|---|---|
| Fotos / HEIC / GPS (Chips) | 2264 / 0 % / 47 % |
| Fehlerhafte Fotos | 0 |
| Backend (runMetadata) | Grafikbeschleunigung (WebGPU, RTX 4080, Chrome 155 headless) |
| Laufzeit Pipeline gesamt | 21,1 min (Upload bis „Fotos geladen": 30 s) |
| je Stufe (fertig bei, Auflösung 1 min) | Technik, Kapitel, Gesichter, Personen-IDs (übersprungen) 1,1 · Ähnlichkeit 2,1 · **VLM 21,1** (754 Bilder, ≈ 1,5 s/Bild) · Szenen + Auswahl 21,1 |
| Kapitel / Szenen | **40** / 68 (Reise ≈ 30 Tage) |
| Kandidaten / Auto-Picks | 754 / **447** (20 %) |
| Verwürfe nach Grund | duplicate 1510 · stream 270 · budget 35 · redundant 2 |
| Streams der Picks | P 7 · S 430 · M 10 (P und M „rare") |
| Beat-Abdeckung | 80 / 195 |

## Auffälligkeiten (Klartext, ohne Ursachenanalyse)
1. **40 Kapitel für ≈ 30 Reisetage.** Kapitelgrenzen liegen bei 00:00 Kamerazeit; viele Kapitel enthalten nur Aufnahmen zwischen 00 und 05 Uhr Kamerazeit bzw. kurz vor/nach Mitternacht (z. B. K20 21:35–23:54 → K21 00:03–00:07). Zusammengehörige Orte verteilen sich so auf zwei Kapitel (Pancake Rocks K26/27, Gletscher K28/29, Milford K31–33).
2. **Kapitel 21 ohne einen einzigen Pick:** seine 7 Bilder gehören zum Dubletten-Cluster c0467 (70 Bilder über K20/K21), aus dem nur `_DSC8378` gepickt ist. (Lokal an diagnose.json geprüft.)
3. K1 = 6 Bilder mit Datum 01.01.2018 (Kamera-Uhr), K40 = 5 Bilder ohne Datum — Randkapitel aus Datenfehlern.
4. Szenen-Granularität: scene-32-1 umfasst 328 Bilder (mind. fünf inhaltliche Szenen) bei 22 Picks; weitere Großszenen 201/163/154 Bilder.
5. Personen-Stream P nur 7 Picks von 447; Proxy (K21–40): stärkste Personenmomente verworfen (Paar-Selfie vor Mitre Peak, schlafende Person am Cafétisch), dafür viele ähnliche Fels-/Farn-/Vogel-/Sand-Details.
6. VLM-Caption fehlt für alle 1510 Dubletten (VLM läuft nur über Kandidaten) — kein Einzelfehler.
7. Proxy-Review vollständig, in zwei Dateien: Kapitel 1–20 `proxy-review.teil1.json` (18 unverzichtbar, 65 remove, 30 bringBack, 34 sceneNotes; gegen diagnose.json geprüft) und Kapitel 21–40 `proxy-review.teil2.json` (15 / 55 / 14 / 15). Zusammen 120 von 447 Picks zur Entfernung vorgeschlagen, 44 verworfene Bilder zurückgeholt. Wiederkehrend: Landschafts-/Detailserien zu dicht (Waimangu 24 Picks, Küstenserie Fähre 15 fast gleiche), Personenmomente und Highlights (türkiser Kratersee, Huka Falls, Kiwi im Zoo — dort 6 Infotafeln, kein Kiwi-Bild) unterrepräsentiert.
8. Konsole: wie bei den anderen Läufen (1 `pageerror` beim Upload, ONNX-/MediaPipe-Hinweise, `favicon.ico`-404).
9. Lauf beim ersten Versuch stabil; 2264 Fotos in 21 min auf GPU.
10. Ordner ist eine Reise, kein Familienordner; Michaels Unverzichtbar-Liste existiert nicht → kein Abgleich mit echter Nutzer-Wahrheit.

## Artefakte
`chips.json`, `start-nz.png` (ohne Fotos), `lauf-nz.log`, `konsole.txt`, `selection.json`, `diagnose.json`, `proxy-review.teil1.json`, `proxy-review.teil2.json`.
Review-Screenshots (zeigen Fotos) liegen **nicht** im Repo: `D:\Claude\Curata-Diagnose\_privat\nz\`.
