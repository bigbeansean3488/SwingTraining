// Entry point. Keep this file thin: wire UI modules to app state.
// Analysis logic lives in src/analysis and must not import from src/ui.
import { loadVideoFile, probeFrameRate } from './ui/video.js';
import { extractPoseSequence } from './pose/mediapipe.js';
import { trackingCoverage } from './pose/landmarks.js';
import { drawSkeleton, syncCanvas, nearestFrameIndex } from './ui/skeleton.js';

export const APP_VERSION = '0.2.0';
const MAX_DEFAULT_WINDOW_S = 8;

const $ = (id) => document.getElementById(id);
const state = { meta: null, fpsInfo: null, pose: null, busy: false };

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

function renderDl(el, rows) {
  el.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');
}

function renderMeta() {
  const { meta, fpsInfo } = state;
  renderDl($('video-meta'), [
    ['File', meta.name],
    ['Duration', `${meta.duration.toFixed(2)} s`],
    ['Dimensions', `${meta.width} × ${meta.height}`],
    ['Frame rate', fpsInfo?.reliable ? `${fpsInfo.fps.toFixed(2)} fps (measured)` : `unknown — ${fpsInfo?.reason ?? 'measuring…'}`],
    ['Size', `${(meta.sizeBytes / 1e6).toFixed(1)} MB`],
  ]);
}

function renderTracking(seq) {
  const cov = trackingCoverage(seq);
  const pct = (x) => `${Math.round(x * 100)}%`;
  renderDl($('tracking-summary'), [
    ['Frames analyzed', `${cov.frames} @ ${seq.sampleFps} fps (${seq.delegate}, ${(seq.processingMs / 1000).toFixed(1)} s)`],
    ['Person detected', pct(cov.poseFraction)],
    ...Object.entries(cov.groups).map(([g, v]) => [`${g} tracked`, pct(v)]),
  ]);
  return cov;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function showError(msg) {
  const el = $('video-error');
  el.textContent = msg;
  el.hidden = !msg;
}

function drawCurrent() {
  const video = $('video');
  const canvas = $('overlay');
  syncCanvas(canvas, video);
  const frames = state.pose?.frames;
  if (!frames?.length) { drawSkeleton(canvas, null); return; }
  const t = video.currentTime;
  const inRange = t >= frames[0].t - 0.05 && t <= frames[frames.length - 1].t + 0.05;
  drawSkeleton(canvas, inRange ? frames[nearestFrameIndex(frames, t)].lm : null);
}

function startOverlayLoop() {
  const video = $('video');
  if ('requestVideoFrameCallback' in video) {
    const tick = () => { drawCurrent(); video.requestVideoFrameCallback(tick); };
    video.requestVideoFrameCallback(tick);
  }
  video.addEventListener('seeked', drawCurrent);
  video.addEventListener('timeupdate', drawCurrent);
  window.addEventListener('resize', drawCurrent);
}

async function onFileSelected(file) {
  showError('');
  $('video-card').hidden = true;
  state.pose = null;
  renderDl($('tracking-summary'), []);
  $('analyze-status').textContent = '';
  const video = $('video');
  try {
    state.meta = await loadVideoFile(video, file);
    state.fpsInfo = null;
    $('video-card').hidden = false;
    renderMeta();
    $('range-start').value = '0';
    $('range-end').value = Math.min(state.meta.duration, MAX_DEFAULT_WINDOW_S).toFixed(1);
    state.fpsInfo = await probeFrameRate(video);
    renderMeta();
    drawCurrent();
    window.__swingDebug = { meta: state.meta, fpsInfo: state.fpsInfo };
  } catch (err) {
    showError(`Could not load video: ${err.message}`);
    window.__swingDebug = { error: err.message };
  }
}

async function onAnalyze() {
  if (state.busy || !state.meta) return;
  const video = $('video');
  const start = Math.max(0, Number($('range-start').value) || 0);
  const end = Math.min(video.duration, Number($('range-end').value) || video.duration);
  if (!(end > start)) { $('analyze-status').textContent = 'Invalid range: "To" must be after "From".'; return; }
  // Sample at the measured fps when known (capped), otherwise 30 Hz.
  const sampleFps = window.__forceSampleFps || (state.fpsInfo?.reliable ? Math.min(60, Math.round(state.fpsInfo.fps)) : 30);
  state.busy = true;
  $('analyze-btn').disabled = true;
  const prog = $('analyze-progress');
  prog.hidden = false;
  prog.value = 0;
  $('analyze-status').textContent = 'Loading pose model…';
  video.pause();
  try {
    state.pose = await extractPoseSequence(video, {
      variant: $('model-variant').value,
      start,
      end,
      sampleFps,
      onProgress: (p, frame) => {
        prog.value = p;
        $('analyze-status').textContent = `Analyzing… ${Math.round(p * 100)}%`;
        drawSkeleton(($('overlay')), frame.lm);
      },
    });
    const cov = renderTracking(state.pose);
    $('analyze-status').textContent = 'Pose extracted. Play or scrub to review the skeleton.';
    window.__swingDebug = { ...window.__swingDebug, pose: state.pose, coverage: cov };
    video.currentTime = start;
  } catch (err) {
    console.error(err);
    $('analyze-status').textContent = `Pose analysis failed: ${err.message}`;
    window.__swingDebug = { ...window.__swingDebug, poseError: err.message };
  } finally {
    state.busy = false;
    $('analyze-btn').disabled = false;
    prog.hidden = true;
  }
}

$('app-version').textContent = `v${APP_VERSION}`;
$('env-status').textContent = checkEnvironment();
$('video-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = ''; // allow re-selecting the same file
  if (file) onFileSelected(file);
});
$('analyze-btn').addEventListener('click', onAnalyze);
startOverlayLoop();
