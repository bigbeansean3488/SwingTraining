// In-app recorder: live camera preview with a framing guide, a live
// "is the batter placed correctly" check, and MediaRecorder recording.
// Browser-only (DOM). The framing rules live in src/pose/framing.js.
import { GUIDE, assessFraming } from '../pose/framing.js';
import { detectCurrentFrame } from '../pose/mediapipe.js';
import { drawSkeleton } from './skeleton.js';
import { esc } from './dom.js';

const MIME_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const CHECK_EVERY_MS = 300;

export function canRecord() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.isSecureContext);
}

function pickMime() {
  return MIME_TYPES.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
}

function cameraError(err) {
  if (!window.isSecureContext) return '相機只能在 https 網址使用。';
  if (err?.name === 'NotAllowedError') return '沒有相機權限：請在 Safari 設定允許這個網站使用相機。';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return '找不到可用的相機。';
  return `無法開啟相機（${err?.message || err}）。`;
}

/** Draw the guide box, foot line and (optionally) the skeleton on the overlay. */
function drawGuide(canvas, lm, framing) {
  const ctx = canvas.getContext('2d');
  drawSkeleton(canvas, lm);
  const W = canvas.width;
  const H = canvas.height;
  const ok = framing?.ok;
  const color = ok ? '#46c27a' : '#f0b429';
  const lw = Math.max(3, W / 150);
  ctx.save();
  // Dim outside the box so the target area stands out.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  const x0 = GUIDE.left * W;
  const x1 = GUIDE.right * W;
  const y0 = GUIDE.top * H;
  const y1 = GUIDE.bottom * H;
  ctx.fillRect(0, 0, W, y0);
  ctx.fillRect(0, y1, W, H - y1);
  ctx.fillRect(0, y0, x0, y1 - y0);
  ctx.fillRect(x1, y0, W - x1, y1 - y0);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash(ok ? [] : [lw * 4, lw * 3]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  // Suggested foot line.
  ctx.setLineDash([lw * 2, lw * 2]);
  ctx.lineWidth = lw * 0.6;
  ctx.beginPath();
  ctx.moveTo(x0, GUIDE.ground * H);
  ctx.lineTo(x1, GUIDE.ground * H);
  ctx.stroke();
  ctx.restore();
}

/**
 * Open the recorder inside `host` (a full-screen container).
 * @param {{ onDone: (file: File) => void, onCancel: () => void, onPickFile: () => void }} handlers
 * @returns {{ close: () => void }}
 */
export function openRecorder(host, { onDone, onCancel, onPickFile }) {
  host.innerHTML = `
    <div class="rec" role="dialog" aria-modal="true" aria-label="錄影">
      <div class="rec-stage">
        <video class="rec-video" playsinline muted autoplay></video>
        <canvas class="rec-overlay"></canvas>
        <div class="rec-timer" hidden><span class="rec-dot" aria-hidden="true">●</span> <span class="rec-time">0:00</span></div>
      </div>
      <div class="rec-panel">
        <p class="rec-title">把打者全身放進框內</p>
        <ul class="rec-checks" aria-live="polite"><li class="todo">○ 正在開啟相機…</li></ul>
        <p class="muted small rec-tip">手機固定在腳架，從打者正側面（胸口那一側）拍。腳踩在虛線附近，前後留揮棒空間。</p>
        <div class="rec-actions">
          <button type="button" class="btn btn-secondary" data-rec="cancel">取消</button>
          <button type="button" class="btn btn-primary btn-lg rec-main" data-rec="record" disabled>● 開始錄影</button>
        </div>
      </div>
    </div>`;
  host.hidden = false;
  document.body.classList.add('rec-open');
  const video = host.querySelector('.rec-video');
  const canvas = host.querySelector('.rec-overlay');
  const checksEl = host.querySelector('.rec-checks');
  const mainBtn = host.querySelector('[data-rec="record"]');
  const timerEl = host.querySelector('.rec-timer');
  const titleEl = host.querySelector('.rec-title');

  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let closed = false;
  let checking = false;
  let lastCheck = 0;
  let lastLm = null;
  let framing = null;
  let wakeLock = null;
  let timerId = null;

  const sizeCanvas = () => {
    // The overlay covers the video's displayed picture (object-fit: contain).
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const box = video.getBoundingClientRect();
    const scale = Math.min(box.width / vw, box.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width === cw && canvas.height === ch && canvas.style.width === `${w}px`) return;
    canvas.width = cw;
    canvas.height = ch;
    Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, left: `${video.offsetLeft + (box.width - w) / 2}px`, top: `${video.offsetTop + (box.height - h) / 2}px` });
  };

  const renderChecks = (msg) => {
    if (msg) { checksEl.innerHTML = `<li class="todo">${esc(msg)}</li>`; return; }
    if (!framing) return;
    checksEl.innerHTML = framing.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><span aria-hidden="true">${c.ok ? '✓' : '!'}</span> ${esc(c.text)}</li>`).join('');
    titleEl.textContent = recorder ? '錄影中：連續打完再按停止' : framing.ok ? '位置 OK，可以開始錄影' : '把打者全身放進框內';
  };

  const loop = async () => {
    if (closed) return;
    const now = performance.now();
    if (!recorder && !checking && now - lastCheck > CHECK_EVERY_MS && video.readyState >= 2) {
      checking = true;
      lastCheck = now;
      try {
        lastLm = await detectCurrentFrame(video, 'lite');
        framing = assessFraming(lastLm);
        renderChecks();
      } catch (err) {
        console.warn('framing check failed', err);
        renderChecks('無法即時檢查位置（Pose 模型未載入），仍可錄影。');
      } finally {
        checking = false;
      }
    }
    sizeCanvas(); // cheap; the stage size changes when the checklist re-renders
    if (canvas.width) drawGuide(canvas, recorder ? null : lastLm, framing);
    requestAnimationFrame(loop);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timerId);
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ }
    stream?.getTracks().forEach((t) => t.stop());
    wakeLock?.release?.().catch(() => {});
    window.removeEventListener('resize', sizeCanvas);
    host.hidden = true;
    host.innerHTML = '';
    document.body.classList.remove('rec-open');
  };

  const startRecording = () => {
    const mimeType = pickMime();
    try {
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 8_000_000 });
    } catch (err) {
      renderChecks(`無法錄影：${err.message}`);
      return;
    }
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'video/mp4';
      const ext = type.includes('webm') ? 'webm' : 'mp4';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = new File(chunks, `swing-recording-${stamp}.${ext}`, { type: type.split(';')[0] });
      close();
      if (file.size) onDone(file); else onCancel();
    };
    recorder.start(1000);
    startedAt = performance.now();
    timerEl.hidden = false;
    timerId = setInterval(() => {
      const s = Math.floor((performance.now() - startedAt) / 1000);
      host.querySelector('.rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    mainBtn.textContent = '■ 停止並分析';
    mainBtn.classList.add('is-recording');
    host.querySelector('[data-rec="cancel"]').hidden = true;
    renderChecks();
  };

  host.querySelector('.rec').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rec]');
    if (!b) return;
    if (b.dataset.rec === 'cancel') { close(); onCancel(); }
    if (b.dataset.rec === 'pick') { close(); onPickFile(); }
    if (b.dataset.rec === 'record') {
      if (!recorder) startRecording();
      else if (recorder.state === 'recording') { mainBtn.disabled = true; mainBtn.textContent = '處理中…'; recorder.stop(); }
    }
  });

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
      });
    } catch (err) {
      if (closed) return;
      checksEl.innerHTML = `<li class="bad"><span aria-hidden="true">⚠</span> ${esc(cameraError(err))}</li>`;
      host.querySelector('.rec-actions').innerHTML = `
        <button type="button" class="btn btn-secondary" data-rec="cancel">取消</button>
        <button type="button" class="btn btn-primary btn-lg rec-main" data-rec="pick">改用相簿選影片</button>`;
      return;
    }
    if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    await new Promise((r) => (video.readyState >= 1 ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);
    mainBtn.disabled = false;
    renderChecks('○ 正在檢查打者位置…');
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
    requestAnimationFrame(loop);
  })();

  return { close };
}
