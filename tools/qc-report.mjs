// Print the QC report for saved PoseSequence JSON files.
// Usage: node tools/qc-report.mjs <pose.json> [...]
import fs from 'node:fs';
import { assessQuality } from '../src/pose/quality.js';

for (const file of process.argv.slice(2)) {
  const seq = JSON.parse(fs.readFileSync(file, 'utf8'));
  const qc = assessQuality(seq);
  console.log(`\n${file}\n  level=${qc.level} frames=${qc.frames}`);
  for (const c of qc.checks) if (c.status !== 'pass') console.log(`  ${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.reason}`);
  for (const j of qc.jumps) console.log(`  jump @t=${j.t} speed=${j.speed.toFixed(1)} T/s scale=${j.scaleRatio.toFixed(2)}`);
}
