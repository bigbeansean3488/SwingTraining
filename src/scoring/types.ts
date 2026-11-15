// Game event model. Every pitch / plate appearance / runner play is one event;
// all statistics are derived by replaying events (docs/SCORING_SCOPE.md).

export type Side = 'us' | 'opp';
export type Half = 'top' | 'bottom';

export interface PlayerRef {
  /** profiles.id for our players; null for opponents. */
  id: string | null;
  name: string;
}

export interface Slot {
  player: PlayerRef;
  /** P, C, 1B, 2B, 3B, SS, LF, CF, RF, DH, PH, PR */
  position: string;
}

export interface GameSetup {
  homeAway: 'home' | 'away';
  innings: number;
  lineups: Record<Side, Slot[]>;
  pitchers: Record<Side, PlayerRef>;
}

/** Base index 1..3, 'B' = batter, 'H' = home (scored), 'out'. */
export type BaseFrom = 1 | 2 | 3 | 'B';
export type BaseTo = 1 | 2 | 3 | 'H' | 'out';

export interface Move {
  from: BaseFrom;
  to: BaseTo;
  /** Override the default earned/unearned decision for a run. */
  earned?: boolean;
}

export type PAResult =
  | '1B'
  | '2B'
  | '3B'
  | 'HR'
  | 'BB'
  | 'IBB'
  | 'HBP'
  | 'CI'
  | 'K'
  | 'KL'
  | 'K_REACH'
  | 'GO'
  | 'FO'
  | 'LO'
  | 'PO'
  | 'SF'
  | 'SH'
  | 'FC'
  | 'E'
  | 'DP'
  | 'TP';

export type PitchCall = 'B' | 'CS' | 'SS' | 'F' | 'FT' | 'BIP' | 'HBP' | 'IB';

export interface HitLocation {
  /** 0..1 across the field diagram (0 = left foul line side), y 0..1 from home plate outward. */
  x: number;
  y: number;
}

export type GameEventPayload =
  | {
      type: 'pa';
      result: PAResult;
      /** Batter (defaults to the current lineup slot). */
      batter?: PlayerRef;
      /** Every runner movement including the batter ('B'). Required for runners on base. */
      moves: Move[];
      rbi?: number;
      fielders?: string;
      hitType?: 'G' | 'L' | 'F' | 'P';
      location?: HitLocation;
      /** Simple mode: number of pitches in the plate appearance (optional). */
      pitchCount?: number;
    }
  | { type: 'pitch'; call: PitchCall; pitchType?: string; zone?: number }
  | {
      type: 'runner';
      kind: 'SB' | 'CS' | 'PK' | 'WP' | 'PB' | 'BK' | 'DI' | 'E' | 'OA' | 'OUT';
      moves: Move[];
      fielders?: string;
    }
  | {
      type: 'sub';
      side: Side;
      kind: 'PH' | 'PR' | 'DEF' | 'P';
      /** Lineup slot index for PH / PR / DEF. */
      slot?: number;
      player: PlayerRef;
      position?: string;
    };

export interface ScoredEvent {
  id: string;
  seq: number;
  payload: GameEventPayload;
}
