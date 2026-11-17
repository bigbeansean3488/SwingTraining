// User-facing wording for reference motions (標竿動作). No good/bad judgement:
// differences only say in which direction "you" differ from the reference.
import type { ComparabilityIssue, MetricDelta } from '../../analysis/reference';
import type { Access } from '../../lib/access';
import type { ReferenceEntry } from '../../lib/references';
import type { ArmAction, ArmSlot, ReferenceStyle } from '../../lib/types';
import { formatMetric, type MetricInfo } from './metricInfo';

export const ARM_SLOT_LABEL: Record<ArmSlot, string> = {
  overhand: '高壓（上肩）',
  three_quarter: '3/4',
  sidearm: '側投',
  submarine: '低肩（下勾）',
};

export const ARM_ACTION_LABEL: Record<ArmAction, string> = {
  long: '長引臂',
  short: '短引臂',
};

export function styleLabels(style: ReferenceStyle | undefined): string[] {
  if (!style) return [];
  const out: string[] = [];
  if (style.arm_slot) out.push(ARM_SLOT_LABEL[style.arm_slot]);
  if (style.arm_action) out.push(ARM_ACTION_LABEL[style.arm_action]);
  if (style.tag) out.push(style.tag);
  return out;
}

/** "比標竿短 0.20 軀幹長" / "跟標竿相近". */
export function deltaText(info: MetricInfo | undefined, d: MetricDelta): string {
  if (d.direction === 'similar') return '跟標竿相近';
  const adj = d.direction === 'higher' ? (info?.big ?? '大') : (info?.small ?? '小');
  return `比標竿${adj} ${formatMetric({ value: Math.abs(d.delta), unit: d.unit })}`;
}

export const COMPARABILITY_TEXT: Record<ComparabilityIssue, string> = {
  engine_major_differs:
    '這次分析和標竿是用量法不同的分析引擎版本算的（例如 1.2.0 起打擊的擊球時間改了），數值不能直接比。標竿是當時的複本；要更新，請在原本那次分析按「用目前引擎重新計算」後重新設為標竿。',
  user_warnings: '這次分析有品質提醒（例如影格率偏低或動作沒拍完整），差異只能參考。',
  ref_warnings: '標竿影片有品質提醒（例如影格率偏低或動作沒拍完整），差異只能參考。',
  direction_unknown: '有一邊看不出動作方向，骨架可能左右相反。',
  no_shared_events: '兩邊沒有共同的動作事件，時間只能從開頭對齊。',
};

/**
 * Mirrors the server rule: the creator or team staff may change a team reference.
 * Rows created on this device before sync have no created_by yet.
 */
export function canEditReference(
  access: Access,
  userId: string | null,
  e: Pick<ReferenceEntry, 'origin' | 'created_by'>,
): boolean {
  if (e.origin !== 'team') return false;
  return access.local || access.isStaff || !e.created_by || e.created_by === userId;
}

export const REFERENCE_DISCLAIMER =
  '標竿是隊上選來模仿的範例，不是標準答案；「不一樣」不代表「比較差」。兩邊都是單支手機的 2D 估計值，拍攝角度與距離不同也會造成差異。要怎麼調整，請跟教練討論。';
