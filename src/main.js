// Entry point / controller for the practice-first UI.
//   訓練: Setup (no session) → Practice loop (＋ 下一棒 → auto analysis → result → Contact → ＋ 下一棒)
//   紀錄: Review of the current session
//   設定: session/player/data management + Developer Tools (debug)
// Analysis logic lives in src/analysis and must not import from src/ui.
import { loadVideoFile, probeFrameRate } from './ui/video.js';
import { extractPoseSequence } from './pose/mediapipe.js';
import { drawSkeleton, syncCanvas, nearestFrameIndex } from './ui/skeleton.js';
import { analyzeSwing } from './analysis/pipeline.js';
import {
  createSession, createSwingRecord, setContactLabel, recomputeSession, exportSession,
  updatePlayers, playersFromSessions, sessionFocus, FOCUS_KEYS,
} from './app/session.js';
import { FOCUS, SIDE_ZH } from './app/interpret.js';
import { openStore } from './storage/indexedDb.js';
import { $, delegate } from './ui/dom.js';
import { openDialog } from './ui/dialog.js';
import { renderSetup, GUEST } from './ui/views/setup.js';
import { renderStatus, renderResult, renderRecent } from './ui/views/practice.js';
import { renderReview } from './ui/views/review.js';
import { renderDetail } from './ui/views/detail.js';
import { renderSettings } from './ui/views/settings.js';
import { generateSwing, dropFrames } from './synthetic/swing.js';
import { naturalVariation } from './synthetic/session.js';

export const APP_VERSION = '0.10.0';
const AUTO_ANALYZE_MAX_S = 10;
const PRE_ROLL_S = 3; // "分析這個位置": window = [t − 3 s, t + 2 s]
const POST_ROLL_S = 2;

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  store: null,
  session: null,
  swings: [],
  sessions: [],
  players: [],
  tab: 'train',
  setup: { name: '', side: 'R', focus: 'motion' },
  status: null, // { stage: 'load'|'choose'|'track'|'compute', progress } | { error }
  videoPanel: false,
  detailId: null,
  debug: new URLSearchParams(location.search).get('debug') === '1' || ls.get('swingtraining.debug') === '1',
  poseModel: ls.get('swingtraining.model') || 'full',
  video: { meta: null, fpsInfo: null, pose: null, recordId: null },
  busy: false,
  lastDiag: null,
};
window.__app = state; // for automated browser checks

// ---------------------------------------------------------------- helpers

function envSummary() {
  const checks = {
    IndexedDB: 'indexedDB' in window,
    WebAssembly: typeof WebAssembly === 'object',
    WebGL2: !!document.createElement('canvas').getContext('webgl2'),
    FrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
  };
  return `${Object.entries(checks).map(([n, ok]) => `${ok ? '✓' : '✗'} ${n}`).join('  ')}  · ${navigator.userAgent}`;
}

function diagSummary() {
  return JSON.stringify({
    version: APP_VERSION,
    poseModel: state.poseModel,
    storage: !!state.store,
    session: state.session?.id ?? null,
    swings: state.swings.length,
    lastVideo: state.video.meta ? { name: state.video.meta.name, duration: state.video.meta.duration, size: `${state.video.meta.width}x${state.video.meta.height}`, fps: state.video.fpsInfo } : null,
    lastAnalysis: state.lastDiag,
  }, null, 2);
}

async function persist(...swings) {
  if (!state.store || !swings.length) return;
  try { await state.store.putSwings(swings); } catch (e) { console.warn('save failed', e); }
}

const focus = () => sessionFocus(state.session);
const newest = () => state.swings.at(-1) || null;

function showError(msg) {
  const el = $('app-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

// ---------------------------------------------------------------- rendering

function render() {
  const active = !!state.session;
  const t = state.tab;
  $('view-setup').hidden = !(t === 'train' && !active);
  $('view-practice').hidden = !(t === 'train' && active);
  $('view-review').hidden = t !== 'review';
  $('view-settings').hidden = t !== 'settings';
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const chip = $('session-menu-btn');
  chip.hidden = !active;
  if (active) {
    const s = state.session;
    $('session-chip-text').textContent = `${s.playerName || GUEST} · ${s.battingSide ? SIDE_ZH[s.battingSide] : '—'} · ${state.swings.length} 棒`;
  }
  // While choosing the swing in a long clip, 分析這個位置 is the one primary action.
  $('action-bar').hidden = !(t === 'train' && active) || !!state.detailId || state.status?.stage === 'choose';
  document.body.classList.toggle('has-action-bar', !$('action-bar').hidden);
  renderNextButton();

  if (!$('view-setup').hidden) {
    renderSetup($('view-setup'), { players: state.players, ...state.setup, sessions: state.sessions });
  }
  if (!$('view-practice').hidden) renderPractice();
  if (t === 'review') renderReview($('view-review'), { session: state.session, swings: state.swings, focus: focus(), sessions: state.sessions });
  if (t === 'settings') {
    renderSettings($('view-settings'), {
      session: state.session, swings: state.swings, players: state.players, sessions: state.sessions,
      debug: state.debug, poseModel: state.poseModel, env: state.debug ? envSummary() : '', diag: state.debug ? diagSummary() : '', version: APP_VERSION,
    });
  }
  renderSheet();
}

function renderPractice() {
  renderStatus($('practice-status'), state.status);
  $('video-panel').hidden = !state.videoPanel;
  $('range-block').hidden = state.status?.stage !== 'choose';
  const n = newest();
  const busy = state.busy || state.status?.stage === 'choose';
  // While a new swing is being analyzed, don't show the previous result as if it were current.
  const res = $('practice-result');
  if (busy) res.innerHTML = '';
  else renderResult(res, n, focus(), state.swings.slice(0, -1), { showVideoButton: !!n && n.id === state.video.recordId });
  renderRecent($('practice-recent'), state.swings, focus());
}

function renderNextButton() {
  const btn = $('next-btn');
  const busy = state.busy;
  btn.classList.toggle('is-busy', busy);
  btn.setAttribute('aria-disabled', String(busy));
  $('video-input').disabled = busy;
  $('next-btn-text').textContent = busy ? '分析中…' : '＋ 下一棒';
}

function renderSheet() {
  const sheet = $('sheet');
  const sw = state.swings.find((s) => s.id === state.detailId);
  if (!sw) {
    state.detailId = null;
    sheet.hidden = true;
    sheet.innerHTML = '';
    document.body.classList.remove('sheet-open');
    return;
  }
  const i = state.swings.indexOf(sw);
  // Show first so the replay canvas can measure its container.
  sheet.hidden = false;
  document.body.classList.add('sheet-open');
  renderDetail(sheet, sw, { focus: focus(), previous: state.swings.slice(0, i), allSwings: state.swings, debug: state.debug });
}

// ---------------------------------------------------------------- session ops

async function loadSessionsAndPlayers() {
  if (!state.store) return;
  state.sessions = await state.store.listSessions();
  const stored = await state.store.getMeta('players');
  state.players = stored ?? playersFromSessions(state.sessions);
}

function defaultSetup() {
  const p = state.players[0];
  const lastFocus = ls.get('swingtraining.focus');
  state.setup = { name: p?.name ?? '', side: p?.battingSide ?? 'R', focus: FOCUS_KEYS.includes(lastFocus) ? lastFocus : 'motion' };
}

async function startSession() {
  const typed = $('player-name')?.value.trim() ?? '';
  const name = typed || (state.setup.name === GUEST ? '' : state.setup.name);
  const session = createSession({ playerName: name, battingSide: state.setup.side, focus: state.setup.focus });
  ls.set('swingtraining.focus', state.setup.focus);
  state.session = session;
  state.swings = [];
  state.status = null;
  state.videoPanel = false;
  if (name) state.players = updatePlayers(state.players, { name, battingSide: state.setup.side });
  if (state.store) {
    await state.store.putSession(session);
    await state.store.setMeta('activeSession', session.id);
    await state.store.setMeta('players', state.players);
    state.sessions = await state.store.listSessions();
  }
  state.tab = 'train';
  render();
  window.scrollTo(0, 0);
}

async function resumeSession(id) {
  if (!state.store) return;
  const session = await state.store.getSession(id);
  if (!session) return;
  state.session = session;
  state.swings = await state.store.listSwings(id);
  state.status = null;
  state.videoPanel = false;
  await state.store.setMeta('activeSession', id);
  state.tab = 'train';
  render();
}

async function endSession() {
  const r = await openDialog({
    title: '結束目前 Session？',
    body: '目前資料已儲存在此裝置，之後可以在「紀錄」或「設定」中再打開。',
    actions: [{ label: '取消', value: null }, { label: '結束並建立新 Session', kind: 'primary', value: 'end' }],
  });
  if (!r) return;
  state.session = null;
  state.swings = [];
  state.detailId = null;
  state.status = null;
  state.videoPanel = false;
  if (state.store) {
    await state.store.setMeta('activeSession', null);
    state.sessions = await state.store.listSessions();
  }
  defaultSetup();
  state.tab = 'train';
  render();
}

async function saveSession() {
  if (state.store) await state.store.putSession(state.session);
}

async function renameSession() {
  const r = await openDialog({
    title: '重新命名',
    input: { label: '球員名稱', value: state.session.playerName, placeholder: '例如：Sean' },
    actions: [{ label: '取消', value: null }, { label: '儲存', kind: 'primary', value: 'ok' }],
  });
  if (!r) return;
  state.session = { ...state.session, playerName: (r.text || '').trim() };
  if (state.session.playerName) state.players = updatePlayers(state.players, { name: state.session.playerName, battingSide: state.session.battingSide });
  await saveSession();
  if (state.store) await state.store.setMeta('players', state.players);
  render();
}

async function changeFocus() {
  const r = await openDialog({
    title: '變更 Training Focus',
    body: '只會改變結果畫面上最大的那個指標，不影響已分析的資料。',
    actions: [...FOCUS_KEYS.map((k) => ({ label: FOCUS[k].label, kind: k === focus() ? 'primary' : 'plain', value: k })), { label: '取消', value: null }],
  });
  if (!r) return;
  state.session = { ...state.session, focus: r.value };
  ls.set('swingtraining.focus', r.value);
  await saveSession();
  render();
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

async function sessionMenu() {
  const r = await openDialog({
    title: `${state.session.playerName || GUEST} 的 Session`,
    actions: [
      { label: '查看 Session 紀錄', value: 'review' },
      { label: '匯出資料', value: 'export' },
      { label: '重新命名', value: 'rename' },
      { label: '變更 Training Focus', value: 'focus' },
      { label: '結束 Session', value: 'end' },
      { label: '關閉', value: null },
    ],
  });
  if (!r) return;
  if (r.value === 'review') { state.tab = 'review'; render(); }
  if (r.value === 'export') exportCurrent();
  if (r.value === 'rename') renameSession();
  if (r.value === 'focus') changeFocus();
  if (r.value === 'end') endSession();
}

async function addSwing({ seq, analysis, video }) {
  const record = createSwingRecord({ session: state.session, seq, analysis, video, previous: state.swings });
  state.swings.push(record);
  await persist(record);
  return record;
}

async function updateSwing(id, fn, affectsBaseline) {
  state.swings = state.swings.map((s) => (s.id === id ? fn(s) : s));
  if (affectsBaseline) state.swings = recomputeSession(state.swings);
  await persist(...state.swings.filter((s) => affectsBaseline || s.id === id));
  render();
}

async function deleteSwing(id) {
  const sw = state.swings.find((s) => s.id === id);
  const r = await openDialog({
    title: `刪除 Swing #${sw?.number}？`,
    body: '刪除後無法復原，之後的比較會重新計算。',
    actions: [{ label: '取消', value: null }, { label: '刪除', kind: 'danger', value: 'delete' }],
  });
  if (!r) return;
  state.swings = recomputeSession(state.swings.filter((s) => s.id !== id));
  if (state.store) {
    await state.store.deleteSwing(id);
    await persist(...state.swings);
  }
  state.detailId = null;
  render();
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
  window.addEventListener('resize', () => { drawVideoOverlay(); if (state.detailId) renderSheet(); });
}

function setStatus(st) {
  state.status = st;
  render();
}

async function onFileSelected(file) {
  if (state.busy || !state.session) return;
  state.busy = true;
  state.tab = 'train';
  state.video = { meta: null, fpsInfo: null, pose: null, recordId: null };
  state.videoPanel = true;
  render();
  setStatus({ stage: 'load' });
  window.scrollTo(0, 0);
  const video = $('video');
  try {
    state.video.meta = await loadVideoFile(video, file);
  } catch (err) {
    state.busy = false;
    state.videoPanel = false;
    setStatus({ error: `無法讀取這支影片：${err.message}` });
    window.__swingDebug = { error: err.message };
    return;
  }
  const meta = state.video.meta;
  state.video.fpsInfo = await probeFrameRate(video);
  const fps = state.video.fpsInfo;
  $('video-meta').textContent = `${meta.duration.toFixed(1)} 秒 · ${meta.width}×${meta.height}${fps?.reliable ? ` · ${fps.fps.toFixed(0)} FPS` : ''}`;
  window.__swingDebug = { meta, fpsInfo: fps };
  drawVideoOverlay();
  if (meta.duration > AUTO_ANALYZE_MAX_S) {
    state.busy = false;
    $('range-start').value = '0';
    $('range-end').value = Math.min(meta.duration, 8).toFixed(1);
    setStatus({ stage: 'choose' });
    return;
  }
  await analyzeVideo(0, meta.duration);
}

async function analyzeVideo(start, end) {
  const video = $('video');
  const meta = state.video.meta;
  if (!meta || !(end > start)) return;
  const fpsInfo = state.video.fpsInfo;
  const sampleFps = window.__forceSampleFps || (fpsInfo?.reliable ? Math.min(60, Math.round(fpsInfo.fps)) : 30);
  state.busy = true;
  setStatus({ stage: 'track', progress: 0 });
  video.pause();
  try {
    const seq = await extractPoseSequence(video, {
      variant: state.poseModel, start, end, sampleFps,
      onProgress: (p, frame) => {
        state.status = { stage: 'track', progress: p };
        renderStatus($('practice-status'), state.status);
        syncCanvas($('overlay'), video);
        drawSkeleton($('overlay'), frame.lm);
      },
    });
    state.video.pose = seq;
    setStatus({ stage: 'compute' });
    await new Promise((r) => setTimeout(r, 0)); // let the stage render
    const analysis = analyzeSwing(seq);
    const record = await addSwing({
      seq,
      analysis,
      video: { name: meta.name, sizeBytes: meta.sizeBytes, duration: meta.duration, width: meta.width, height: meta.height, fps: fpsInfo?.reliable ? fpsInfo.fps : null, window: [start, end], model: seq.model, delegate: seq.delegate, processingMs: seq.processingMs },
    });
    state.video.recordId = record.id;
    state.lastDiag = { status: analysis.status, reason: analysis.reason, qc: analysis.qc?.level, frames: seq.frames.length, sampleFps, processingMs: seq.processingMs, delegate: seq.delegate };
    window.__swingDebug = { ...window.__swingDebug, pose: seq, analysis, recordId: record.id };
    video.currentTime = analysis.events?.motionStart ?? start;
    state.status = null;
    state.videoPanel = false;
  } catch (err) {
    console.error(err);
    state.status = { error: `分析失敗：${err.message}` };
    window.__swingDebug = { ...window.__swingDebug, poseError: err.message };
  } finally {
    state.busy = false;
    render();
    window.scrollTo(0, 0);
  }
}

// ---------------------------------------------------------------- synthetic (Developer Tools)

const DEMO_PARAMS = {
  normal: { label: 'normal', params: {} },
  longStride: { label: 'longer stride', params: { strideLength: 1.4 } },
  shortStride: { label: 'shorter stride', params: { strideLength: 0.6 } },
  head: { label: 'more head movement', params: { headMoveX: 0.35, headMoveY: 0.12 } },
  handPath: { label: 'different hand path', params: { handRadius: 0.85, handPlaneSquash: 0.6 } },
  late: { label: 'later timing', params: { swingStart: 1.05, swingEnd: 1.35, finish: 1.7 } },
  badTracking: { label: 'tracking failure', params: {}, corrupt: (s) => dropFrames(s, 1.0, 1.3) },
};

async function addDemoSwing(kind) {
  if (!state.session) return;
  const d = DEMO_PARAMS[kind];
  let seq = generateSwing({ ...naturalVariation(state.swings.length), ...d.params });
  if (d.corrupt) seq = d.corrupt(seq);
  delete seq.truth;
  const analysis = analyzeSwing(seq);
  await addSwing({ seq, analysis, video: { synthetic: true, label: d.label, width: seq.width, height: seq.height, fps: seq.sampleFps } });
  state.lastDiag = { status: analysis.status, reason: analysis.reason, qc: analysis.qc?.level, synthetic: d.label };
  state.tab = 'train';
  state.status = null;
  state.videoPanel = false;
  render();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- events

function bindEvents() {
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    state.detailId = null;
    render();
    window.scrollTo(0, 0);
  }));
  $('session-menu-btn').addEventListener('click', sessionMenu);

  const input = $('video-input');
  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onFileSelected(file);
  });
  $('next-btn').addEventListener('click', (e) => { if (state.busy) e.preventDefault(); });
  $('next-btn').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !state.busy) { e.preventDefault(); input.click(); }
  });
  $('analyze-here').addEventListener('click', () => {
    const v = $('video');
    const t = v.currentTime;
    analyzeVideo(Math.max(0, t - PRE_ROLL_S), Math.min(v.duration, t + POST_ROLL_S));
  });
  $('analyze-btn').addEventListener('click', () => {
    const v = $('video');
    analyzeVideo(Math.max(0, Number($('range-start').value) || 0), Math.min(v.duration, Number($('range-end').value) || 0));
  });

  // Setup
  const keepTypedName = () => { const v = $('player-name')?.value.trim(); if (v) state.setup.name = v; };
  delegate($('view-setup'), {
    pickPlayer: ({ name }) => {
      const p = state.players.find((x) => x.name === name);
      state.setup = { ...state.setup, name, side: p?.battingSide ?? state.setup.side };
      render();
    },
    pickSide: ({ side }) => { keepTypedName(); state.setup.side = side; render(); },
    pickFocus: ({ focus: f }) => { keepTypedName(); state.setup.focus = f; render(); },
    start: startSession,
    resume: ({ id }) => resumeSession(id),
  });
  $('view-setup').addEventListener('input', (e) => {
    if (e.target.id !== 'player-name') return;
    const v = e.target.value.trim();
    const p = state.players.find((x) => x.name === v);
    state.setup.name = v;
    if (p?.battingSide) state.setup.side = p.battingSide;
    document.querySelectorAll('#view-setup .chip').forEach((c) => {
      const on = c.dataset.name === v;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', String(on));
    });
  });

  // Practice + Review + Sheet share swing actions.
  const swingActions = {
    contact: ({ id, label }) => {
      const sw = state.swings.find((s) => s.id === id);
      updateSwing(id, (s) => setContactLabel(s, sw.contact === label ? null : label), false);
    },
    openSwing: ({ id }) => { state.detailId = id; render(); $('sheet').scrollTop = 0; },
    closeSheet: () => { state.detailId = null; render(); },
    toggleVideo: () => { state.videoPanel = !state.videoPanel; renderPractice(); if (state.videoPanel) $('video-panel').scrollIntoView({ block: 'nearest' }); },
    exclude: ({ id }, el) => updateSwing(id, (s) => ({ ...s, excludeFromBaseline: el.checked }), true),
    deleteSwing: ({ id }) => deleteSwing(id),
    resume: ({ id }) => resumeSession(id),
  };
  delegate($('view-practice'), swingActions);
  delegate($('view-review'), swingActions);
  delegate($('sheet'), swingActions);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.detailId && $('dialog').hidden) swingActions.closeSheet(); });

  // Settings
  delegate($('view-settings'), {
    rename: renameSession,
    changeFocus,
    export: exportCurrent,
    endSession,
    resume: ({ id }) => resumeSession(id),
    removePlayer: async ({ name }) => {
      state.players = state.players.filter((p) => p.name !== name);
      if (state.store) await state.store.setMeta('players', state.players);
      render();
    },
    toggleDebug: (_d, el) => {
      state.debug = el.checked;
      ls.set('swingtraining.debug', state.debug ? '1' : '0');
      render();
    },
    demo: (d) => addDemoSwing(d.demo),
  });
  $('view-settings').addEventListener('change', (e) => {
    if (e.target.id === 'model-variant') {
      state.poseModel = e.target.value;
      ls.set('swingtraining.model', state.poseModel);
    }
  });
}

// ---------------------------------------------------------------- boot

async function boot() {
  // Never hang on storage: if IndexedDB doesn't open in time (seen in Chrome
  // when a previous page was closed mid-upgrade), continue in memory and say so.
  try {
    state.store = await openStore(globalThis.indexedDB, undefined, { timeoutMs: 4000 });
  } catch (err) {
    showError(`這個瀏覽器目前無法使用本機儲存（${err.message}），重新整理後資料會遺失。`);
  }
  bindEvents();
  startOverlayLoop();
  await loadSessionsAndPlayers();
  defaultSetup();
  if (state.store) {
    const active = await state.store.getMeta('activeSession');
    if (active) {
      const session = await state.store.getSession(active);
      if (session) {
        state.session = session;
        state.swings = await state.store.listSwings(active);
      }
    }
  }
  render();
  window.__appReady = true;
}

boot();
