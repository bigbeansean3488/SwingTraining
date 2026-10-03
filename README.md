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

Analysis modules are pure functions with no DOM dependency.
Tests use `node:test` (`npm test`, requires Node 18+). A browser test page will
be added alongside the first analysis module so tests also run without Node.

## Deploy

GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.
No build is required.

## Layout

```
index.html          entry page
src/main.js         wiring only
src/app/            session + app state
src/pose/           MediaPipe wrapper, landmark helpers, quality control
src/analysis/       normalization + metrics (pure, testable, no UI imports)
src/storage/        IndexedDB
src/ui/             video, skeleton overlay, results, session views
tests/              unit tests + fixtures
docs/               architecture, metric definitions, validation plan
```

## Status

See milestone list in [CLAUDE.md](CLAUDE.md).
