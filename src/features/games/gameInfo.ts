import type { BaseTo, GameEventPayload, PAResult, PitchCall } from '../../scoring/types';

export const RESULT_LABEL: Record<PAResult, string> = {
  '1B': '一壘安打',
  '2B': '二壘安打',
  '3B': '三壘安打',
  HR: '全壘打',
  BB: '四壞保送',
  IBB: '故意四壞',
  HBP: '觸身球',
  CI: '妨礙打擊',
  K: '三振（揮空）',
  KL: '三振（站著）',
  K_REACH: '不死三振上壘',
  GO: '滾地出局',
  FO: '飛球出局',
  LO: '平飛出局',
  PO: '內野高飛出局',
  SF: '高飛犧牲打',
  SH: '犧牲觸擊',
  FC: '野手選擇',
  E: '失誤上壘',
  DP: '雙殺打',
  TP: '三殺打',
};

export const RESULT_GROUPS: { label: string; results: PAResult[] }[] = [
  { label: '安打', results: ['1B', '2B', '3B', 'HR'] },
  { label: '上壘', results: ['BB', 'IBB', 'HBP', 'E', 'FC', 'CI', 'K_REACH'] },
  { label: '出局', results: ['K', 'KL', 'GO', 'FO', 'LO', 'PO', 'SF', 'SH', 'DP', 'TP'] },
];

export const SHORT_RESULT: Record<PAResult, string> = {
  '1B': '1B',
  '2B': '2B',
  '3B': '3B',
  HR: 'HR',
  BB: '保送',
  IBB: '故四',
  HBP: '觸身',
  CI: '妨礙',
  K: '三振',
  KL: '站振',
  K_REACH: '不死三振',
  GO: '滾地',
  FO: '飛球',
  LO: '平飛',
  PO: '內飛',
  SF: '犧飛',
  SH: '犧觸',
  FC: '野選',
  E: '失誤',
  DP: '雙殺',
  TP: '三殺',
};

export const PITCH_LABEL: Record<PitchCall, string> = {
  B: '壞球',
  CS: '好球（看）',
  SS: '揮空',
  F: '界外',
  FT: '擦棒',
  BIP: '打進場內',
  HBP: '觸身',
  IB: '故意壞球',
};

export const RUNNER_KIND_LABEL: Record<
  Extract<GameEventPayload, { type: 'runner' }>['kind'],
  string
> = {
  SB: '盜壘成功',
  CS: '盜壘失敗',
  PK: '牽制出局',
  WP: '暴投',
  PB: '捕逸',
  BK: '投手犯規',
  DI: '無人防守進壘',
  E: '失誤進壘',
  OA: '其他進壘',
  OUT: '其他出局',
};

export const SUB_KIND_LABEL = { PH: '代打', PR: '代跑', DEF: '守備調整', P: '換投' } as const;

export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

export function baseLabel(b: BaseTo | 1 | 2 | 3 | 'B'): string {
  switch (b) {
    case 'B':
      return '打者';
    case 'H':
      return '得分';
    case 'out':
      return '出局';
    default:
      return `${b} 壘`;
  }
}

export const HIT_TYPE_LABEL = { G: '滾地', L: '平飛', F: '高飛', P: '內野高飛' } as const;
