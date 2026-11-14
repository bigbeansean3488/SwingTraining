import type { TrainingLog, TrainingLogKind } from '../../lib/types';

export const LOG_KIND_LABEL: Record<TrainingLogKind, string> = {
  batting: '打擊',
  bullpen: '牛棚',
  fitness: '體能測驗',
  custom: '自訂項目',
};

export const PITCH_TYPES: { key: string; label: string }[] = [
  { key: 'FB', label: '直球' },
  { key: 'SL', label: '滑球' },
  { key: 'CB', label: '曲球' },
  { key: 'CH', label: '變速球' },
  { key: 'SF', label: '指叉球' },
  { key: 'CT', label: '卡特球' },
  { key: 'SI', label: '伸卡球' },
  { key: 'OT', label: '其他' },
];

export const FITNESS_PRESETS: { item: string; unit: string }[] = [
  { item: '30 公尺衝刺', unit: '秒' },
  { item: '60 公尺衝刺', unit: '秒' },
  { item: '本壘到一壘', unit: '秒' },
  { item: '立定跳遠', unit: '公分' },
  { item: '垂直跳', unit: '公分' },
  { item: '引體向上', unit: '下' },
  { item: '伏地挺身', unit: '下' },
  { item: '深蹲 1RM', unit: '公斤' },
  { item: '臥推 1RM', unit: '公斤' },
  { item: '握力', unit: '公斤' },
];

export function pitchTotal(log: Pick<TrainingLog, 'data'>): number {
  return Object.values(log.data.pitches ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

export function logSummary(log: TrainingLog): string {
  switch (log.kind) {
    case 'batting':
      return `${log.data.swings ?? 0} 次揮棒`;
    case 'bullpen': {
      const parts = Object.entries(log.data.pitches ?? {})
        .filter(([, n]) => n)
        .map(([k, n]) => `${PITCH_TYPES.find((p) => p.key === k)?.label ?? k} ${n}`);
      return `${pitchTotal(log)} 球${parts.length ? `（${parts.join('、')}）` : ''}`;
    }
    default:
      return `${log.data.item ?? ''} ${log.data.value ?? ''} ${log.data.unit ?? ''}`.trim();
  }
}
