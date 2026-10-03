// Video loading + metadata. Browser-only (DOM); no analysis here.
import { estimateFrameRate, checkVideoFile } from '../analysis/frameRate.js';

const MEDIA_ERRORS = {
  1: 'Loading was aborted.',
  2: 'Network error while reading the file.',
  3: 'The video could not be decoded (corrupt file or unsupported codec).',
  4: 'This video format is not supported by this browser.',
};

let currentUrl = null;

/**
 * Load a File into a <video> element and resolve with basic metadata.
 * Rejects with a user-readable Error; never leaves the element half-loaded.
 */
export function loadVideoFile(video, file, { timeoutMs = 15000 } = {}) {
  const check = checkVideoFile(file);
  if (!check.ok) return Promise.reject(new Error(check.reason));

  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const fail = (msg) => {
      cleanup();
      video.removeAttribute('src');
      video.load();
      reject(new Error(msg));
    };
    const onLoaded = () => {
      cleanup();
      if (!video.videoWidth || !video.videoHeight) return fail('The file has no decodable video track.');
      if (!Number.isFinite(video.duration) || video.duration <= 0) return fail('Video duration could not be determined.');
      resolve({
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type || null,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    const onError = () => fail(MEDIA_ERRORS[video.error?.code] || 'The video could not be loaded.');
    timer = setTimeout(() => fail('Timed out while loading the video.'), timeoutMs);
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = currentUrl;
    video.load();
  });
}

/**
 * Play the video briefly (muted) and observe frame presentation times.
 * Returns estimateFrameRate()'s result; fps is null when it can't be
 * determined reliably. Restores the playhead afterwards.
 */
export async function probeFrameRate(video, { maxMs = 1500, maxFrames = 40 } = {}) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
    return { fps: null, reliable: false, reason: 'requestVideoFrameCallback not supported in this browser', pairs: 0, medianDelta: null };
  }
  const start = video.currentTime;
  const samples = [];
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const onFrame = (_now, meta) => {
      samples.push({ mediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames });
      if (samples.length >= maxFrames) finish();
      else video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    setTimeout(finish, maxMs);
    video.addEventListener('ended', finish, { once: true });
    video.play().catch(finish);
  });
  video.pause();
  video.currentTime = start;
  return estimateFrameRate(samples);
}

/** Seek and wait until the frame at `t` is ready to be drawn. */
export function seekTo(video, t) {
  return new Promise((resolve) => {
    const target = Math.min(Math.max(t, 0), video.duration);
    if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) return resolve();
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      // Safari can fire 'seeked' before the new frame is decoded; wait one
      // video frame callback when available.
      if ('requestVideoFrameCallback' in video) {
        let settled = false;
        video.requestVideoFrameCallback(() => { settled = true; resolve(); });
        setTimeout(() => { if (!settled) resolve(); }, 150);
      } else {
        resolve();
      }
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = target;
  });
}
