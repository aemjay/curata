# Ablaufplan — von heute bis zum Release-Kandidaten RC1

**Stand:** 2026-10-22 · **Status:** Entwurf, wartet auf Entscheidungen D1–D4 (Abschnitt 5)
**Basis:** `docs/konzept/KONZEPT-Pipeline-SoT.md` (v8), `docs/GOVERNANCE.md`, Code-Stand `main` (bc299ef)
**Lesart:** Jeder Schritt beginnt mit dem, was er für die Nutzerin oder den Nutzer bedeutet („Für den Nutzer"). Danach folgt, was Michael tut, und zuletzt die technische Umsetzung als Anhang. Wer nur die Nutzer-Sicht braucht, liest nur die ersten beiden Blöcke je Schritt.

---

## 1. Wo der Nutzer heute steht

Jemand mit einem Urlaubsordner voller Fotos bekommt heute von Curata eine **begründete Vorauswahl**: Die App sortiert nach Tagen und Situationen, erkennt Unschärfe, geschlossene Augen und Doppelaufnahmen, wählt pro Situation die stärksten Bilder und erklärt zu jedem Bild, warum es drin ist. Der Nutzer korrigiert im Review, stellt an vier Reglern nach und exportiert die Auswahl als Ordner plus Kontaktbogen.

**Was der Nutzer heute noch nicht bekommt:** einen Text zum Bild oder Kapitel, eine Seite, ein Buch. Er bekommt auch keine Garantie, dass jede wichtige Person vorkommt, und die App kennt seine Absicht nicht (Hochzeitsreise oder Wanderurlaub, wer ist wichtig, was soll raus). Bei mehreren Ordnern oder einzelnen Handyfotos muss er heute vorher selbst zusammenkopieren.

**Was wir verlässlich wissen:** Die Auswahlqualität ist auf **einer** Landschafts-Bibliothek gemessen und war dort gut. Ob sie bei Stadt- oder Familienfotos genauso gut ist, wissen wir nicht.

---

## 2. Was RC1 für den Nutzer ist (Vorschlag — Entscheidung D1)

**RC1 = Curata 1.0: Ein Nutzer wirft seine Fotos hinein, auch aus mehreren Quellen, lässt die App rechnen, korrigiert in einer Stunde statt in einem Wochenende, und erhält am Ende ein fertig gegliedertes Buch-Gerüst mit Kapiteln, Situationen, Bildreihenfolge und Überschriften-Vorschlägen, das er in einen Fotobuch-Dienst oder ein Layoutprogramm übernehmen kann.**

| Das kann der Nutzer mit RC1 | Das kann er bewusst noch nicht (2.0) |
|---|---|
| Mehrere Ordner und einzelne Dateien kombinieren und Bilder vor dem Rechnen aussortieren | Fertige Seiten oder ein druckbares PDF aus der App bekommen |
| Sich auf die Auswahl verlassen, auch bei Stadt- und Familienfotos, nicht nur bei Landschaft | Von der App formulierte Bildunterschriften und Kapiteltexte in Buchqualität |
| Einen langen Lauf (1000+ Bilder) laufen lassen, Tab wechseln, Laptop zuklappen, später weitermachen | Personen mit Namen wiederfinden (nur, falls die Messung zeigt, dass es nötig ist) |
| Sehen, ob die App gerade im schnellen oder im langsamen Modus rechnet, und warum | Ortsnamen aus dem Internet (nur bei D5 = ja) |
| Kapitel und Situationen mit sinnvollen Überschriften-Vorschlägen exportieren | Handy-Bedienung, Videos, Lernen aus Korrekturen |

Erst mit D1 ist dieser Rahmen verbindlich. Danach gilt: Was nicht in der linken Spalte steht, kommt nicht vor RC1.

---

## 3. Die nächsten drei Schritte

### Schritt 1 — Das Fundament absichern

**Für den Nutzer:** Unsichtbar. Der Nutzer merkt von diesem Schritt nichts, aber alles Folgende hängt daran: Ohne ihn können Änderungen an den sensiblen Teilen der App (Datenbank, Auswahl-Logik) unbemerkt durchrutschen, und ein Fehler dort würde ihm eine Auswahl liefern, die sich nach einem Update plötzlich anders verhält.

**Warum jetzt:** Die Schutzmechanik aus `GOVERNANCE.md` ist angelegt, aber nicht scharf: Das Vergleichs-Tag `baseline` fehlt, also prüft der Wächter nichts. Das Konzept für Schritt 3 liegt nicht im Repo. Die Projektanweisungen führen erledigte Punkte noch als offen.

**Michael tut:** Datei `KONZEPT-Kuratierung-Phase-A-v6.7` suchen und bereitstellen. D1 und D2 entscheiden. Benennen, welche Praktiken aus Jungle Jiggle zusätzlich gelten sollen. Aufwand ca. 1 Stunde.

**Ergebnis, an dem man es erkennt:** Der Wächter meldet in der CI aktiv „keine geschützten Pfade geändert" statt „übersprungen". Alle Entscheidungen stehen in `docs/DECISIONS.md`.

<details><summary>Umsetzung (technisch)</summary>

1. `git tag baseline bc299ef` setzen und pushen; CI-Lauf zeigt frozen-guard aktiv.
2. `KONZEPT-Kuratierung-Phase-A-v6.7.md` nach `docs/konzept/`. Falls nicht mehr vorhanden: Rekonstruktions-Auftrag (Risiko R1).
3. `CLAUDE.md` „Aktueller Stand & offene Punkte" und `README.md` Zeile 44 auf v8/SoT-Dateiname ziehen; erledigte Punkte streichen.
4. Beat-Grammatik: SoT §3 nennt fünf Beats, `s6_select.js:72` seedet nur `establishing` und `hero`. D2 entscheidet: dokumentierte Vereinfachung (Empfehlung) oder Lücke.
5. RC1-Definition nach D1 in `docs/DECISIONS.md` und SoT-Kopf.
6. Dateien anlegen: `docs/DECISIONS.md`, `docs/PARKPLATZ.md`, `docs/review/TEMPLATE-ChatGPT-Review-Paket.md`, `docs/status/TEMPLATE-Testanleitung.md`.
7. Jungle-Jiggle-Praktiken in GOVERNANCE.md nachtragen.

Branch `chore/governance-close`. Gates: G3, G4 (verify.sh); G2 optional. DoD: `git tag -l baseline` nicht leer; CI-Log „frozen-guard: keine FROZEN-Pfade geaendert"; `grep -c "v7-v10" CLAUDE.md README.md` = 0; Phase-A-Datei vorhanden oder D-Eintrag; D1/D2 protokolliert. Aufwand Claude 1 Session. Bewusst nicht: kein App-Code, kein CSS.
</details>

### Schritt 2 — Herausfinden, wo die Auswahl den Nutzer im Stich lässt

**Für den Nutzer:** Das ist der Schritt, der entscheidet, ob Curata für *seine* Fotos funktioniert und nicht nur für Landschaftsurlaube. Am Ende wissen wir, woran es liegt, wenn der Nutzer im Review viel korrigieren muss: Wirft die App das einzige Bild von Oma mit Enkel weg, weil es leicht unscharf ist? Wählt sie drei fast gleiche Fotos vom selben Platz? Fehlt ihr, dass die Hochzeitsgesellschaft wichtiger ist als die Aussicht? Jede dieser Ursachen braucht eine andere Reparatur, und wir bauen erst, wenn wir wissen, welche.

**Warum jetzt:** Sonst investieren wir Wochen in die falsche Verbesserung. Das Projektkonzept selbst fordert „erst messen, dann bauen", und bisher gibt es nur eine Messung.

**Michael tut (automatisiertes Modell seit A-001):** Drei möglichst verschiedene Urlaubsordner mit je mindestens 300 Fotos unter `D:\Claude\Curata-Diagnose\` ablegen (stadt, familie, natur) und für **einen** Ordner vorab 10 bis 20 Dateinamen notieren, die „unbedingt ins Buch" müssen. Die Läufe, Exporte und ein Stellvertreter-Review macht die lokale Claude-Session nach Auftrag A-002. Aufwand Michael ca. 1 Stunde; Rechner muss während der Läufe wach bleiben.

**Ergebnis, an dem man es erkennt:** Ein Befundbericht in Klartext, der für jede Bibliothek sagt, wie viel der Nutzer korrigieren musste, welche „Unverzichtbar"-Bilder die App verworfen hat und welche Ursache dominiert. Daraus folgt die Entscheidung D3, was im Qualitätsblock zuerst gebaut wird.

<details><summary>Umsetzung (technisch)</summary>

1. Pre-Check: `diagnose.json` enthält `selectParams` (τ_auto/τ_eff/Slider), Reject-Gründe je Bild, Szenen-/Cluster-IDs, Override-Richtung, `momentScore`-Verteilung? Fehlendes als kleines Delta an `ExportScreen.js` **vor** den Läufen.
2. Läufe mit Default-Presets (Vergleichbarkeit). Exporte nach `docs/status/diagnose/` (ohne Bilddaten).
3. Auswertung per Skript im Scratchpad: Override-Quote, Richtung, Anteil unverzichtbar-verworfen, Reject-Grund-Verteilung, Fehlfall-Klassen (Technik / Person / Cluster-Repräsentant / Beat / Kontext), Score-Kompression (Median/p80/max), τ_auto-Lage vs. Floor. Bericht `docs/status/DIAGNOSE-2026-<MM>.md`.
4. D3 nach SoT §14.C: Personen dominieren → E11 vor; Redundanz/Intent dominieren → Candidate Expansion + Intent Brief vor; Kompression dominiert → Score-Rebalancierung (FROZEN `W_*`, D-Eintrag).
5. G2: Bericht als ChatGPT-Paket (Prüffrage: Ursachen belegt oder interpretiert?).

DoR: Schritt 1 gemerged. Branch nur für Pre-Check-Delta. Aufwand Claude 2 Sessions. Bewusst nicht: kein Konstanten-Tuning, keine Preset-Experimente.
</details>

### Schritt 3 — Fotos aus mehreren Quellen zusammenstellen und vorher aussortieren: **verifizieren, nicht neu bauen**

**Korrektur vom 2026-10-22 (Code-Befund):** Das SoT führt diese Fähigkeit als „beauftragbar, noch nicht realisiert". Der Code enthält sie aber bereits: `hydrateWorkset`/`applyWorksetMutation` (`ingest.js`), `REMOVE_PHOTOS` und `worksetEpoch`/`worksetRevision` (`app.js`, `db.js`, `runner.js`), und der Startbildschirm zeigt „Ordner hinzufügen / Dateien hinzufügen / entfernen" (Screenshot A-001). Das SoT ist an dieser Stelle veraltet. Schritt 3 schrumpft deshalb von „bauen" auf „prüfen und dokumentieren".

**Für den Nutzer:** Er kann heute offenbar schon einen Ordner wählen, einen zweiten dazulegen, einzelne Handyfotos ergänzen und Bilder vor dem Rechnen entfernen. Was fehlt, ist die Gewissheit, dass das in allen Randfällen hält: Seite mitten im Hinzufügen neu laden, altes Projekt öffnen, zwei Tabs gleichzeitig. Genau das klärt dieser Schritt.

**Michael tut:** Phase-A-Konzeptdatei bereitstellen (ohne sie kann nur gegen den Code, nicht gegen die versprochenen Regeln geprüft werden). Abnahme nach Testanleitung, ca. 1 Stunde, mit den Pflichtfällen: Ordner und Einzeldatei mischen; Foto entfernen, dann rechnen; mitten im Hinzufügen neu laden; altes Projekt öffnen, nichts darf fehlen; zwei Tabs.

**Ergebnis, an dem man es erkennt:** Ein Verifikationsbericht mit Lücken-Liste. Keine Lücken: SoT auf „realisiert" gezogen, Schritt fertig. Lücken: jede Lücke wird ein kleines eigenes Delta mit eigenem Branch (FROZEN-Berührung dann per D4).

<details><summary>Umsetzung (technisch)</summary>

1. `independent-verifier` prüft den Code gegen `KONZEPT-Kuratierung-Phase-A-v6.7` (Lifecycle-Tests A–H, §4.10-Zustandsmatrix, Reset-Scope, Legacy-Migration). Ohne Konzeptdatei: Prüfung gegen SoT §10.3/§10.5 Zielvertrag.
2. Lokaler Auftrag (Postfach): Playwright-Durchlauf der Pflichtfälle inkl. Reload mitten in `applyWorksetMutation`, zwei Tabs, Legacy-Bestand (vor Phase A erzeugte IndexedDB) öffnen.
3. SoT-Reconciliation: §10.3 „BIS/AB Phase A", §11 „Nächste Etappe", Changelog, Kopf; `KONZEPT-Presets-Initial` §1 Scope-Hinweis.
4. Lücken → je ein Branch `fix/workset-<lücke>`, D4 nur bei FROZEN-Berührung.

DoR: Schritt 1 gemerged. Aufwand Claude 1–2 Sessions. Bewusst nicht: keine Funktionserweiterung über das Konzept hinaus, keine Mehrfach-Projekte.
</details>

---

## 4. Schritte 4 bis 7 bis RC1 (grob)

| # | Schritt | Für den Nutzer | Woran man den Erfolg erkennt | Aufwand Claude |
|---|---|---|---|---|
| 4 | **Auswahlqualität** (Reihenfolge nach D3) | Er muss im Review deutlich weniger korrigieren, und seine „Unverzichtbar"-Bilder bleiben drin. Je nach Befund: die App reicht pro Situation mehrere Kandidaten statt eines durch, fragt ihn vorab nach Reiseart, wichtigen Personen und Ausschlüssen, oder erkennt wiederkehrende Personen. | Auf denselben drei Bibliotheken sinkt der Korrekturanteil messbar, kein „Unverzichtbar"-Bild verworfen | 4–6 Sessions |
| 5 | **Verlässlichkeit bei langen Läufen** | Er kann 1000 Bilder rechnen lassen, nebenbei surfen, den Laptop zuklappen und morgen weitermachen. Die App bleibt dabei bedienbar und sagt ehrlich, wenn sie gerade im langsamen Modus läuft oder einen Schritt nicht leisten konnte. | Ein 1000-Bilder-Lauf übersteht Tab-Wechsel und Standby; keine eingefrorene Oberfläche | 3–4 Sessions |
| 6 | **Vom Auswahl-Export zum Buch-Gerüst** | Statt einer Bilderliste bekommt er ein Gerüst: Kapitel mit Datum und Ort, darunter Situationen mit Überschriften-Vorschlägen („Nachmittag am Hafen"), darunter die Bilder in Buchreihenfolge mit ihrer Rolle (Aufmacher, Hero). Das kann er direkt in ein Fotobuch-Programm übertragen. Ortsnamen aus dem Internet nur, falls D5 das erlaubt. | Übernahme in ein Layoutprogramm ohne Umsortieren; Überschriften sind brauchbar, nicht peinlich | 2–3 Sessions (+2 bei Geo) |
| 7 | **Reif für Fremde** | Jemand, der die App noch nie gesehen hat, kommt ohne Erklärung durch: versteht den ersten Modell-Download, versteht, warum nach einem Neuladen der Ordner erneut gewählt werden muss, bekommt verständliche Fehlermeldungen. | Drei Bibliotheken bestehen das Abnahmekriterium (höchstens 30 % Korrekturen, nichts Unverzichtbares verworfen); Michael nimmt den Gesamtfluss ab; Deploy mit Tag `rc1` | 2–3 Sessions |

**Nach RC1 (Fernziel, hier nur abgegrenzt):** Soll die App selbst Texte schreiben und ein Buch gestalten, braucht sie ein Sprachmodell. Das ist die Weggabelung D6: lokal im Browser (groß, langsam, auf vielen Rechnern nicht möglich) oder über einen Dienst (schnell, gut, aber die Fotos-bleiben-bei-dir-Zusage bricht). Erst danach: Seitenmodell, Layout, PDF, Bildunterschriften.

---

## 5. Entscheidungen (offen, für Michael)

| ID | Frage in Nutzerworten | Empfehlung | Fällig |
|---|---|---|---|
| D1 | Ist RC1 das Buch-Gerüst aus Abschnitt 2, und kommt „mehrere Quellen" vor „bessere Auswahl"? | Ja zu beidem | Schritt 1 |
| D2 | Das Konzept verspricht fünf Bildrollen pro Situation (Aufmacher, Aktion, Detail, Hero, Übergang), die App vergibt nur zwei. Vorerst akzeptieren oder als Lücke führen? | Akzeptieren und dokumentieren; erweitern nur, wenn Schritt 2 zeigt, dass dem Nutzer deshalb Bilder fehlen | Schritt 1 |
| D3 | Was wird zuerst besser: Kandidatenvielfalt, Absichtsabfrage oder Personenerkennung? | nach Befundbericht | Ende Schritt 2 |
| D4 | Darf das Herz der App (Speicherung, Arbeitsmenge) für Schritt 3 angefasst werden? | Ja, mit Marker und erneutem Audit | Beginn Schritt 3 |
| D5 | Darf die App für Ortsnamen ins Internet (Opt-in, nur gerundete Koordinaten)? | Nein vor RC1 | vor Schritt 6 |
| D6 | Sprachmodell lokal, über Dienst oder gar nicht? | Nach RC1 | nach RC1 |

---

## 6. Arbeitsmechanik (Anhang)

### 6.1 Rollen
| Rolle | Wer | Inhalt |
|---|---|---|
| Product Owner | Michael | Produkt-, Legal-, Effort- und FROZEN-Entscheidungen; Scope-Freeze je Schritt; UI/UX-Abnahme nach Testanleitung; Relais zum externen Reviewer (ChatGPT) |
| KONZEPT-Autor + Implementierer | Claude | KONZEPT-first, Failure-Mode-Pass, Implementierung (ein Delta je Branch), Testanleitung für Michael |
| Interner Reviewer | Subagent `konzept-reviewer` | Audit KONZEPT gegen Code vor Beauftragung |
| Interner Verifizierer | Subagent `independent-verifier` | Audit Diff gegen DoD/FROZEN/`baseline` vor Merge |
| Externer Reviewer | ChatGPT (über Michael) | Zweite, modellfremde Meinung auf KONZEPT und Abnahmebericht |
| Mechanische Gates | `verify.sh`, `frozen-guard.sh`, CI, PreToolUse-Hook | teilen keine Annahmen |

### 6.2 Gate-Kette je Schritt
```
G0 DoR  →  KONZEPT  →  G1 konzept-reviewer  →  G2 ChatGPT-Review-Paket  →  G3 Freigabe Michael (= Scope-Freeze)
→ Implementierung  →  G4 verify.sh + independent-verifier + CI  →  G5 UI/UX-Abnahme Michael (Testanleitung)
→ Merge --no-ff  →  git tag -f baseline  →  STATUS-Notiz
```
G2: Claude erzeugt ein selbsttragendes Paket (`docs/review/<schritt>-paket.md`), Michael pastet es, Claude prüft jeden Befund am Code und dokumentiert Annahme oder Widerlegung. G5 nur bei sichtbarer UI-Wirkung.

### 6.3 Anti-Mission-Creep
1. Scope-Freeze bei G3; Änderung nur per Änderungsantrag an Michael (Problem → Grund → Konsequenz).
2. Ideen gehen datiert nach `docs/PARKPLATZ.md`, Sichtung nur an Schrittgrenzen.
3. „Bewusst nicht"-Liste in jedem KONZEPT und PR-Body.
4. Ein offener Implementierungsbranch gleichzeitig.
5. Messbares Ergebniskriterium je Schritt.
6. Entscheidungslog `docs/DECISIONS.md`.
7. FROZEN nur mit `FROZEN-CHANGE:`-Marker nach D-Eintrag.

### 6.4 Codequalität je Delta
`verify.sh`, CI und frozen-guard grün; Full-File-Read vor Spezifikation; Failure-Mode-Pass über sieben Achsen; keine neuen Laufzeit-Abhängigkeiten ohne D-Eintrag; kein toter Code; Determinismus-Gate bei Segmentierung/Solver.

### 6.5 Bezug Jungle Jiggle
Keine Artefakte im Repo; Mechanik aus `GOVERNANCE.md` abgeleitet und erweitert. Offen: Michael nennt zusätzlich zu übernehmende Praktiken (Schritt 1, Punkt 7).

---

## 7. Risiken

| ID | Risiko | Für den Nutzer | Gegenmaßnahme |
|---|---|---|---|
| R1 | Phase-A-Konzept nicht mehr auffindbar | „Mehrere Quellen" kommt später | In Schritt 1 klären; notfalls Qualitätsblock vorziehen |
| R2 | Diagnose-Bibliotheken zu ähnlich | Wir verbessern das Falsche | Drei klar verschiedene Charaktere, mindestens 300 Bilder |
| R3 | Umbau in Schritt 3 verändert bestehende Auswahlen | Vertrauensverlust nach Update | Gleiche Auswahl bei gleichem Bestand als Pflichtprüfung |
| R4 | Worker-Umbau (Schritt 5) destabilisiert Modell-Laden | App startet auf manchen Rechnern nicht | Spike vorab; Rückfall auf heutigen Pfad bleibt |
| R5 | Fernziel-Ideen (Layout, Texte) fließen vorzeitig ein | RC1 verzögert sich | Parkplatz, Scope-Freeze, Abschnitt 2 |
| R6 | ChatGPT-Befunde ungeprüft übernommen | Falsche Korrekturen | Prüfung am Code ist Pflicht |

---

## 8. Sofort nächste Aktion
Nach Michaels Antwort auf D1 und D2 startet Schritt 1. Michael: Phase-A-Datei suchen, Jungle-Jiggle-Praktiken benennen.
