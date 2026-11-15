// User-facing names and plain-language explanations (Traditional Chinese).
import type { MetricResult, MotionKind } from '../../analysis/types';
import type { Trend, Stability } from '../../analysis/feedback';

export interface MetricInfo {
  label: string;
  desc: string;
  /** Which direction to call "larger" in feedback wording. */
  higherWord?: string;
  lowerWord?: string;
}

export const METRIC_INFO: Record<string, MetricInfo> = {
  phase_stance_ms: {
    label: '預備時間',
    desc: '影片開始到抬腳前。會受按下錄影的時間影響，僅供參考。',
  },
  phase_load_ms: { label: '抬腳 → 前腳著地', desc: '前腳開始移動到踩穩所花的時間。' },
  phase_plant_to_contact_ms: {
    label: '前腳著地 → 擊球',
    desc: '前腳踩穩到擊球瞬間（以手部速度最高點估計）的時間。',
  },
  phase_follow_ms: {
    label: '擊球 → 收棒',
    desc: '擊球後手部速度降到最高速四分之一以下所花的時間。',
  },
  stride_length: {
    label: '跨步長度',
    desc: '前腳著地時，前腳踝往投手方向移動的距離，以「軀幹長」為單位（肩膀中心到骨盆中心的長度）。',
  },
  pelvis_shift: {
    label: '重心前移量',
    desc: '擊球瞬間骨盆中心比預備姿勢往投手方向移動了多少（軀幹長）。',
  },
  head_dx: {
    label: '頭部水平位移',
    desc: '擊球瞬間頭部（鼻子）相對預備位置的水平移動；正值往投手方向，負值往捕手方向（軀幹長）。',
    higherWord: '更往投手方向',
    lowerWord: '更往捕手方向',
  },
  head_dy: {
    label: '頭部垂直位移',
    desc: '擊球瞬間頭部相對預備位置的上下移動；正值上升、負值下降（軀幹長）。',
    higherWord: '位置較高',
    lowerWord: '位置較低',
  },
  lead_knee_plant: {
    label: '前膝角度（著地）',
    desc: '前腳著地瞬間，髖－膝－踝的夾角；180° 為完全伸直。畫面上的 2D 角度。',
  },
  lead_knee_contact: {
    label: '前膝角度（擊球）',
    desc: '擊球瞬間的前膝夾角；180° 為完全伸直。畫面上的 2D 角度。',
  },
  lead_knee_release: {
    label: '前膝角度（出手）',
    desc: '出手瞬間的前膝夾角；180° 為完全伸直。畫面上的 2D 角度。',
  },
  trunk_tilt_contact: {
    label: '擊球瞬間軀幹傾斜',
    desc: '骨盆中心到肩膀中心的連線與垂直線的夾角；正值往投手方向、負值往捕手方向傾斜。',
    higherWord: '更往投手方向',
    lowerWord: '更往捕手方向',
  },
  wrist_peak_speed: {
    label: '手腕最大速度',
    desc: '兩手腕中點的最高移動速度（每秒幾個軀幹長）。不是棒速，只適合跟自己前後比較。',
  },
  wrist_peak_time_ms: {
    label: '手腕最大速度時間點',
    desc: '前腳著地後幾毫秒達到手腕最大速度。',
    higherWord: '較晚',
    lowerWord: '較早',
  },
  seq_pelvis_lead_ms: {
    label: '骨盆與肩膀啟動順序',
    desc: '正值代表骨盆比肩膀早開始轉動的毫秒數。2D 影片只能用身體投影寬度的變化粗略估計，誤差大。',
  },
  // Pitching
  phase_lift_to_plant_ms: {
    label: '抬腿最高點 → 前腳著地',
    desc: '抬腿到最高點後，到前腳踩穩的時間。',
  },
  phase_plant_to_release_ms: {
    label: '前腳著地 → 出手',
    desc: '前腳踩穩到出手（以投球手腕速度最高點估計）的時間。',
  },
  phase_release_to_finish_ms: {
    label: '出手 → 收尾',
    desc: '出手後手腕速度降到最高速四分之一以下的時間。',
  },
  phase_lift_to_release_ms: {
    label: '抬腿最高點 → 出手（總時間）',
    desc: '從抬腿最高點到出手的總時間。',
  },
  trunk_forward_release: {
    label: '出手瞬間軀幹前傾',
    desc: '出手瞬間骨盆中心到肩膀中心的連線與垂直線的夾角；正值往本壘方向前傾。',
  },
  elbow_height_plant: {
    label: '著地瞬間手肘相對肩線高度',
    desc: '前腳著地瞬間，投球手肘高於（正值）或低於（負值）兩肩連線的距離（軀幹長）。',
    higherWord: '較高',
    lowerWord: '較低',
  },
};

export const EVENT_LABELS: Record<MotionKind, Record<string, string>> = {
  batting: { stance: '預備', load: '抬腳', plant: '前腳著地', contact: '擊球', finish: '收棒' },
  pitching: { liftTop: '抬腿最高點', plant: '前腳著地', release: '出手', finish: '收尾' },
};

export const KIND_LABEL: Record<MotionKind, string> = { batting: '打擊', pitching: '投球' };

export const METRIC_ORDER: Record<MotionKind, string[]> = {
  batting: [
    'phase_stance_ms',
    'phase_load_ms',
    'phase_plant_to_contact_ms',
    'phase_follow_ms',
    'stride_length',
    'pelvis_shift',
    'head_dx',
    'head_dy',
    'lead_knee_plant',
    'lead_knee_contact',
    'trunk_tilt_contact',
    'wrist_peak_speed',
    'wrist_peak_time_ms',
    'seq_pelvis_lead_ms',
  ],
  pitching: [
    'phase_lift_to_plant_ms',
    'phase_plant_to_release_ms',
    'phase_release_to_finish_ms',
    'phase_lift_to_release_ms',
    'stride_length',
    'lead_knee_plant',
    'lead_knee_release',
    'trunk_forward_release',
    'elbow_height_plant',
  ],
};

export function formatMetric(m: Pick<MetricResult, 'value' | 'unit'>): string {
  switch (m.unit) {
    case 'torso':
      return `${m.value.toFixed(2)} 軀幹長`;
    case 'deg':
      return `${m.value.toFixed(0)}°`;
    case 'ms':
      return `${Math.round(m.value)} ms`;
    case 'torso/s':
      return `${m.value.toFixed(1)} 軀幹長/秒`;
    default:
      return `${m.value}`;
  }
}

export const FAILURE_TEXT: Record<string, string> = {
  too_few_frames: '影片太短，可分析的影格太少。',
  fps_too_low: '影格率太低（低於 24 fps），無法可靠分析時間。',
  tracking_poor: '大部分畫面追蹤不到人體。請確認全身入鏡、光線充足、背景不要有其他人。',
  person_too_small: '人在畫面中太小。請靠近一點拍攝。',
  events_not_found:
    '無法可靠偵測動作分期。請確認是側面機位、影片中只有一次完整動作；也可以在下方播放器手動標記事件。',
  timing_implausible:
    '動作時間異常地長。如果這是慢動作影片，可能在轉出時被「拉長」成一般速度播放；請依拍攝引導取得原始檔，或在選項填入實際拍攝 fps。',
  tracking_window: '動作過程中有太多畫面追蹤失敗（例如被遮擋或出鏡）。',
};

export const WARNING_TEXT: Record<string, string> = {
  fps_low: '影格率低於 100 fps，時間類指標精度有限。建議用 120 或 240 fps 慢動作拍攝。',
  finish_not_in_clip: '收尾動作不在分析範圍內，收尾時間可能不準。',
  load_at_clip_start: '影片開始時已經在動作中，預備階段可能不完整。',
  lift_at_clip_start: '影片開始時已經在抬腿，抬腿最高點可能不準。',
};

export function trendText(info: MetricInfo | undefined, trend: Trend): string {
  if (trend === 'similar') return '與你的平均相近';
  if (trend === 'higher') return `比你的平均${info?.higherWord ?? '變大'}`;
  return `比你的平均${info?.lowerWord ?? '變小'}`;
}

export function stabilityText(s: Stability): string | null {
  if (s === 'more_stable') return '最近 5 次變穩定';
  if (s === 'less_stable') return '最近 5 次波動變大';
  return null;
}

export const DISCLAIMER =
  '單支手機、單一視角的 2D 估計值，只適合跟自己的歷史比較趨勢，不是實驗室等級的量測。不代表好壞，也不做任何傷害或醫療判斷。';
