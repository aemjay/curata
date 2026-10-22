# Postfach — Aufträge zwischen Cloud- und lokaler Session

Beide Seiten (Cloud-Session, lokale Session auf Michaels Rechner) haben getrenntes Gedächtnis. Dieses Verzeichnis ist die einzige Übergabestelle. Regeln:

1. **Ein Auftrag = eine Datei** `A-<nnn>-<kurzname>.md` mit dem Kopfblock unten. Der Auftrag ist selbsttragend: Wer ihn liest, braucht keinen Chat-Verlauf.
2. **Status** steht nur im Kopfblock der Auftragsdatei und wird nur dort geändert: `OFFEN` → `LÄUFT` → `FERTIG` | `BLOCKIERT: <Grund>` | `ENTSCHEIDUNG: <Frage an Michael>`.
3. **Ergebnis** schreibt die ausführende Seite in `A-<nnn>.ergebnis.md` daneben (Klartext: was getan, was gefunden, was offen). Dateien, die der Auftrag erzeugt (Exporte, Screenshots), liegen unter `docs/auftraege/A-<nnn>/`. **Nie Fotos, nie Originalbilder, nie personenbezogene Daten** ins Repo.
4. **Branch:** Die ausführende Seite arbeitet auf `auftrag/A-<nnn>` und pusht dorthin. Die auftraggebende Seite holt den Branch, wertet aus und merged nach Prüfung.
5. **Sessionstart (beide Seiten):** `CLAUDE.md`, `docs/plan/ABLAUFPLAN-RC1.md`, `docs/DECISIONS.md` (falls vorhanden) und dieses Verzeichnis lesen; `git log --oneline -20`. Dann den Auftrag mit Status `OFFEN` und passendem `Ziel` übernehmen.
6. **Eine Aufgabe, ein Commit.** Jeder abgeschlossene Teilschritt wird committet. Ein Abbruch kostet höchstens einen Teilschritt.
7. **Stopp-Signale:** Bei einer Frage, die nur Michael beantworten kann, Status `ENTSCHEIDUNG:` setzen, committen, pushen, aufhören. Nicht raten.

## Kopfblock
```
Auftrag:   A-001
Titel:     ...
Ziel:      lokal | cloud
Status:    OFFEN
Erstellt:  2026-10-22 (Cloud-Session)
Branch:    auftrag/A-001
```
