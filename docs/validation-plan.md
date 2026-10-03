# Validation Plan and Log

## Hypothesis

Repeated swings from the same player have measurable pose-trajectory
consistency, and meaningful mechanical deviations (stride, head movement,
timing) can be detected from a single iPhone side-view video, including under
evening field lighting.

## Status (2026-10-03)

| Stage | Status |
|---|---|
| Synthetic / unit validation of the pipeline (M1–M9) | **Done** — 103 unit tests, browser checks (`tools/check-*.mjs`) |
| Generic real video (non-baseball) | Pose extraction + QC exercised on one indoor pitching-arcade clip; see validation-status.md |
| Field footage (tripod, side view, practice field, night) | **PENDING — no footage yet** |
| iPhone Safari on-device run | **PENDING** |

Protocol and footage requirements: [field-validation.md](field-validation.md).

## Observations so far

1. **Wrist visibility during fast arm motion** (generic throw clip): best-wrist
   visibility fell to 0.3–0.5 for ~0.8 s during the throw; QC rejects such
   segments. Expect the same risk during the swing. Not tuned — needs field
   evidence (F2).
2. **Handheld / moving camera**: the anchored body frame assumes a fixed
   camera. On the handheld generic clip, activity never settled before the
   motion, so event detection rejected the segment. Tripod use is a hard
   requirement.
3. **Desktop speed**: ~0.8–0.9 s per 4K frame (seek-bound) in headless Chrome
   with GPU delegate; ~5 s clip at 30 fps ≈ 2 min. iPhone speed unknown —
   1080p clips should seek much faster than 4K. If too slow, options are the
   lite model or a lower sampling rate (record the trade-off before changing).
4. **Head metric frame**: chosen pelvis-relative for component independence
   on synthetic data; whether this matches what coaches mean by "head
   stability" is open (F9).
5. **Consistency score scale** is provisional (half-score values) — F7.
6. **Playback scan timing** (`tools/compare-extraction.mjs`, IMG_4841.MOV
   5–7 s, headless Chrome with software GL): detection could not keep up even
   at playback rate 0.1 (16 of 30 target fps), and playback landmarks best
   matched seek frames 0.2–0.3 s *earlier* than their reported media time.
   Decision: the playback scan only locates swings (windows have ≥ 1.5 s
   margin); all metrics come from seek-per-frame extraction. Re-measure on
   iPhone Safari (F8/F10) — if playback is frame-accurate there it could
   replace the slower second pass, but only with that evidence.
7. **Segmentation false positives**: dry swings, check swings and (in the
   generic clip) throws are fast hand motions and will be listed as swings.
   The list makes deleting them one tap away; no classifier is added before
   field data (hard stop).

## Field log

_Add one entry per footage session: date, conditions, manifest, `summary.txt`
output, F1–F10 outcomes, failures observed, changes made (with the evidence
that motivated each change)._
