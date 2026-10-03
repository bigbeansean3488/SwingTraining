// Entry point: wires the practice loop.
//   Start session → record/choose swing → pose → analyze (QC, metrics,
//   comparison, consistency) → result → contact label → next swing
// Analysis logic lives in src/analysis and must not import from src/ui.
import { loadVideoFile, probeFrameRate } from './ui/video.js';
import { extractPoseSequence } from './pose/mediapipe.js';
import { expandSequence, LM } from './pose/landmarks.js';
import { drawSkeleton, syncCanvas, nearestFrameIndex } from './ui/skeleton.js';
import { analyzeSwing } from './analysis/pipeline.js';
import { createSession, createSwingRecord, setContactLabel, recomputeSession, exportSession } from './app/session.js';
import { openStore } from './storage/indexedDb.js';
import { renderResult } from './ui/results.js';
import { renderHistory, renderSessionList, sessionTitle } from './ui/session.js';
import { renderLabelView } from './ui/labels.js';
import { generateSwing, dropFrames } from './synthetic/swing.js';
import { naturalVariation } from './synthetic/session.js';

export const APP_VERSION = '0.9.0';
const AUTO_ANALYZE_MAX_S = 10;
const DEFAULT_WINDOW_S = 8;

const $ = (id) => document.getElementById(id);
const state = {
  store: null,
  session: null,
  swings: [],
  currentId: null,
  video: { meta: null, fpsInfo: null, pose: null, recordId: null },
  busy: false,
};
window.__app = state; // for automated browser checks

// ---------------------------------------------------------------- helpers

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg || '';
  el.hidden = !msg;
}

function checkEnvironment() {
  const checks = {
    IndexedDB: 'indexedDB' in window,
    WebAssembly: typeof WebAssembly === 'object',
    WebGL2: !!document.createElement('canvas').getContext('webgl2'),
    FrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
  };
  return Object.entries(checks).map(([n, ok]) => `${ok ? '✓' : '✗'} ${n}`).join('  ');
}

function renderDl(el, rows) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  el.innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

async function persist(...swings) {
  if (!state.store) return;
  try { await state.store.putSwings(swings); } catch (e) { console.warn('save failed', e); }
}

const currentSwing = () => state.swings.find((s) => s.id === state.currentId) || null;

// ---------------------------------------------------------------- rendering

function renderAll() {
  const active = !!state.session;
  $('start-card').hidden = active;
  $('session-card').hidden = !active;
  $('capture-card').hidden = !active;
  $('history-card').hidden = !active || !state.swings.length;
  if (!active) {
    $('result-card').hidden = true;
    $('replay-card').hidden = true;
    return;
  }
  const valid = state.swings.filter((s) => s.valid).length;
  $('session-title').textContent = sessionTitle(state.session);
  $('session-stats').textContent = `${state.swings.length} swings · ${valid} valid · ${state.swings.length - valid} rejected`;
  renderHistory($('history'), state.swings, state.currentId, (id) => { state.currentId = id; renderAll(); });
  renderLabelView($('label-view'), state.swings);
  const sw = currentSwing();
  renderResult($('result-card'), sw, {
    onLabel: (label) => updateSwing(sw.id, (s) => setContactLabel(s, label), false),
    onExclude: (ex) => updateSwing(sw.id, (s) => ({ ...s, excludeFromBaseline: ex }), true),
    onDelete: () => deleteSwing(sw.id),
  });
  renderReplay(sw);
}

/** Static replay: skeleton at peak hand speed + current and recent hand paths. */
function renderReplay(sw) {
  const replayCard = $('replay-card');
  // The swing whose video is loaded already shows its skeleton on the video.
  if (!sw?.landmarks || (sw.id === state.video.recordId && !$('video-block').hidden)) { replayCard.hidden = true; return; }
  replayCard.hidden = false;
  const seq = expandSequence(sw.landmarks);
  const canvas = $('replay');
  const card = canvas.parentElement;
  const pad = parseFloat(getComputedStyle(card).paddingLeft) + parseFloat(getComputedStyle(card).paddingRight);
  const maxW = Math.min((card.clientWidth - pad) || 320, 480);
  const aspect = seq.height / seq.width;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${maxW}px`;
  canvas.style.height = `${maxW * aspect}px`;
  canvas.width = Math.round(maxW * dpr);
  canvas.height = Math.round(maxW * aspect * dpr);
  const ev = sw.analysis.events;
  const tShow = ev?.peakHandSpeed ?? seq.frames[Math.floor(seq.frames.length / 2)]?.t;
  const k = nearestFrameIndex(seq.frames, tShow);
  const trails = [];
  if (ev?.motionStart !== undefined) {
    const handPt = (lm) => {
      const l = lm[LM.LEFT_WRIST]; const r = lm[LM.RIGHT_WRIST];
      const wl = l[3]; const wr = r[3];
      if (wl < 0.5 && wr < 0.5) return null;
      return [(l[0] * wl + r[0] * wr) / (wl + wr), (l[1] * wl + r[1] * wr) / (wl + wr)];
    };
    const n = sw.analysis.normalization;
    if (n) {
      // Recent valid swings' anchored hand trajectories mapped into this image.
      const prev = state.swings.filter((s) => s.valid && s.number < sw.number && s.analysis.trajectory).slice(-3);
      for (const p of prev) {
        trails.push({
          color: '#c678dd', alpha: 0.6, width: 0.6,
          points: p.analysis.trajectory.hands.map((q) => (q ? [(n.origin[0] + n.direction * q[0] * n.T) / seq.width, (n.origin[1] + q[1] * n.T) / seq.height] : null)),
        });
      }
    }
    trails.push({ color: '#4fb3ff', width: 1, points: seq.frames.filter((f) => f.t >= ev.motionStart && f.t <= ev.swingEnd && f.lm).map((f) => handPt(f.lm)) });
  }
  const ctx = canvas.getContext('2d');
  drawSkeleton(canvas, seq.frames[k]?.lm ?? null, { trails });
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- session ops

async function startSession() {
  const session = createSession({
    playerName: $('player-name').value,
    battingSide: $('batting-side').value || null,
    note: $('session-note').value,
  });
  state.session = session;
  state.swings = [];
  state.currentId = null;
  if (state.store) {
    await state.store.putSession(session);
    await state.store.setMeta('activeSession', session.id);
  }
  renderAll();
}

async function resumeSession(id) {
  if (!state.store) return;
  const session = await state.store.getSession(id);
  if (!session) return;
  state.session = session;
  state.swings = await state.store.listSwings(id);
  state.currentId = state.swings.at(-1)?.id ?? null;
  await state.store.setMeta('activeSession', id);
  renderAll();
}

async function endSession() {
  state.session = null;
  state.swings = [];
  state.currentId = null;
  if (state.store) {
    await state.store.setMeta('activeSession', null);
    renderSessionList($('session-list'), await state.store.listSessions(), resumeSession);
  }
  renderAll();
}

function exportCurrent() {
  const data = exportSession(state.session, state.swings);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `swingtraining-${state.session.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function addSwing({ seq, analysis, video }) {
  const record = createSwingRecord({ session: state.session, seq, analysis, video, previous: state.swings });
  state.swings.push(record);
  state.currentId = record.id;
  await persist(record);
  renderAll();
  $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  return record;
}

/** Update one swing; if it affects baselines, recompute later comparisons. */
async function updateSwing(id, fn, affectsBaseline) {
  state.swings = state.swings.map((s) => (s.id === id ? fn(s) : s));
  if (affectsBaseline) state.swings = recomputeSession(state.swings);
  await persist(...state.swings.filter((s) => affectsBaseline || s.id === id));
  renderAll();
}

async function deleteSwing(id) {
  if (!confirm('Delete this swing?')) return;
  state.swings = recomputeSession(state.swings.filter((s) => s.id !== id));
  if (state.store) {
    await state.store.deleteSwing(id);
    await persist(...state.swings);
  }
  state.currentId = state.swings.at(-1)?.id ?? null;
  renderAll();
}

// ---------------------------------------------------------------- video flow

function drawVideoOverlay() {
  const video = $('video');
  const canvas = $('overlay');
  syncCanvas(canvas, video);
  const frames = state.video.pose?.frames;
  if (!frames?.length) { drawSkeleton(canvas, null); return; }
  const t = video.currentTime;
  const inRange = t >= frames[0].t - 0.05 && t <= frames[frames.length - 1].t + 0.05;
  drawSkeleton(canvas, inRange ? frames[nearestFrameIndex(frames, t)].lm : null);
}

function startOverlayLoop() {
  const video = $('video');
  if ('requestVideoFrameCallback' in video) {
    const tick = () => { drawVideoOverlay(); video.requestVideoFrameCallback(tick); };
    video.requestVideoFrameCallback(tick);
  }
  video.addEventListener('seeked', drawVideoOverlay);
  window.addEventListener('resize', () => { drawVideoOverlay(); renderReplay(currentSwing()); });
}

async function onFileSelected(file) {
  if (state.busy) return;
  showError('video-error', '');
  $('video-block').hidden = true;
  $('analyze-status').textContent = '';
  state.video = { meta: null, fpsInfo: null, pose: null, recordId: null };
  const video = $('video');
  try {
    state.video.meta = await loadVideoFile(video, file);
  } catch (err) {
    showError('video-error', `Could not load video: ${err.message}`);
    window.__swingDebug = { error: err.message };
    return;
  }
  $('video-block').hidden = false;
  const meta = state.video.meta;
  const renderMeta = () => renderDl($('video-meta'), [
    ['Video', `${meta.duration.toFixed(1)} s · ${meta.width}×${meta.height}`],
    ['Frame rate', state.video.fpsInfo?.reliable ? `${state.video.fpsInfo.fps.toFixed(1)} fps (measured)` : `unknown${state.video.fpsInfo ? ` — ${state.video.fpsInfo.reason}` : ''}`],
  ]);
  renderMeta();
  state.video.fpsInfo = await probeFrameRate(video);
  renderMeta();
  window.__swingDebug = { meta, fpsInfo: state.video.fpsInfo };
  drawVideoOverlay();
  const long = meta.duration > AUTO_ANALYZE_MAX_S;
  $('range-block').hidden = !long;
  $('range-start').value = '0';
  $('range-end').value = Math.min(meta.duration, DEFAULT_WINDOW_S).toFixed(1);
  if (!long) await analyzeVideo(0, meta.duration);
}

async function analyzeVideo(start, end) {
  if (state.busy) return;
  const video = $('video');
  const meta = state.video.meta;
  if (!(end > start)) { $('analyze-status').textContent = 'Invalid range: "To" must be after "From".'; return; }
  const fpsInfo = state.video.fpsInfo;
  const sampleFps = window.__forceSampleFps || (fpsInfo?.reliable ? Math.min(60, Math.round(fpsInfo.fps)) : 30);
  state.busy = true;
  $('analyze-btn').disabled = true;
  const prog = $('analyze-progress');
  prog.hidden = false;
  prog.value = 0;
  $('analyze-status').textContent = 'Loading pose model…';
  video.pause();
  try {
    const seq = await extractPoseSequence(video, {
      variant: $('model-variant').value, start, end, sampleFps,
      onProgress: (p, frame) => {
        prog.value = p;
        $('analyze-status').textContent = `Tracking pose… ${Math.round(p * 100)}%`;
        syncCanvas($('overlay'), video);
        drawSkeleton($('overlay'), frame.lm);
      },
    });
    state.video.pose = seq;
    $('analyze-status').textContent = 'Analyzing swing…';
    const analysis = analyzeSwing(seq);
    state.video.recordId = null;
    const record = await addSwing({
      seq,
      analysis,
      video: { name: meta.name, sizeBytes: meta.sizeBytes, duration: meta.duration, width: meta.width, height: meta.height, fps: fpsInfo?.reliable ? fpsInfo.fps : null, window: [start, end], model: seq.model, delegate: seq.delegate, processingMs: seq.processingMs },
    });
    state.video.recordId = record.id;
    renderReplay(currentSwing());
    $('analyze-status').textContent = `Done in ${(seq.processingMs / 1000).toFixed(1)} s. Record the next swing when ready.`;
    window.__swingDebug = { ...window.__swingDebug, pose: seq, analysis, recordId: record.id };
    video.currentTime = analysis.events?.motionStart ?? start;
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

// ---------------------------------------------------------------- demo swings

const DEMOS = {
  normal: { label: 'normal', params: {} },
  longStride: { label: 'longer stride', params: { strideLength: 1.4 } },
  shortStride: { label: 'shorter stride', params: { strideLength: 0.6 } },
  head: { label: 'more head movement', params: { headMoveX: 0.35, headMoveY: 0.12 } },
  handPath: { label: 'different hand path', params: { handRadius: 0.85, handPlaneSquash: 0.6 } },
  late: { label: 'later timing', params: { swingStart: 1.05, swingEnd: 1.35, finish: 1.7 } },
  badTracking: { label: 'tracking failure', params: {}, corrupt: (s) => dropFrames(s, 1.0, 1.3) },
};

async function addDemoSwing(kind) {
  const d = DEMOS[kind];
  const i = state.swings.length;
  let seq = generateSwing({ ...naturalVariation(i), ...d.params });
  if (d.corrupt) seq = d.corrupt(seq);
  delete seq.truth;
  await addSwing({ seq, analysis: analyzeSwing(seq), video: { synthetic: true, label: d.label, width: seq.width, height: seq.height, fps: seq.sampleFps } });
}

// ---------------------------------------------------------------- boot

async function boot() {
  $('app-version').textContent = `v${APP_VERSION}`;
  $('env-status').textContent = checkEnvironment();
  try {
    state.store = await openStore();
  } catch (err) {
    showError('app-error', `Local storage unavailable (${err.message}). Swings will be lost on reload.`);
  }
  $('start-session').addEventListener('click', startSession);
  $('end-session').addEventListener('click', endSession);
  $('export-session').addEventListener('click', exportCurrent);
  $('video-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onFileSelected(file);
  });
  $('analyze-btn').addEventListener('click', () => analyzeVideo(Math.max(0, Number($('range-start').value) || 0), Math.min($('video').duration, Number($('range-end').value) || 0)));
  document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => addDemoSwing(b.dataset.demo)));
  startOverlayLoop();

  if (state.store) {
    const active = await state.store.getMeta('activeSession');
    if (active) await resumeSession(active);
    if (!state.session) renderSessionList($('session-list'), await state.store.listSessions(), resumeSession);
  }
  renderAll();
  window.__appReady = true;
}

boot();
