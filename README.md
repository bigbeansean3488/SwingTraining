# SwingTraining

Lightweight baseball swing consistency demo that runs in iPhone Safari.
Single side-view video → automatic pose (MediaPipe) → normalized trajectories →
within-player consistency metrics. Local-first: no backend, no accounts, no paid services.

V0 validation question: *Can a single iPhone camera, under realistic evening
practice lighting, reliably detect meaningful differences between repeated
swings from the same player?*

## Run locally

No build step. The app is plain ES modules served as static files.

```sh
python -m http.server 8000
# open http://localhost:8000
```

To test on an iPhone on the same Wi-Fi, open `http://<your-PC-LAN-IP>:8000`
in Safari (Windows Firewall may need to allow Python on private networks).

## Tests

```sh
npm install          # dev tools only (puppeteer-core, fake-indexeddb)
npm test             # unit tests on synthetic swings (no footage needed)
node tools/check-practice.mjs out/   # end-to-end practice loop in headless Chrome
```

Analysis modules (`src/analysis`, `src/pose/quality.js`) are pure functions;
`src/synthetic/` generates stick-figure swings with exactly known events for
tests and for the in-app demo buttons.

## Deploy

GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.
No build is required.

## Layout

```
index.html            entry page
src/main.js           wiring only
src/app/              session records, plain-language interpretation
src/pose/             MediaPipe wrapper, landmark model, quality control
src/analysis/         normalization, events, metrics, comparison, consistency (pure)
src/synthetic/        synthetic swings/sessions (tests + demo)
src/storage/          IndexedDB
src/ui/               video, skeleton overlay, results, session views
tests/                unit tests
tools/                browser checks, plots, field-validation runner
docs/                 architecture, metric definitions, validation status/plan, field validation
```

## Status

V0 pipeline complete through Milestone 9 and unit-validated on synthetic data.
**Field validation is pending** — no real practice footage has been evaluated.
See [docs/validation-status.md](docs/validation-status.md) and
[docs/field-validation.md](docs/field-validation.md).
