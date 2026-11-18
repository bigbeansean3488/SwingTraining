// Row types shared by the local database and Supabase (see supabase/migrations).
import type { EventTimes, Metrics, MotionKind } from '../analysis/types';

export const TABLES = [
  'profiles',
  'teams',
  'team_members',
  'seasons',
  'invites',
  'events',
  'attendance',
  'training_sessions',
  'training_logs',
  'motion_analyses',
  'games',
  'lineups',
  'game_events',
  // Last: a server that has not run its migration yet only affects this table.
  'reference_motions',
] as const;
export type TableName = (typeof TABLES)[number];

export interface BaseRow {
  id: string;
  created_at: string;
  /** Client time of the last change; last-write-wins key for sync. */
  updated_at: string;
  deleted_at: string | null;
}

export type Handedness = 'R' | 'L' | 'S';
export type Role = 'admin' | 'coach' | 'player';

export interface Profile extends BaseRow {
  /** Supabase auth user id; null for roster entries without an account. */
  user_id: string | null;
  display_name: string;
  height_cm: number | null;
  bats: Handedness | null;
  throws: Handedness | null;
  birth_year: number | null;
  notes: string | null;
  created_by: string | null;
}

export interface Team extends BaseRow {
  name: string;
  created_by: string | null;
}

export interface TeamMember extends BaseRow {
  team_id: string;
  profile_id: string;
  role: Role;
  jersey_number: string | null;
  positions: string | null;
  active: boolean;
}

export interface Season extends BaseRow {
  team_id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
}

export interface Invite extends BaseRow {
  team_id: string;
  token: string;
  role: Role;
  /** Claim an existing roster profile, or null to create a new member. */
  profile_id: string | null;
  expires_at: string;
  used_at: string | null;
  created_by: string | null;
}

export type CalendarKind = 'training' | 'game' | 'other';

export interface CalendarEvent extends BaseRow {
  team_id: string;
  season_id: string | null;
  kind: CalendarKind;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  created_by: string | null;
}

export type AttendanceStatus = 'yes' | 'no' | 'maybe';
export interface Attendance extends BaseRow {
  event_id: string;
  team_id: string;
  player_id: string;
  status: AttendanceStatus;
  note: string | null;
}

export interface TrainingPlanItem {
  kind: TrainingLogKind;
  label: string;
  target: string | null;
}
export interface TrainingSession extends BaseRow {
  team_id: string | null;
  date: string;
  title: string;
  plan: TrainingPlanItem[];
  notes: string | null;
  created_by: string | null;
}

export type TrainingLogKind = 'batting' | 'bullpen' | 'fitness' | 'custom';
export interface TrainingLogData {
  /** batting */
  swings?: number;
  /** bullpen: pitch type -> count */
  pitches?: Record<string, number>;
  /** fitness / custom */
  item?: string;
  value?: number;
  unit?: string;
}
export interface TrainingLog extends BaseRow {
  player_id: string;
  team_id: string | null;
  session_id: string | null;
  date: string;
  kind: TrainingLogKind;
  data: TrainingLogData;
  note: string | null;
  created_by: string | null;
}

export interface CaptureInfo {
  fileName: string | null;
  fileSize: number | null;
  /** Filming time from the video header (moov/mvhd), ISO; null if absent. */
  filmedAt?: string | null;
  /**
   * File modification time reported by the phone (ISO). Not reliably the
   * filming time. Since 2026-11-18 recorded_at = filmedAt, else analysis time.
   */
  fileLastModified?: string | null;
  sourceFps: number | null;
  analyzedFps: number;
  width: number;
  height: number;
  durationS: number;
  method: 'webcodecs' | 'seek';
  delegate: string;
  frameStride: number;
  timeScale: number;
  range: [number, number];
  processingMs: number;
  inferMs: number;
  frames: number;
  view: 'side';
  codec: string | null;
  rotation: number;
  fallbackReason: string | null;
  userAgent: string;
}

export interface KeyframeRef {
  event: string;
  /** Local blob key (IndexedDB). */
  blob_key: string | null;
  /** Supabase Storage path once uploaded. */
  path: string | null;
}

export interface MotionAnalysis extends BaseRow {
  player_id: string;
  team_id: string | null;
  kind: MotionKind;
  recorded_at: string;
  capture: CaptureInfo;
  fps: number;
  model_version: string;
  engine_version: string;
  events: EventTimes;
  metrics: Metrics;
  quality: {
    ok: boolean;
    issues: string[];
    warnings: string[];
    validFraction: number;
    meanConfidence: number;
    fps: number;
  };
  failure: string | null;
  forward: number;
  manual_events: EventTimes | null;
  /** base64(gzip(encodeKeypoints(seq))) with seq times in media seconds. */
  keypoints: string;
  keyframes: KeyframeRef[];
  /** Local only: kept original video. */
  video_blob_key: string | null;
  note: string | null;
  /** Marked by the athlete or coach as a good motion to compare against. Missing on old rows. */
  marked_good?: boolean;
  created_by: string | null;
}

export type GameMode = 'simple' | 'pitch';
export interface Game extends BaseRow {
  team_id: string;
  season_id: string | null;
  event_id: string | null;
  opponent: string;
  game_date: string;
  /** Whether our team bats first ('away') or second ('home'). */
  home_away: 'home' | 'away';
  innings: number;
  mode: GameMode;
  status: 'scheduled' | 'live' | 'final';
  notes: string | null;
  created_by: string | null;
}

export interface LineupSlot {
  order: number;
  /** Our player (profiles.id) or null for opponents. */
  player_id: string | null;
  name: string;
  position: string;
}
export interface Lineup extends BaseRow {
  game_id: string;
  team_id: string;
  side: 'us' | 'opp';
  slots: LineupSlot[];
  /** Starting pitcher of this side. */
  pitcher_id: string | null;
  pitcher_name: string | null;
}

export interface GameEventRow extends BaseRow {
  game_id: string;
  team_id: string;
  /** Ordering key; fractional values allow inserting between events. */
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  created_by: string | null;
}

export type ArmSlot = 'overhand' | 'three_quarter' | 'sidearm' | 'submarine';
export type ArmAction = 'long' | 'short';
export interface ReferenceStyle {
  /** Pitching only. */
  arm_slot?: ArmSlot | null;
  /** Pitching only. */
  arm_action?: ArmAction | null;
  /** Free tag, e.g. a batting style. */
  tag?: string | null;
}

/** Fields shared by team reference motions and built-in references (src/data/references). */
export interface ReferenceMotionData {
  kind: MotionKind;
  label: string;
  style: ReferenceStyle;
  /** Where the motion comes from and under what license / permission. */
  source_note: string | null;
  recorded_at: string | null;
  fps: number;
  /** Real seconds per media second (slow-motion correction), as in CaptureInfo. */
  time_scale: number;
  forward: number;
  model_version: string;
  engine_version: string;
  /** Media-time events, as in MotionAnalysis. */
  events: EventTimes;
  metrics: Metrics;
  quality: { warnings: string[]; meanConfidence?: number; fps?: number };
  /** Same encoding as MotionAnalysis.keypoints. */
  keypoints: string;
}

/** A team's imitation target copied from one motion analysis (docs/DECISIONS.md D22). */
export interface ReferenceMotion extends BaseRow, ReferenceMotionData {
  team_id: string | null;
  /** Who performed it (profiles.id), if known. */
  player_id: string | null;
  source_analysis_id: string | null;
  created_by: string | null;
}

export interface RowByTable {
  profiles: Profile;
  teams: Team;
  team_members: TeamMember;
  seasons: Season;
  invites: Invite;
  events: CalendarEvent;
  attendance: Attendance;
  training_sessions: TrainingSession;
  training_logs: TrainingLog;
  motion_analyses: MotionAnalysis;
  games: Game;
  lineups: Lineup;
  game_events: GameEventRow;
  reference_motions: ReferenceMotion;
}

/** Columns that exist only on this device and are never synced. */
export const LOCAL_ONLY_COLUMNS: Partial<Record<TableName, string[]>> = {
  motion_analyses: ['video_blob_key'],
};
