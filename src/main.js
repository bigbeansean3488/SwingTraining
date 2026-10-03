// Entry point. Keep this file thin: wire UI modules to app state.
// Analysis logic lives in src/analysis and must not import from src/ui.
import { loadVideoFile, probeFrameRate } from './ui/video.js';

export const APP_VERSION = '0.1.0';

const $ = (id) => document.getElementById(id);

function checkEnvironment() {
  const checks = {
    IndexedDB: 'indexedDB' in window,
    WebAssembly: typeof WebAssembly === 'object',
    WebGL2: !!document.createElement('canvas').getContext('webgl2'),
    FrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
  };
  return Object.entries(checks)
    .map(([name, ok]) => `${ok ? '✓' : '✗'} ${name}`)
    .join('  ');
}

function renderMeta(meta, fpsInfo) {
  const rows = [
    ['File', meta.name],
    ['Duration', `${meta.duration.toFixed(2)} s`],
    ['Dimensions', `${meta.width} × ${meta.height}`],
    ['Frame rate', fpsInfo?.reliable ? `${fpsInfo.fps.toFixed(2)} fps (measured)` : `unknown — ${fpsInfo?.reason ?? 'measuring…'}`],
    ['Size', `${(meta.sizeBytes / 1e6).toFixed(1)} MB`],
  ];
  $('video-meta').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function showError(msg) {
  const el = $('video-error');
  el.textContent = msg;
  el.hidden = !msg;
}

async function onFileSelected(file) {
  showError('');
  $('video-card').hidden = true;
  const video = $('video');
  try {
    const meta = await loadVideoFile(video, file);
    $('video-card').hidden = false;
    renderMeta(meta, null);
    const fpsInfo = await probeFrameRate(video);
    renderMeta(meta, fpsInfo);
    window.__swingDebug = { meta, fpsInfo };
  } catch (err) {
    showError(`Could not load video: ${err.message}`);
    window.__swingDebug = { error: err.message };
  }
}

$('app-version').textContent = `v${APP_VERSION}`;
$('env-status').textContent = checkEnvironment();
$('video-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = ''; // allow re-selecting the same file
  if (file) onFileSelected(file);
});
