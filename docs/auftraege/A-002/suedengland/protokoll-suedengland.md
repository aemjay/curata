# A-002 Protokoll — suedengland

Quelle: `D:\Claude\Gemma\testbilder\Südengland` (Ersatz für `natur`; dieselbe Bibliothek wie die Feldabnahme mit 468 Fotos). Kamera Canon PowerShot G12, Juli/Aug. 2014.

| Kennzahl | Wert |
|---|---|
| Fotos / HEIC / GPS (Chips) | 468 / 0 % / 61 % |
| Fehlerhafte Fotos | 0 |
| Backend (runMetadata) | Grafikbeschleunigung (WebGPU, RTX 4080, Chrome 155 headless) |
| Laufzeit Pipeline gesamt | 11,1 min (Upload bis „Fotos geladen": 6 s) |
| je Stufe (fertig bei, Auflösung 1 min) | Technik + Kapitel 0,1 · Gesichter, Personen-IDs (übersprungen), Ähnlichkeit 1,1 · **VLM 11,1** (330 Bilder, ≈ 1,8 s/Bild) · Szenen + Auswahl 11,1 |
| Kapitel / Szenen | 26 / 39 |
| Kandidaten / Auto-Picks | 330 / **267** (57 % der Bibliothek) |
| Verwürfe nach Grund | duplicate 138 · stream 62 · budget 1 · redundant 0 |
| Streams der Picks | P 1 · S 248 · M 18 (P und M „rare") |
| Beat-Abdeckung | 60 / 130 |
| `runtimeMs` in diagnose.json | `null` (Laufzeiten nur aus `lauf-suedengland.log`) |

## Auffälligkeiten (Klartext, ohne Ursachenanalyse)
1. 267 von 468 Bildern ausgewählt — für ein Fotobuch sehr viel; Proxy schlägt 63 Entfernungen vor (→ ≈ 209).
2. Nur **1 Bild** der gesamten Bibliothek ist dem Personen-Stream P zugeordnet, obwohl viele Porträts, Selfies und Gruppenbilder vorhanden sind; „Personen-IDs" ist übersprungen (Stub).
3. Mehrfachmotive bei Personenbildern: Café-Porträts 5×, Gesichter-Aufsteller 4×, Etagenbett 3×, je zwei fast gleiche Selfies.
4. Portchester (scene-9-0): 9 abfotografierte Infotafeln gepickt, alle 3 Bilder der Person im Burgsaal verworfen.
5. Bergbaumuseum (scene-25-1/25-2): leere Räume/Maschinen dominieren; Fehlauslösungen (Asphalt, Lenker, verdrehtes Bild, Windschutzscheibe) gepickt.
6. Proxy-„unverzichtbar" (24) sind alle gepickt — die App verliert hier kaum Kernbilder, sie nimmt eher zu viel.
7. Konsole: 1 `pageerror` beim Ordner-Upload „Cannot set properties of null (setting 'value')" (Lauf lief trotzdem durch); sonst nur ONNX-/MediaPipe-Hinweise und `favicon.ico`-404.
8. Lauf-Stabilität: Versuch 1 brach bei VLM 175/323 ab (Browser von außen beendet, Ursache unbekannt, kein Absturzeintrag); Versuch 2 hing nach 100 %, weil „Review öffnen" geklickt werden muss (Skript ergänzt). Gewertet ist Versuch 3.
9. VLM-Bildzahl schwankte zwischen Versuch 1 (323) und Versuch 2/3 (330) bei identischen Eingaben und Defaults.
10. GPS-Chip zeigte im ersten Versuch direkt nach dem Laden 0 %, später 61 % — der Chip wird offenbar nachgeladen.

## Artefakte
`chips.json`, `start-suedengland.png` (ohne Fotos), `lauf-suedengland.log`, `konsole.txt`, `selection.json`, `diagnose.json`, `proxy-review.json`.
Review-Screenshots (zeigen Fotos) liegen **nicht** im Repo: `D:\Claude\Curata-Diagnose\_privat\suedengland\`.
