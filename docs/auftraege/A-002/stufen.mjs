// A-002: Stufenzeiten + Kennzahlen aus lauf-<name>.log, chips.json, diagnose.json, selection.json, konsole.txt.
// Aufruf: node docs/auftraege/A-002/stufen.mjs <name>   → JSON auf stdout. Auflösung der Stufenzeiten: 60 s (Log-Takt).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const name = process.argv[2];
const dir = join(dirname(fileURLToPath(import.meta.url)), name);
const lines = readFileSync(join(dir, `lauf-${name}.log`), 'utf8').trim().split('\n');
const ts = (l) => Date.parse(l.slice(0, 24));
const start = ts(lines.find(l => l.includes('nav=Laden gesamt')) || lines[0]);
const done = {};
for (const l of lines.filter(l => l.includes('nav=Verarbeitung'))) {
  for (const part of l.split('|')[1].split(';')) {
    const [stage, status] = part.trim().split('=');
    if (stage && /^(OK|übersprungen)$/.test(status) && !(stage in done)) done[stage] = { min: +((ts(l) - start) / 60000).toFixed(1), status };
  }
}
const endLine = lines.find(l => l.includes('Pipeline fertig nach'));
const d = JSON.parse(readFileSync(join(dir, 'diagnose.json'), 'utf8'));
const s = JSON.parse(readFileSync(join(dir, 'selection.json'), 'utf8'));
const m = d.aggregates.runMetadata;
const konsole = readFileSync(join(dir, 'konsole.txt'), 'utf8').split('\n').filter(Boolean);
const scenes = new Set(d.evidence.map(e => e.scene));
console.log(JSON.stringify({
  name,
  chips: JSON.parse(readFileSync(join(dir, 'chips.json'), 'utf8')),
  pipelineMin: endLine ? +endLine.match(/nach ([\d.]+) min/)[1] : null,
  stufenFertigBeiMin: done,
  backend: m.backend, photoCount: m.photoCount, failed: m.failedPhotoCount, chapters: m.chapterCount, scenes: scenes.size,
  picked: s.select.pickedCount, candidates: s.select.candidateCount, tau: m.tau,
  rejectReasons: d.aggregates.rejectReasonDistribution,
  streams: d.aggregates.streams.distribution.map(x => `${x.stream}:${x.count} (${x.pct}% / Ziel ${x.targetPct}%${x.rare ? ', rare' : ''})`),
  beatCoverage: `${d.aggregates.beatCoverage.covered}/${d.aggregates.beatCoverage.possible}`,
  konsole: { errors: konsole.filter(l => l.includes('[error]') && !l.includes('onnxruntime')).length, ortWarnings: konsole.filter(l => l.includes('onnxruntime')).length, pageerrors: konsole.filter(l => l.includes('[pageerror]')).length },
}, null, 2));
