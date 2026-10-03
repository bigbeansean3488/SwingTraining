# Field Validation Package

中文版：[field-validation.zh-TW.md](field-validation.zh-TW.md)

Everything in V0 is `UNIT_VALIDATED` on synthetic data at most. This document
says exactly what real footage to collect and how to evaluate it, so field
validation can start the day footage exists.

**Do not add analysis features (bat/ball tracking, audio, contact prediction,
coaching AI, backend) until this evaluation has been run.**

---

## 1. Footage to collect

### 1.1 Drill

- **Tee batting or dry swings** (no live pitching needed).
- One player per recording block. Repeat the protocol for 2–3 players if possible.

### 1.2 Camera setup

| Item | Requirement |
|---|---|
| Device | iPhone, rear main camera (1×), no zoom |
| Mount | **Tripod**, not handheld; do not touch the phone between swings |
| View | Side view from the batter's open (chest) side, roughly perpendicular to the pitcher–catcher line |
| Height | About hip height |
| Distance | Whole body incl. feet, hands at the top of the follow-through, and the stride fully inside the frame with margin. Start ~5–7 m; note the actual distance |
| Orientation | Landscape preferred (more room for the stride); note it |
| Format | 1080p at 60 fps if available (Settings → Camera → Record Video); also note if 4K/30 or slo-mo 120/240 was used |
| Clip length | **One recording per set of swings** (e.g. 10 swings, ≥ 4 s apart; the app finds every swing). Start ≥ 2 s before the first swing. Also record a few **single-swing clips** (≤ 10 s, start ≥ 1 s before the swing) to compare both paths |
| Background | Avoid other people walking behind the batter |

### 1.3 Swings

| Set | Count | Instruction to the player |
|---|---|---|
| Normal | **20–30** | Normal swing, same setup each time |
| Longer stride | 2–3 | Exaggerate the stride clearly |
| Shorter stride | 2–3 | Minimal / no stride |
| Head movement | 2–3 | Let the head move noticeably toward the pitcher / drop |
| Altered timing | 1–3 (only if safe) | Start the swing noticeably late or with a pause |

Total perturbations ≈ 5–10. Interleave perturbed swings among normal ones
(e.g. after normal swings 10, 15, 20 …) rather than recording them all at the
end, so the baseline at each perturbed swing is made of normal swings.

### 1.4 Conditions

- **Night field under stadium lighting** (the target condition) — required.
- Daylight session — if available, same protocol, for comparison.
- Optional: a deliberately bad recording (too far, handheld, partially out of
  frame) to check that QC rejects it.

### 1.5 Metadata to record (one row per clip)

Use `tools/field/manifest.example.csv` as the template:

```
file,condition,start,end,lighting,distance_m,note,expected_swings
```

For a recording, write how many swings were actually taken in
`expected_swings` (and note any dry swings / walking out of the box), so
segmentation can be checked. Put perturbed swings in their own recordings
(the condition applies to every swing in a file).

Plus once per session (in the note or a separate text file):

- device model and iOS version
- resolution and nominal fps (camera setting)
- day / night, lighting description (e.g. "infield lights only, batter in shadow")
- camera distance (m) and height, orientation (landscape/portrait)
- batting side of the player (R/L)
- drill type (tee / dry swing)
- contact outcome per swing for tee work (good / medium / poor) if judged at the time

---

## 2. How to run the evaluation

1. Copy the clips and the filled-in manifest into `data/local-videos/<session>/`
   (git-ignored; never commit videos).
2. Run:
   ```sh
   node tools/evaluate-field.mjs data/local-videos/<session>/manifest.csv out/<session> full
   ```
   This runs every clip through the real app (headless Chrome) in manifest
   order as one practice session and writes `results.csv`, `swings.json` and
   `summary.txt`.
3. Also process 5–10 clips on the **iPhone itself** (Safari, served from the
   PC or GitHub Pages) and note processing time per swing and any failures.
4. For a few swings, review the skeleton overlay visually
   (`node tools/check-pose.mjs <clip> 0 <dur> full <outDir> 12`).

---

## 3. What to check (record results in `validation-plan.md`)

| # | Question | Evidence | Pass if |
|---|---|---|---|
| F1 | Does pose tracking work at night under field lights? | QC levels; overlay screenshots | ≥ 80% of normal night swings are QC good/fair |
| F2 | Is QC too strict for fast hands? (known risk: wrist visibility drops in fast arm motion) | `qcReasons` mentioning wrist; overlay of rejected swings | If wrists look correctly placed in rejected swings, QC wrist limits need revision **based on this evidence** |
| F3 | Does QC reject genuinely bad footage? | deliberately bad clip(s) | rejected with a sensible reason |
| F4 | Are events plausible? | `tools/plot-analysis.mjs` on a few swings vs. watching the video frame by frame | start/plant/peak/end within ~2 frames of what a human marks |
| F5 | Are normal swings consistent? | spread of head, stride, timing; consistency of normal swings | normal swings mostly have deviations < 2 |
| F6 | Are deliberate changes detected in the right component? | `summary.txt` | longer/shorter stride → stride deviation above all normal swings; head → head deviation above all normal swings |
| F7 | Calibrate the consistency score scale | distribution of absolute differences among normal swings | set half-score values (metric-definitions §6) from data, re-run, document |
| F8 | Practical speed on iPhone | timing notes | analysis of a ~5 s clip completes in an acceptable time for practice (target < ~30 s; record actual) |
| F9 | Head metric variant | head (pelvis-relative) vs headAnchored for head-perturbation swings | decide which one to keep as primary, document why |
| F10 | Does segmentation find every swing in a recording? | `summary.txt` segmentation lines (found vs `expected_swings`), list of windows vs watching the video | every real swing found; false positives (dry swings, walking, picking up balls) listed and noted; record scan time on iPhone |

Only after F1–F6 pass may any row in `validation-status.md` move to
`FIELD_VALIDATED`. Record failures as they are; do not tune metrics to make the
demo look better.
