// User-facing names and plain-language explanations (Traditional Chinese).
import type { MetricResult, MotionKind } from '../../analysis/types';
import type { RangeReport, Stability, Trend } from '../../analysis/feedback';

export interface MetricInfo {
  label: string;
  /** What is measured, in everyday words. */
  what: string;
  /** Why coaches look at it (no judgement of good or bad). */
  why: string;
  /** Where a single phone video is inaccurate. */
  limit: string;
  /** Kept for older pages: same as `what`. */
  desc: string;
  /** Adjective for a larger / smaller value, e.g. 長 / 短, 直 / 彎. */
  big: string;
  small: string;
  /** Hidden behind "其他指標" by default because it is unreliable or not about the motion. */
  hidden?: boolean;
}

type InfoInput = Omit<MetricInfo, 'desc' | 'big' | 'small'> & { big?: string; small?: string };
const info = (i: InfoInput): MetricInfo => ({ big: '大', small: '小', ...i, desc: i.what });

const KNEE_LIMIT =
  '是畫面上的平面角度。膝蓋朝向鏡頭或背對鏡頭時會失真；手機要放在正側面、與腰同高。';
const PHASE_LIMIT =
  '時間精度取決於影格率：30 fps 每格約 33 毫秒，240 fps 每格約 4 毫秒。建議用慢動作拍攝。';

/** Shared by batting and pitching unless overridden in METRIC_INFO_BY_KIND. */
export const METRIC_INFO: Record<string, MetricInfo> = {
  // --- Batting -------------------------------------------------------------
  phase_stance_ms: info({
    label: '預備時間',
    what: '從影片開始到前腳開始移動的時間。',
    why: '只用來確認影片有拍到完整的預備姿勢。',
    limit: '取決於什麼時候按下錄影，不代表動作本身，所以預設不顯示。',
    big: '長',
    small: '短',
    hidden: true,
  }),
  phase_load_ms: info({
    label: '抬腳到踩下',
    what: '前腳開始離地移動，到踩穩地面所花的時間。',
    why: '這是打者準備揮棒的節奏。教練常拿來看每次的節奏是否一致。',
    limit: PHASE_LIMIT,
    big: '長',
    small: '短',
  }),
  phase_plant_to_contact_ms: info({
    label: '踩下到擊球',
    what: '前腳踩穩到擊球瞬間的時間。',
    why: '代表前腳踩穩之後，多快把棒子揮到擊球點。',
    limit: `擊球瞬間是用「手移動最快的時候」估計，不是真的看到球碰到棒子。${PHASE_LIMIT}`,
    big: '長',
    small: '短',
  }),
  phase_follow_ms: info({
    label: '擊球到收棒',
    what: '擊球後，到手的速度慢下來（收棒）所花的時間。',
    why: '看擊球後的動作有沒有做完整。',
    limit: '影片太早結束時，收棒可能不在畫面裡而不準。',
    big: '長',
    small: '短',
  }),
  stride_length: info({
    label: '跨步長度',
    what: '前腳從預備時的位置，往投手方向跨出去多遠。',
    why: '跨步大小會影響重心移動和揮棒時機。教練常要求每次跨步差不多。',
    limit: '只算水平方向。手機沒有放在正側面時，距離會被看短。',
    big: '長',
    small: '短',
  }),
  lead_knee_plant: info({
    label: '前膝角度（踩下時）',
    what: '前腳踩下那一刻，前膝蓋彎多少。180° 是完全打直，數字越小彎得越多。',
    why: '看前腳踩下時，膝蓋是彎著緩衝，還是比較直。',
    limit: KNEE_LIMIT,
    big: '直',
    small: '彎',
  }),
  lead_knee_contact: info({
    label: '前膝角度（擊球時）',
    what: '擊球那一刻，前膝蓋彎多少。180° 是完全打直。',
    why: '跟「踩下時」比較，可以看出前腳從踩下到擊球，是伸直撐住還是繼續彎。',
    limit: KNEE_LIMIT,
    big: '直',
    small: '彎',
  }),
  pelvis_shift: info({
    label: '重心前移',
    what: '擊球時，骨盆中心（約在肚臍下方）比預備時往投手方向移動多少。',
    why: '看身體重心往前移的程度。',
    limit: '骨盆位置由左右髖關節估計，衣服寬鬆或被手臂擋住時較不準。',
  }),
  head_dx: info({
    label: '頭部前後移動',
    what: '擊球時，頭比預備時往前（投手方向）或往後（捕手方向）移了多少。正值是往前。',
    why: '頭的移動會影響看球，教練常會注意頭有沒有跟著身體跑。',
    limit: '用鼻子的位置代表頭。戴頭盔、頭轉向側面時，位置可能偏移。',
    big: '往前',
    small: '往後',
  }),
  head_dy: info({
    label: '頭部上下移動',
    what: '擊球時，頭比預備時高或低多少。正值是變高。',
    why: '看身體在揮棒過程中有沒有上下起伏。',
    limit: '用鼻子的位置代表頭；低頭、抬頭也會被算進去。',
    big: '高',
    small: '低',
  }),
  trunk_tilt_contact: info({
    label: '上半身傾斜（擊球時）',
    what: '擊球時，骨盆中心到肩膀中心的連線跟垂直線的夾角。正值是往投手方向倒，負值是往捕手方向倒。',
    why: '看擊球時身體是往前、直立，還是往後。',
    limit: '是畫面上的平面角度，手機不在正側面時會失真。',
    big: '往投手方向',
    small: '往捕手方向',
  }),
  wrist_peak_speed: info({
    label: '手部最快速度',
    what: '兩手腕中間點移動最快時的速度，單位是「每秒幾個軀幹長」。',
    why: '只用來看自己這次揮得比以前快還是慢。',
    limit: '不是棒速，也不能跟別人比較。影格率低時會低估。',
    big: '快',
    small: '慢',
  }),
  wrist_peak_time_ms: info({
    label: '手部最快的時機',
    what: '前腳踩穩之後，過了多久手的速度達到最快。',
    why: '看出手的時機是早還是晚。',
    limit: PHASE_LIMIT,
    big: '晚',
    small: '早',
  }),
  seq_pelvis_lead_ms: info({
    label: '骨盆與肩膀的轉動順序',
    what: '骨盆比肩膀早多少毫秒開始轉動；正值代表骨盆先轉。',
    why: '研究常討論「下半身先轉、上半身後轉」的順序。',
    limit:
      '一支手機從側面看不到轉動，只能從身體在畫面上變窄來推測，誤差很大，所以預設不顯示、僅供參考。',
    big: '大',
    small: '小',
    hidden: true,
  }),

  // --- Pitching ------------------------------------------------------------
  phase_lift_to_plant_ms: info({
    label: '抬腿最高點到踩下',
    what: '抬腿到最高點之後，到前腳踩穩地面的時間。',
    why: '這是身體往本壘移動的節奏。',
    limit: PHASE_LIMIT,
    big: '長',
    small: '短',
  }),
  phase_plant_to_release_ms: info({
    label: '踩下到出手',
    what: '前腳踩穩到球出手的時間。',
    why: '代表前腳踩穩之後，多快完成出手。',
    limit: `出手瞬間是用「投球手移動最快的時候」估計。${PHASE_LIMIT}`,
    big: '長',
    small: '短',
  }),
  phase_release_to_finish_ms: info({
    label: '出手到收尾',
    what: '出手後，到投球手的速度慢下來（收尾）所花的時間。',
    why: '看出手後的動作有沒有做完整。',
    limit: '影片太早結束時，收尾可能不在畫面裡而不準。',
    big: '長',
    small: '短',
  }),
  phase_lift_to_release_ms: info({
    label: '抬腿最高點到出手',
    what: '從抬腿最高點到出手的總時間。',
    why: '整個投球動作的節奏，可以看每一球是否一致。',
    limit: PHASE_LIMIT,
    big: '長',
    small: '短',
  }),
  lead_knee_release: info({
    label: '前膝角度（出手時）',
    what: '出手那一刻，前膝蓋彎多少。180° 是完全打直。',
    why: '跟「踩下時」比較，可以看出前腳從踩下到出手，是伸直撐住還是繼續彎。',
    limit: KNEE_LIMIT,
    big: '直',
    small: '彎',
  }),
  trunk_forward_release: info({
    label: '上半身前傾（出手時）',
    what: '出手時，骨盆中心到肩膀中心的連線往本壘方向前傾幾度。',
    why: '看出手時身體往前傾的程度。',
    limit: '是畫面上的平面角度，手機不在正側面時會失真。',
    big: '前傾多',
    small: '前傾少',
  }),
  elbow_height_plant: info({
    label: '手肘高度（踩下時）',
    what: '前腳踩下時，投球手的手肘比左右肩膀的連線高（正值）或低（負值）多少。',
    why: '看手臂抬起來的位置是否每次一致。',
    limit: '手肘被身體擋住時不準；手機要放在投手的正側面。',
    big: '高',
    small: '低',
  }),
};

/** Metrics whose meaning differs by motion. */
const METRIC_INFO_BY_KIND: Record<MotionKind, Record<string, MetricInfo>> = {
  batting: {},
  pitching: {
    stride_length: info({
      label: '跨步長度',
      what: '前腳踩下時，前腳踝和後腳踝在水平方向相距多遠。',
      why: '跨步大小會影響身體往本壘移動的方式。教練常要求每一球跨步差不多。',
      limit:
        '只算水平方向，手機沒有放在正側面時會被看短。研究常用「身高的百分比」表示跨步，這裡用軀幹長，兩者不能直接換算。',
      big: '長',
      small: '短',
    }),
    lead_knee_plant: info({
      label: '前膝角度（踩下時）',
      what: '前腳踩下那一刻，前膝蓋彎多少。180° 是完全打直。',
      why: '看前腳著地時的姿勢，並跟出手時比較。',
      limit: KNEE_LIMIT,
      big: '直',
      small: '彎',
    }),
  },
};

export function infoFor(kind: MotionKind, key: string): MetricInfo | undefined {
  return METRIC_INFO_BY_KIND[kind][key] ?? METRIC_INFO[key];
}

export interface MetricGroup {
  id: string;
  title: string;
  /** One line explaining what the group is about. */
  about: string;
  /** Shown by default. */
  primary: string[];
  /** Under "其他指標". */
  more: string[];
}

export const METRIC_GROUPS: Record<MotionKind, MetricGroup[]> = {
  batting: [
    {
      id: 'rhythm',
      title: '節奏',
      about: '每個階段花了多少時間。',
      primary: ['phase_load_ms', 'phase_plant_to_contact_ms'],
      more: ['phase_follow_ms', 'phase_stance_ms'],
    },
    {
      id: 'lower',
      title: '下半身',
      about: '跨步多大、前腳怎麼踩、重心怎麼移。',
      primary: ['stride_length', 'lead_knee_contact'],
      more: ['lead_knee_plant', 'pelvis_shift'],
    },
    {
      id: 'head',
      title: '頭部與上半身',
      about: '頭有沒有移動、身體傾斜多少。',
      primary: ['head_dx', 'trunk_tilt_contact'],
      more: ['head_dy'],
    },
    {
      id: 'hands',
      title: '手部',
      about: '手揮出去的快慢與時機。',
      primary: ['wrist_peak_speed'],
      more: ['wrist_peak_time_ms', 'seq_pelvis_lead_ms'],
    },
  ],
  pitching: [
    {
      id: 'rhythm',
      title: '節奏',
      about: '每個階段花了多少時間。',
      primary: ['phase_lift_to_release_ms', 'phase_plant_to_release_ms'],
      more: ['phase_lift_to_plant_ms', 'phase_release_to_finish_ms'],
    },
    {
      id: 'stride',
      title: '跨步與前腳',
      about: '跨步多大、前腳踩下後怎麼撐。',
      primary: ['stride_length', 'lead_knee_release'],
      more: ['lead_knee_plant'],
    },
    {
      id: 'trunk',
      title: '上半身與手臂',
      about: '出手時身體前傾多少、手臂抬多高。',
      primary: ['trunk_forward_release', 'elbow_height_plant'],
      more: [],
    },
  ],
};

export const EVENT_LABELS: Record<MotionKind, Record<string, string>> = {
  batting: { stance: '預備', load: '抬腳', plant: '前腳著地', contact: '擊球', finish: '收棒' },
  pitching: { liftTop: '抬腿最高點', plant: '前腳著地', release: '出手', finish: '收尾' },
};

export const KIND_LABEL: Record<MotionKind, string> = { batting: '打擊', pitching: '投球' };

export const METRIC_ORDER: Record<MotionKind, string[]> = {
  batting: METRIC_GROUPS.batting.flatMap((g) => [...g.primary, ...g.more]),
  pitching: METRIC_GROUPS.pitching.flatMap((g) => [...g.primary, ...g.more]),
};

/** Where this value sits within the athlete's own earlier values. */
export function rangeText(i: MetricInfo | undefined, r: RangeReport): string {
  const big = i?.big ?? '大';
  const small = i?.small ?? '小';
  switch (r.position) {
    case 'above':
      return `比你之前 ${r.n} 次都${big}`;
    case 'below':
      return `比你之前 ${r.n} 次都${small}`;
    case 'high':
      return `在你之前 ${r.n} 次的範圍內，偏${big}`;
    case 'low':
      return `在你之前 ${r.n} 次的範圍內，偏${small}`;
    default:
      return `在你之前 ${r.n} 次的範圍中間`;
  }
}

/** Difference from the athlete's own analyses marked as good. */
export function refText(i: MetricInfo | undefined, trend: Trend): string {
  if (trend === 'similar') return '跟好的動作相近';
  return `比好的動作${trend === 'higher' ? (i?.big ?? '大') : (i?.small ?? '小')}`;
}

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
  stride_implausible:
    '這次跨步量不出來（算出來是往後跨，可能是左右腳辨識錯誤，或手機沒有放在正側面），所以不顯示跨步長度。',
};

export function trendText(info: MetricInfo | undefined, trend: Trend): string {
  if (trend === 'similar') return '與你的平均相近';
  if (trend === 'higher') return `比你的平均${info?.big ?? '大'}`;
  return `比你的平均${info?.small ?? '小'}`;
}

export function stabilityText(s: Stability): string | null {
  if (s === 'more_stable') return '最近 5 次變穩定';
  if (s === 'less_stable') return '最近 5 次波動變大';
  return null;
}

export const DISCLAIMER =
  '單支手機、單一視角的 2D 估計值，只適合跟自己的歷史比較，不是實驗室等級的量測。數字大小不代表好壞，也不做任何傷害或醫療判斷。';
