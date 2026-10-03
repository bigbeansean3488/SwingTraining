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

---

## 2. Normalization (`src/analysis/normalize.js`)

### 2.1 Derived points

| Point | Definition |
|---|---|
| head | nose if the nose is tracked in ≥ 80% of window frames, otherwise the ear midpoint (one proxy per sequence — never switched mid-swing, which would create a fake jump) |
| shoulderMid, pelvis | midpoint of left/right shoulders (hips); defined when at least one side is tracked |
| hands | visibility-weighted mean of both wrists, `(v_L·P_L + v_R·P_R)/(v_L + v_R)`; label-independent and robust to the far wrist being occluded |
| lead*/rear* | per-side joints. **Lead side = the ankle with the larger horizontal travel from its stance position** (decided once per sequence). Batting side is not needed. |

### 2.2 Spatial normalization

For every point at frame k with pixel position (X, Y):

```
x' = d · (X − O_x) / T
y' = (Y − O_y) / T
```

- **T** (scale) = median over the window of the torso length |shoulderMid − pelvis| in pixels.
  The torso is roughly vertical in side view, so it is less affected by trunk
  rotation than shoulder width.
- **O** (origin) = median pelvis position over the stance reference frames:
  the first max(3, ⌈10% of window⌉) frames. The origin is **fixed in time**
  (anchored body frame), so weight shift and head drift stay visible. A
  moving-origin variant (`relativeToPelvis`) subtracts the per-frame pelvis.
- **d** (direction) = sign of the lead ankle's largest horizontal displacement
  when that displacement ≥ 0.15 T (`directionSource = 'stride'`); otherwise the
  sign of the pelvis net shift if ≥ 0.05 T (`'pelvis'`); otherwise +1
  (`'default'`). After normalization +x always points toward the pitcher, so
  right/left-handed batters and either camera side are comparable.
- y is image-down (positive y = lower).

Gap handling: a landmark below the visibility threshold is missing. Interior
gaps of ≤ 3 frames are linearly interpolated; longer gaps remain missing.
Then a centered 3-frame moving average is applied.

### 2.3 Temporal normalization

The analysis window [t_a, t_b] is mapped to u ∈ [0, 1] and each point is
linearly interpolated at n = 101 uniform u values. Optional anchors (detected
events) define a piecewise-linear time warp: `t(u)` is linear between
consecutive anchors (u_j, t_j). Samples that fall in a missing stretch are
null and counted in `missing[point]`.

### 2.4 Trajectory distance

For two resampled trajectories A, B of the same point:

```
D(A, B) = mean_i |A_i − B_i|      over samples i present in both
```

in T units; null if fewer than half the samples overlap.

### 2.5 Verified invariances (synthetic, `tests/normalization.test.js`)

| Transformation | max over points of D (T) |
|---|---|
| translate 250 px | 8e-16 |
| scale × 0.5 | 2e-15 |
| mirror (facing reversed) | < 1e-3 |
| 30 fps vs 60 fps (noise-free) | 0.0087 (linear interpolation of fast hands at 30 fps) |
| 120 fps vs 60 fps | 0.0024 |
| uniformly 1.3× slower tempo | 0.0013 |
| **hands: repeat (noise only) vs altered path** | **0.0024 vs 0.136** |
| **lead-ankle end, stride 1.5 vs 1.0 T** | **+0.5 T preserved** |
