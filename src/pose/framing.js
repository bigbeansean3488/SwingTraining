// Live camera framing check for the in-app recorder. Pure, no DOM.
// Given one pose (normalized landmarks) from the camera preview, says whether
// the batter is placed so that later analysis can work: whole body visible,
// big enough, and with room on both sides for the stride and the swing.
// The limits mirror pose QC (quality.js) with a safety margin; they are
// framing guidance, not validated thresholds.
import { LM, VIS_THRESHOLD } from './landmarks.js';

/** Guide box drawn on the preview, in normalized image coordinates. */
export const GUIDE = Object.freeze({
  left: 0.2, right: 0.8,   // keep the body between these (room for stride + hands)
  top: 0.05, bottom: 0.95, // head and feet inside, with margin
  ground: 0.88,            // suggested foot line
});

export const FRAMING_LIMITS = Object.freeze({
  minHeight: 0.4,  // body height / image height (QC fails < 0.20, warns < 0.30)
  maxHeight: 0.88, // above this the stride / follow-through will leave the frame
});

const vis = (p) => p && p[3] >= VIS_THRESHOLD;
const best = (lm, ids) => ids.map((i) => lm[i]).filter(vis);

/**
 * @param {number[][]|null} lm 33 landmarks [x, y, z, visibility], normalized
 * @returns {{ ok: boolean, checks: {key: string, ok: boolean, text: string}[], box: object|null }}
 */
export function assessFraming(lm, guide = GUIDE, limits = FRAMING_LIMITS) {
  if (!lm) {
    return { ok: false, box: null, checks: [{ key: 'person', ok: false, text: '沒有偵測到人：請讓打者站進框內' }] };
  }
  const head = best(lm, [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR, LM.LEFT_EYE, LM.RIGHT_EYE]);
  const feet = best(lm, [LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_HEEL, LM.RIGHT_HEEL]);
  const hips = best(lm, [LM.LEFT_HIP, LM.RIGHT_HIP]);
  const checks = [];

  const headOk = head.length > 0;
  const feetOk = feet.length > 0;
  const top = headOk ? Math.min(...head.map((p) => p[1])) : null;
  const bottom = feetOk ? Math.max(...feet.map((p) => p[1])) : null;
  const whole = headOk && feetOk && top >= guide.top && bottom <= guide.bottom;
  checks.push({
    key: 'whole',
    ok: whole,
    text: whole ? '全身（頭到雙腳）都在畫面內'
      : !feetOk || (bottom !== null && bottom > guide.bottom) ? '看不到雙腳：鏡頭拉遠或往下'
        : '頭太靠近邊緣：鏡頭拉遠或往上',
  });

  const height = headOk && feetOk ? bottom - top : null;
  const sizeOk = height !== null && height >= limits.minHeight && height <= limits.maxHeight;
  checks.push({
    key: 'size',
    ok: sizeOk,
    text: height === null ? '大小：需要看到頭和腳'
      : height < limits.minHeight ? `人太小（${Math.round(height * 100)}%）：手機靠近一點`
        : height > limits.maxHeight ? `人太大（${Math.round(height * 100)}%）：手機離遠一點`
          : '大小適中',
  });

  const cx = hips.length ? hips.reduce((s, p) => s + p[0], 0) / hips.length : null;
  const centerOk = cx !== null && cx >= guide.left + 0.1 && cx <= guide.right - 0.1;
  checks.push({
    key: 'center',
    ok: centerOk,
    text: cx === null ? '看不到身體中心' : centerOk ? '左右位置 OK（前後都有揮棒空間）'
      : cx < 0.5 ? '太靠左：打者往右站，或手機往左移' : '太靠右：打者往左站，或手機往右移',
  });

  const box = headOk && feetOk ? { top, bottom, cx } : null;
  return { ok: checks.every((c) => c.ok), checks, box };
}
