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

## Test footage available so far

| File | Content | Counts as field footage? |
|---|---|---|
| `data/local-videos/IMG_4841.MOV` (not committed) | iPhone, portrait 2160×3840, 31.58 fps, 53 s, indoor batting-cage area, one person, handheld/unknown mount | **No** — generic human-motion test video only |
