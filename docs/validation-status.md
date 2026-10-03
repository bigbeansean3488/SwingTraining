# Validation Status

Three levels, tracked per feature:

- **IMPLEMENTED** — code exists and runs.
- **UNIT_VALIDATED** — deterministic tests or controlled fixtures demonstrate expected behavior.
- **FIELD_VALIDATED** — tested on real iPhone baseball-practice footage (tripod, side view, practice field).

Synthetic or generic-video checks never count as field validation.
Until real practice footage is evaluated, every row is `FIELD_VALIDATED: PENDING`.

| Feature | Implemented | Unit validated | Field validated | Evidence |
|---|---|---|---|---|
| Video load + metadata | YES | YES | PENDING | `tests/frameRate.test.js`, `tools/check-video-input.mjs` (desktop Chrome) |
| Frame-rate measurement | YES | YES | PENDING | rVFC deltas; reports `unknown` when inconsistent |
| Pose extraction (MediaPipe, seek-per-frame) | YES | YES (data model) / visual check on generic video | PENDING | `tests/landmarks.test.js`, `tools/check-pose.mjs` |
| Skeleton overlay with low-visibility marking | YES | visual check only | PENDING | screenshots from `tools/check-pose.mjs` (not committed: contains a person) |
| Synthetic swing generator (test fixture) | YES | visual check | n/a | `src/synthetic/swing.js`, `tools/render-synthetic.mjs` |
| Pose quality control | YES | YES | PENDING | `tests/quality.test.js` (missing body, low wrist/ankle confidence, jumps, scale jump, partial body, leaving frame, too small) |

## Test footage available so far

| File | Content | Counts as field footage? |
|---|---|---|
| `data/local-videos/IMG_4841.MOV` (not committed) | iPhone, portrait 2160×3840, 31.58 fps, 53 s, indoor batting-cage area, one person, handheld/unknown mount | **No** — generic human-motion test video only |

## M2 visual check on IMG_4841.MOV (generic motion, not a swing)

Content turned out to be an indoor **pitching** arcade (throwing motion), handheld camera.

- Coarse scan, lite model, 2 Hz over 0–53 s: person detected in 88.8% of samples.
  Failures seen: no detection while the person is far/partially out of frame
  (~9 s, 13–14.5 s, 39 s); at 53 s the skeleton was placed on empty background
  while the person crouched elsewhere (a confident false detection — QC must
  catch this via jumps/size, not only via visibility).
- Dense run, full model, 31.6 Hz over 4.5–8.5 s (throw): person in 100% of
  frames; skeleton visually follows the body through the throw including
  motion-blurred frames. Far-side (left) wrist visibility median ≈ 0.4, so
  per-side wrist tracking is 67% while near-side wrist is reliable — expect the
  same occlusion pattern in side-view batting.
- Desktop Chrome GPU delegate: ~0.9 s per 4K frame including seek (seek-bound).
  iPhone speed not measured yet.

## M3 QC on real generic footage (IMG_4841.MOV)

`node tools/qc-report.mjs <pose.json>`

| Segment | Level | Main reasons |
|---|---|---|
| 4.5–8.5 s throw, full model, 31.6 Hz | poor | best wrist visibility < 0.5 for 33% of frames, longest gap 0.78 s (during the fast arm action) |
| 50–53 s (walking, crouching to pick up ball) | poor | wrists hidden 52%, gap 0.97 s; size warning (26% of image) |

Wrist visibility pattern in the throw (`#` ≥ 0.5, `+` 0.3–0.5, `.` < 0.3):
`##########################+++++++++##+++++++++#########++++++++++++++.....+++++####...`

Interpretation: the overlay looks plausible in many of these low-visibility
frames, so QC may be conservative for fast hand motion. This is the first
thing to check with field footage (is the low-visibility wrist position still
accurate?). Thresholds were **not** changed in response.
