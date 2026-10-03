# Metric Definitions

All quantities are 2D, from a single camera. No physical units are reported.
Distances are in **torso lengths (T)**; times are in seconds of media time or
as a fraction of the detected swing interval.

Validation levels for every item: see [validation-status.md](validation-status.md).
All items are `FIELD_VALIDATED: PENDING`.

---

## 0. Input representation

`PoseSequence.frames[k] = { t, lm }`, `lm[i] = [x, y, z, v]` for the 33 MediaPipe
Pose landmarks, with `x, y` normalized to image width/height and `v` the
MediaPipe visibility in [0, 1]. Analysis first converts to pixels:
`X = x·W, Y = y·H`, so distances are aspect-correct.

A landmark is **tracked** in a frame if `v ≥ 0.5` (`VIS_THRESHOLD`).
A landmark **group** (head = nose/ears, shoulders, hips, wrists, knees, ankles)
is tracked if its best-visible member is tracked — in side view the far-side
limb is often occluded, so requiring both sides would reject most footage.

---

## 1. Quality control (`src/pose/quality.js`)

Computed on the analyzed frames. Each check is pass / warn / fail.

| Check | Definition | Warn | Fail |
|---|---|---|---|
| frames | number of analyzed frames | — | < 10 |
| presence | fraction of frames with a detected person | < 0.95 | < 0.80 |
| group_g | fraction of frames where group g is tracked (g ∈ head, shoulders, hips, wrists, ankles) | < 0.90 | < 0.80 |
| gap_g, gap_body | longest continuous untracked stretch, in seconds, measured between the last tracked frame before and first tracked frame after | > 0.10 s | > 0.20 s |
| size | median over frames of (max ankle y − min(nose, ear) y), as a fraction of image height | < 0.30 | < 0.20 |
| outOfFrame | fraction of frames where any core group's best-visible landmark has x or y outside [0, 1] | > 0.02 | > 0.10 |
| jumps | number of frames where torso-center speed > 10 T/s **or** frame-to-frame torso-length change > 35% | ≥ 1 | ≥ 3 |

Torso center = mean of shoulder midpoint and hip midpoint. Torso length =
|shoulder midpoint − hip midpoint|. Jump speed uses the sequence's median torso
length as T.

Overall level: any fail → **poor** (metrics are not computed and the swing is
excluded from the baseline); any warn → **fair** (metrics shown, confidence
reduced); otherwise **good**.

Rationale for the limits: body-center motion during a swing is ~1–3 T/s, so
10 T/s is a deliberately loose jump limit. Gap limits are short because the
fast part of a swing lasts only ~0.15–0.3 s; losing 0.2 s of wrists can
remove the entire swing. These limits are **initial guesses to be checked
against field footage**, not validated values.

Known risk (observed on generic footage, see validation-status.md): during
fast arm motion MediaPipe wrist visibility drops to 0.3–0.5 (motion blur), so
`group_wrists` / `gap_wrists` may reject real swings. Do not lower the
threshold until field footage shows whether the low-visibility wrist
positions are still accurate.
