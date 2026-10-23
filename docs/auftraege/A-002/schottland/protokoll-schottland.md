# A-002 Protokoll — schottland

Quelle: `D:\Claude\Gemma\testbilder\Schottland` (Ersatz für `stadt`). 856 Dateien `Raw00001–Raw00856.jpg`, gemischte Quellen: 780 × Sony DSC-RX100 mit Datum (Mai 2017), 39 × ohne EXIF-Aufnahmedatum (Raw00069–Raw00167), 1 × Canon G12, 36 × Canon EOS 100D. Kein GPS.

| Kennzahl | Wert |
|---|---|
| Fotos / HEIC / GPS (Chips) | 856 / 0 % / 0 % |
| Fehlerhafte Fotos | 0 |
| Backend (runMetadata) | Grafikbeschleunigung (WebGPU, RTX 4080, Chrome 155 headless) |
| Laufzeit Pipeline gesamt | 9,1 min (Upload bis „Fotos geladen": 10 s) |
| je Stufe (fertig bei, Auflösung 1 min) | Technik + Kapitel 0,1 · Gesichter, Personen-IDs (übersprungen), Ähnlichkeit 1,1 · **VLM 9,1** (307 Bilder) · Szenen + Auswahl 9,1 |
| Kapitel / Szenen | 10 / 25 |
| Kandidaten / Auto-Picks | 307 / **221** (26 %) |
| Verwürfe nach Grund | duplicate 549 · stream 85 · budget 1 · redundant 0 |
| Streams der Picks | P 1 · S 214 · M 6 (P und M „rare") |
| Beat-Abdeckung | 29 / 50 |

## Auffälligkeiten (Klartext, ohne Ursachenanalyse)
1. **Kapitel 10 = exakt die 39 Bilder ohne EXIF-Datum** (Raw00069–Raw00167); motivisch dieselbe Wanderung wie Kapitel 9, viele um 90° gedreht. 13 Picks dort motivgleich mit Kapitel 9. (Von der lokalen Session gegen EXIF geprüft.)
2. Kapitel 7 (Canon G12/EOS 100D: Familienfeier/Kirche) und Kapitel 8 (Falknerei mit Kindern) sind andere Ereignisse im selben Ordner; die App bildet daraus eigene „Tage" — erwartbar, aber für den Nutzer ein Hinweis, dass fremde Ereignisse im Ordner landen.
3. Wieder nur **1 Bild** im Personen-Stream P; über „stream" verworfen werden u. a. Gipfelmomente mit Person (Raw00049, Raw00769), nahe Porträts (Raw00417, Raw00671, Raw00750), die Brücke an der Steilküste (Raw00311).
4. Mehrfachmotive: Grasnelken, Person auf dem Fels, Dolmen, Torfstich, Blumen-Makros je 2–4×.
5. 2 defekte Moiré-Bilder (Raw00596, Raw00060) gepickt.
6. Szenen-Granularität ungleich: scene-4-0/4-2/4-3 zerstückelt, scene-4-1 und scene-8-0 mit > 100 Bildern zu grob.
7. Proxy: 25 unverzichtbar, 81 remove, 11 bringBack.
8. Proxy-Beobachtung (unbestätigt, nicht in JSON): Kapitel 1–6 wirken motivisch eher wie Irland („.ie"-Busse, Kalkstein-Karst) — Ordnername evtl. ungenau; für die Diagnose ohne Belang.
9. Konsole: wie Südengland (1 `pageerror` beim Upload „Cannot set properties of null (setting 'value')", ONNX-/MediaPipe-Hinweise, `favicon.ico`-404).
10. Lauf beim ersten Versuch stabil durchgelaufen.

## Artefakte
`chips.json`, `start-schottland.png` (ohne Fotos), `lauf-schottland.log`, `konsole.txt`, `selection.json`, `diagnose.json`, `proxy-review.json`.
Review-Screenshots (zeigen Fotos) liegen **nicht** im Repo: `D:\Claude\Curata-Diagnose\_privat\schottland\`.
