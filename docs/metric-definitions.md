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

---

## 3. Swing events (`src/analysis/temporal.js`)

Signals (from the normalized tracks, central differences, T/s):
`v_h(t)` = hands speed, `v_a(t)` = lead-ankle speed, activity `a(t) = max(v_h, v_a)`.

| Event | Definition |
|---|---|
| peakHandSpeed | argmax of `v_h` over the window, refined sub-frame by a parabola through the max and its two neighbors. **Approximate swing-event proxy, not bat-ball contact.** |
| threshold θ | `max(0.5 T/s, 0.05 · max v_h)` |
| motionStart | walking back from the peak through frames with `a ≥ θ`; a sub-threshold pause ≤ 0.15 s that is followed by more activity is bridged (e.g. the pause between foot plant and the swing). Start = linear-interpolated crossing of θ. If activity never drops below θ before the peak, the swing is rejected ("include more time before the swing"). |
| footPlant | lead-ankle stride peak = max `v_a` between motionStart and the hand peak; plant = first crossing of `v_a` below 10% of that peak afterwards. If the stride peak is < 0.8 T/s, no stride is detected (`footPlant = null`). |
| swingEnd | first crossing of `v_h` below θ after the peak (hands come to rest). |
| no swing | rejected if `max v_h < 2 T/s`. |

Known bias: threshold-defined start/end sit a few hundredths of a second
inside the true onset/offset of a smoothly starting/ending motion; the bias is
the same for every swing so within-player comparisons are unaffected.
Measured on synthetic swings (`tests/metrics.test.js`, truth known):

| fps | motionStart | footPlant | peakHandSpeed | swingEnd |
|---|---|---|---|---|
| 30 | −15 ms | +27 ms | +0.2 ms | −16 ms |
| 60 | −1 ms | +13 ms | 0.0 ms | −20 ms |
| 120 | −6 ms | +12 ms | −4.5 ms | −29 ms |

Test tolerance: max(1.5 frames, 20 ms) for plant and peak (peak additionally
≤ 0.5 frame), max(1.5 frames, 40 ms) for start/end.

---

## 4. Individual metrics (V0)

Pipeline (`src/analysis/pipeline.js`): normalize (pass 1) → events → QC on
[motionStart − 0.3 s, swingEnd + 0.2 s] → if usable, normalize again with the
stance reference = [motionStart − 0.3 s, motionStart] → metrics. A QC-poor
swing returns `status: 'rejected'`, `metrics: null`,
"Unable to reliably analyze this swing.".

Every metric returns `{ value, unit, confidence, diagnostics, validation }`.
`validation = { level: 'UNIT_VALIDATED', field: 'PENDING' }` for all V0 metrics.

**Confidence** = (fraction of raw-tracked frames of the metric's points in the
relevant interval) × QC factor (good 1.0, fair 0.7, poor 0). Timing confidence
instead uses min(1, fps/60), × 0.6 if no foot plant, × 0.6 if the swing end
is not inside the window. Confidence describes data quality only; it is not a
statistical probability.

### 4.1 Head stability (`headStability.js`)

Head position relative to the per-frame pelvis: `h_rel(k) = head(k) − pelvis(k)`
(T units). `ref` = mean `h_rel` over the stance reference frames.
**value = max over frames in [motionStart, swingEnd] of |h_rel − ref|**. Lower = steadier.

Why pelvis-relative: in the anchored (camera-fixed) frame, a longer stride
carries the whole body — and the head — forward, so head and stride would
measure the same thing. Pelvis-relative head movement isolates head motion
over the body (trunk lean/drop, head bob). The anchored values are kept in
diagnostics (`maxDisplacementAnchored`, `rmsDisplacementAnchored`,
`pathLengthAnchored`, `forwardAtPeak`, `dropAtPeak`). Which variant tracks
contact quality better is an open question for field data.

Synthetic check (expected A < B < C): pelvis-relative A 0.03, B 0.16, C 0.43
(anchored: 0.37, 0.51, 0.77 — the synthetic body drifts 0.35 T with the
stride). A 0.4 T longer stride changes the value by < 0.03 T.

### 4.2 Stride (`stride.js`)

`stance` = median lead-ankle position over stance frames; `plant` = median
lead-ankle position over [footPlant, footPlant + 0.1 s].
**value = plant.x − stance.x** (T, + toward pitcher). Diagnostics: plant x/y
(relative to the stance pelvis), vertical change, foot lift (max rise during
the stride), stride duration (footPlant − motionStart). No detected stride →
value 0 with halved confidence.

Synthetic check: 5 near-identical swings (L = 1.00 ± 0.02) → SD < 0.03 T,
mean within 0.05 T of 1.0; strides 1.4 / 0.6 deviate by > 10 SD and are
recovered within 0.06 T.

### 4.3 Hand/wrist path (`wristPath.js`)

The hands point **relative to the per-frame pelvis** (same reasoning as §4.1:
stride translation is measured by the stride metric), resampled over
[motionStart, swingEnd] at 51 samples with a piecewise-linear time warp that
puts footPlant at u = 0.5 and peakHandSpeed at u = 0.8 (conventions; they make
paths comparable when tempo changes, and timing is measured separately).
**value = the 51-point path** (T). Diagnostics: path length, max forward /
back extent, lowest / highest point. Distance between two paths = D(A, B)
from §2.4.

Synthetic check: similar pair ≪ altered path (> 3×); a pure tempo change
stays < 1/3 of the altered-path distance; a longer stride leaves the
deviation < 2.

### 4.4 Timing (`timing.js`)

value = { startToPlant, plantToPeak, startToPeak, peakToEnd, total } in
seconds. Synthetic check: all events within tolerance at 30/60/120 fps and for
different tempos; a swing delayed by 0.1 s after plant is measured as
+0.10 ± 0.02 s.

---

## 5. Multi-swing comparison (`src/analysis/comparison.js`)

**Baseline** = the most recent N = 5 swings before the current one that are
usable (QC not poor) and not manually excluded. Rejected swings never enter it.
With no usable previous swing, the current swing only starts the baseline.

**Scalar components** — head (§4.1 value), stride (§4.2 value), timing
(startToPeak, plantToPeak):

```
m = mean(baseline values)
s = sample SD (n−1) of baseline values (undefined if n < 2)
spread = max(s, floor)
z = (x − m) / spread          deviation = |z|
```

`rank` reports how many baseline values are greater / smaller (e.g. "more
stable than all of the last 5 swings" = head rank.greater = 5).

**Trajectory components** — wrist path (§4.3) and full-body pose trajectory
(10 points: head, shoulderMid, pelvis, hands, lead/rear elbow, knee, ankle;
anchored frame, 51 event-warped samples; distance = mean over points of D):

```
distance = D(current, pointwise mean of baseline)
typical  = mean over baseline swings i of D(swing_i, mean of the other baseline swings)   (n ≥ 2)
deviation = distance / max(typical, floor)
```

The pose component stays in the anchored frame on purpose: it is the
whole-body summary and should see stride/weight-shift changes too.

**Noise floors** (measurement resolution; prevent near-identical baselines
from inflating trivial differences): head 0.03 T, stride 0.05 T, timing
0.033 s (~2 frames at 60 fps), wrist path 0.02 T, pose 0.02 T. These are
initial values from synthetic noise and frame resolution, to be re-estimated
from field repeatability data.

Interpretation of deviation: ≈ 1 is a typical swing-to-swing difference for
this player; larger values are progressively unusual. No fixed cut-off is
claimed to be meaningful yet.

Reference synthetic session (`src/synthetic/session.js`, `tests/comparison.test.js`):

| swing | label | head | stride | timing | wristPath | pose |
|---|---|---|---|---|---|---|
| 1 | baseline | — | — | — | — | — |
| 2 | near baseline | 0.13 | 0.17 | 0.40 | 1.27 | 0.49 |
| 3 | near baseline | 0.17 | 0.18 | 0.07 | 0.52 | 0.27 |
| 4 | longer stride | 0.41 | **7.77** | 0.32 | 0.40 | **5.60** |
| 5 | more head movement | **10.90** | 0.49 | 0.18 | 0.69 | 0.73 |

---

## 6. Motion consistency score (`src/analysis/consistency.js`)

**What it is:** how close the current swing is to the player's recent valid
swings (the §5 baseline), on a 0–100 scale. **What it is not:** a measure of
swing quality, power, or batting performance. A player can be consistently
wrong. Validation: `UNIT_VALIDATED`, `FIELD_VALIDATED: PENDING`.

Inputs — absolute differences from the baseline (stored with every swing as
`consistencyInputs`, so the score can be recomputed or revised later):

| component | Δ | unit |
|---|---|---|
| head | \|head − baseline mean\| (§4.1 value) | T |
| stride | \|stride − baseline mean\| (§4.2 value) | T |
| timing | max(\|Δ startToPeak\|, \|Δ plantToPeak\|) vs baseline means | s |
| wristPath | D(current path, baseline mean path) (§5) | T |
| pose | mean-over-points D(current, baseline mean pose trajectory) (§5) | T |

Component score and composite:

```
s_i = 100 / (1 + (Δ_i / h_i)²)          h_i = half-score difference
score = Σ w_i' · s_i ,  w_i' = w_i / Σ_{available} w_j     (rounded to integer)
```

| component | weight w_i | half-score h_i (PROVISIONAL) |
|---|---|---|
| head | 0.2 | 0.10 T |
| stride | 0.2 | 0.15 T |
| timing | 0.2 | 0.05 s |
| wristPath | 0.2 | 0.10 T |
| pose | 0.2 | 0.10 T |

Why absolute differences rather than the player-relative z of §5: dividing by
the player's own variability would make a consistently inconsistent player
look perfectly consistent. The relative z values are still shown in the UI
as "compared with your usual" wording.

Why equal weights: no evidence yet that any component matters more.
Half-score values are initial guesses (a component scores 50 when the swing
differs from baseline by h_i). **Calibrate on field data**: e.g. set h_i to a
multiple of the typical within-player difference among normal swings, then
check the score separates deliberately altered swings.

Limitations: the score depends on baseline size (1–5 swings); with 1 baseline
swing it is a pairwise similarity. A swing with missing components is scored
on the remaining ones (renormalized weights, listed in the result).

Synthetic results (`tests/consistency.test.js`):

| reference session swing | score | lowest components |
|---|---|---|
| 2 near baseline | 97 | — |
| 3 near baseline | 99 | — |
| 4 longer stride | 70 | stride 13, pose 44 |
| 5 more head movement | 72 | head 9 |

| synthetic session (8 swings) | mean score |
|---|---|
| stable (variation × 0.5) | 99.7 |
| moderately variable (× 2.5) | 94.1 |
| highly variable (× 6) | 80.7 |

The ordering is regression-tested; the spread between sessions depends on the
provisional h_i and must not be read as calibrated.

### 6.1 Display scores per Training Focus (UI)

The result screen shows one 0–100 number per Training Focus:

| Focus | Display score | Source |
|---|---|---|
| Motion Consistency | composite score (§6) | `consistency.score` |
| Stride Consistency | stride component score s_stride (§6) | two-sided |
| Hand Path Consistency | wristPath component score s_wristPath (§6) | two-sided |
| Head Stability | `100 / (1 + (max(0, head − baseline mean) / 0.10)²)` | `headStabilityScore` (one-sided) |

Head Stability is one-sided on purpose: the head component of §6 penalizes
*any* difference from the baseline, so a swing with clearly **less** head
movement would score lower — misleading under the label "Stability". The
display score penalizes only more movement than the baseline, using the same
provisional half-score (0.10 T). It is a UI mapping; the stored metrics and
the composite score are unchanged. FIELD_VALIDATED: PENDING.

The trend shown next to the focus score ("比最近 5 棒平均 +6") compares it with
the mean display score of up to 5 earlier valid swings that have one.

## 7. Result wording (`src/app/interpret.js`)

Traditional Chinese with English baseball terms. Scalar components use the §5
z value: |z| < 1 → 相近, 1 ≤ |z| < 2 → 稍長/稍短/稍多/稍少, |z| ≥ 2 → 明顯…;
head uses a rank statement ("比最近 N 棒都多/少") when it holds for all ≥ 3
baseline swings and |z| ≥ 1. Hand path: deviation < 1.5 相近, < 3 有些不同,
else 明顯不同. Motion names the component with the largest deviation when it is
≥ 2, otherwise 整體動作與最近 N 棒相近. These cut-offs are display conventions,
not validated thresholds. No coaching diagnosis is generated.

---

## 8. Swing segmentation in a long recording (`src/analysis/segmentation.js`)

Practice workflow: start recording, hit N balls, stop, analyze. Recordings
longer than 10 s are processed in two passes:

1. **Scan** (`extractPoseByPlayback`, lite model): the video plays muted and
   pose is detected on frames delivered by `requestVideoFrameCallback`, at most
   15 per second of media time; the playback rate adapts so detection keeps
   up. These landmarks are used **only to locate swings**, never for metrics
   (observed in headless Chrome: playback landmarks lag the seek-based ones by
   ~0.2–0.3 s, see validation-plan.md).
2. **Per-swing analysis**: each candidate window is extracted again with the
   exact seek-per-frame method at the video frame rate (≤ 60 fps) and the
   selected model, then analyzed by `analyzeSwing()` exactly like a short clip
   (QC → events → metrics → comparison). Swings join the session in recording
   order.

Segmentation signal (scan sequence, no smoothing):

```
h_k   = hands_k − pelvis_k                     (image px, per frame)
T_k   = rolling median over ±1 s of |shoulderMid − pelvis|
v_k   = |h_{k+1} − h_{k−1}| / (t_{k+1} − t_{k−1}) / T_k     (T/s)
```

Pelvis-relative so that walking or stepping out between swings does not look
like a swing; locally scaled so moving toward/away from the camera does not
change the threshold.

| Step | Rule (defaults in `SEGMENT_DEFAULTS`) |
|---|---|
| Candidate runs | frames with `v ≥ 5 T/s`; runs separated by < 0.3 s are one run; peak = max of the run |
| Merge | peaks < 2.5 s apart are one swing (the larger peak is kept) — follow-through / bat recoil |
| Window | `[peak − 2.5 s, peak + 1.5 s]`, clipped to the recording and to halfway between neighboring peaks (a window never contains another swing's fastest part) |
| Tracking | hands tracked in < 50% of frames in `[peak − 1 s, peak + 0.5 s]` → candidate rejected |

Synthetic peaks: ~11 T/s at 60 fps, ~8.5 T/s at a 15 fps scan, ~9.5 T/s for a
faster 0.17 s swing at 15 fps; distractors (walking out and back, raising the
hands to the helmet, bat waggle) stay below 3.4 T/s. The 5 T/s threshold is
**provisional** — real swing and non-swing hand speeds are unknown until field
footage (F10).

Known limits (by design, not handled):
- Dry/practice swings, check swings and throws are fast hand motions and are
  reported as swings; the player deletes them in the list.
- Two swings < 2.5 s apart are reported as one.
- A bat waggle immediately before the swing can be merged into the motion by
  event detection (§3: activity above θ with pauses < 0.15 s), moving
  `motionStart` earlier; this is existing single-swing behavior.
