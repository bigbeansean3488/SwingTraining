# CLAUDE.md

Guidance for Claude Code working in this repo.

## Communication
- Discuss with the user in Traditional Chinese (繁體中文). Code, comments, commits, and docs in English.

## Project constraints (V0)
- Static, local-first web app for iPhone Safari. No backend, no auth, no cloud DB, no LLM, no paid services.
- No bundler: native ES modules, deployable to GitHub Pages as-is. MediaPipe Tasks Vision loaded from CDN.
- Dev server: `python -m http.server 8000` (or `node tools/serve.mjs 8000`).
- Storage: IndexedDB for structured data. Don't keep full videos by default.

## Architecture rules
- Layers stay separate: video → pose landmarks → signal processing → measurements → comparison → interpretation.
- `src/analysis/` is pure (no DOM, no imports from `src/ui/`) and must be unit-tested.
- Every metric returns `{ value, confidence, diagnostics }`.
- No physical units (cm, m/s, true 3D degrees) without calibration — use normalized body units and frame/relative timing.
- Fail visibly: poor tracking → "Unable to reliably analyze this swing." QC-failed swings never enter the baseline.
- No coaching claims without an explicitly validated rule.
- When a formula changes, update `docs/metric-definitions.md`.

## Workflow
- Work milestone by milestone (see below). Don't ask for confirmation on routine steps.
- One coherent commit per milestone or meaningful unit; descriptive messages.
- Don't tune metrics to make the demo look good. Record failures in `docs/validation-plan.md`.

## Milestones
0. Bootstrap ✅
1. Video input ✅
2. Pose estimation ✅
3. Pose quality control ✅
4. Normalization ✅
5. Individual metrics ✅
6. Multi-swing comparison ✅
7. Composite motion consistency score ✅ (scale provisional)
8. Contact quality label ✅
9. Practice UX loop ✅
10. Real iPhone validation — **blocked on field footage**. Follow docs/field-validation.md.

## Hard stop
Until field footage has been evaluated (docs/field-validation.md F1–F6), do NOT add:
bat detection, ball tracking, impact audio, automatic contact prediction, coaching AI,
backend, cloud DB, accounts. Never mark anything FIELD_VALIDATED without real practice footage.

## Dev commands
- Node is at `C:/Program Files/nodejs` (in Git Bash: `export PATH="/c/Program Files/nodejs:$PATH"`).
- `npm test` — unit tests (node:test, synthetic fixtures).
- `node tools/check-practice.mjs <outDir> [video start end]` — end-to-end practice loop in headless Chrome.
- `node tools/check-pose.mjs <video> <start> <end> [model] [outDir]` — pose + overlay screenshots.
- `node tools/evaluate-field.mjs <manifest.csv> <outDir>` — field-validation runner.
- `node tools/plot-analysis.mjs <out.png> <pose.json | '{"synthetic":{...}}'>` — signals/events plot.
