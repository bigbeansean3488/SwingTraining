# CLAUDE.md

Guidance for Claude Code working in this repo.

## Communication
- Discuss with the user in Traditional Chinese (繁體中文). Code, comments, commits, and docs in English.

## Project constraints (V0)
- Static, local-first web app for iPhone Safari. No backend, no auth, no cloud DB, no LLM, no paid services.
- No bundler: native ES modules, deployable to GitHub Pages as-is. MediaPipe Tasks Vision loaded from CDN.
- Dev server: `python -m http.server 8000`. Node may not be installed on the dev machine.
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
1. Video input (upload, playback, metadata)
2. Pose estimation (MediaPipe, skeleton overlay, visibility)
3. Pose quality control
4. Normalization (+ docs/metric-definitions.md, unit tests)
5. Individual metrics (head, stride, wrist path, timing)
6. Multi-swing comparison (baseline of previous N valid swings)
7. Composite motion consistency score
8. Contact quality label (Good / Medium / Poor)
9. Practice UX loop
10. Real iPhone validation (daylight + night field)
