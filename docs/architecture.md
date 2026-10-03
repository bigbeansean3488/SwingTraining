# Architecture

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Build tooling | None (native ES modules) | Zero install, GitHub Pages serves repo directly, Node not required on dev machine. Can add Vite later without restructuring. |
| Pose model | MediaPipe Pose Landmarker (Tasks Vision, WASM, from CDN) | Runs on-device in Safari, no backend. |
| Storage | IndexedDB | Structured per-swing data; localStorage is too small and string-only. |
| Video retention | Not stored by default | Storage limits on iOS; landmarks are enough for re-analysis of metrics. |

## Data flow

```
video file (input / camera capture)
  → frame sampling (src/ui/video)
  → pose landmarks per frame (src/pose/mediapipe)
  → quality control (src/pose/quality)          ── fail → "Unable to reliably analyze"
  → normalization (src/analysis/normalize, temporal)
  → metrics (headStability, stride, wristPath, timing)   each: { value, confidence, diagnostics }
  → comparison vs recent valid swings (src/analysis/consistency)
  → interpretation text (src/ui/results)
  → persist (src/storage/indexedDb)
```

`src/analysis` has no DOM access and no UI imports, so it can be tested in isolation.

## Assumptions (V0)
- Phone on tripod, roughly side view (open side), single batter in frame.
- Batting side is entered per session, not detected.
- Frame rate is estimated from frame timestamps when the container doesn't expose it.
