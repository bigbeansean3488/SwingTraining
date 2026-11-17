// Offline queue and sync with Supabase. Conflict rules: docs/DECISIONS.md D14.
//
// push: every local write is queued in the outbox; rows are upserted by id in
//       dependency order. The server keeps the copy with the newer updated_at.
// pull: per table, rows with server_updated_at after the stored cursor; a local
//       copy with a newer updated_at is kept (it will be pushed).
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyRemoteRows,
  getBlob,
  getMeta,
  getRaw,
  pendingOutbox,
  putLocal,
  removeOutbox,
  setMeta,
  subscribe,
} from './db';
import {
  LOCAL_ONLY_COLUMNS,
  TABLES,
  type BaseRow,
  type MotionAnalysis,
  type TableName,
} from './types';
import { KEYFRAME_BUCKET } from './storage';

/** Tables whose rows carry created_by (filled with the signed-in user when missing). */
const HAS_CREATED_BY = new Set<TableName>([
  'profiles',
  'teams',
  'invites',
  'events',
  'training_sessions',
  'training_logs',
  'motion_analyses',
  'games',
  'game_events',
  'reference_motions',
]);

export interface RemoteError {
  message: string;
  code?: string;
}

export interface Remote {
  userId: string;
  upsert(table: TableName, rows: Record<string, unknown>[]): Promise<RemoteError | null>;
  pull(
    table: TableName,
    since: string,
    limit: number,
  ): Promise<{ rows: BaseRow[]; error: RemoteError | null }>;
  upload(path: string, blob: Blob): Promise<boolean>;
}

export interface SyncError {
  table: TableName;
  id: string;
  message: string;
  at: string;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  failed: SyncError[];
  /** True when stopped by a network/server problem (will retry). */
  interrupted: boolean;
  /** Tables the server does not have yet (migration not run); their changes stay queued. */
  missingTables: TableName[];
}

const EPOCH = '1970-01-01T00:00:00Z';
const PAGE = 500;
const CHUNK = 100;

/** The server has no such table (a newer migration has not been run there yet). */
export function isMissingTable(e: RemoteError): boolean {
  return e.code === 'PGRST205' || e.code === '42P01';
}

/** Errors that will never succeed on retry (permission, constraint, bad data). */
export function isPermanent(e: RemoteError): boolean {
  const c = e.code ?? '';
  return (
    c === '42501' || c.startsWith('23') || c.startsWith('22') || c === 'PGRST204' || c === '42703'
  );
}

export function prepareRow(
  table: TableName,
  row: BaseRow,
  userId: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const c of LOCAL_ONLY_COLUMNS[table] ?? []) delete out[c];
  delete out.server_updated_at;
  if (HAS_CREATED_BY.has(table) && !out.created_by) out.created_by = userId;
  return out;
}

export async function syncOnce(remote: Remote): Promise<SyncReport> {
  const report: SyncReport = {
    pushed: 0,
    pulled: 0,
    failed: [],
    interrupted: false,
    missingTables: [],
  };
  await push(remote, report);
  if (!report.interrupted) await pull(remote, report);
  if (report.failed.length) {
    const prev = (await getMeta<SyncError[]>('sync_errors')) ?? [];
    await setMeta('sync_errors', [...report.failed, ...prev].slice(0, 50));
  }
  return report;
}

async function push(remote: Remote, report: SyncReport) {
  const outbox = await pendingOutbox();
  if (!outbox.length) return;
  for (const table of TABLES) {
    const items = outbox.filter((o) => o.table === table);
    if (!items.length) continue;
    const ids = [...new Set(items.map((o) => o.id))];
    const seqsById = new Map<string, number[]>();
    for (const o of items) seqsById.set(o.id, [...(seqsById.get(o.id) ?? []), o.seq!]);
    const rows: BaseRow[] = [];
    for (const id of ids) {
      let r = await getRaw(table, id);
      if (!r) {
        await removeOutbox(seqsById.get(id)!);
        continue;
      }
      if (table === 'motion_analyses') r = await uploadKeyframes(remote, r as MotionAnalysis);
      rows.push(r);
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const err = await remote.upsert(
        table,
        chunk.map((r) => prepareRow(table, r, remote.userId)),
      );
      if (!err) {
        await removeOutbox(chunk.flatMap((r) => seqsById.get(r.id)!));
        report.pushed += chunk.length;
        continue;
      }
      if (isMissingTable(err)) {
        // Keep the changes queued until the migration has been run; go on with other tables.
        if (!report.missingTables.includes(table)) report.missingTables.push(table);
        break;
      }
      if (!isPermanent(err)) {
        report.interrupted = true;
        return;
      }
      // Isolate the bad rows; keep going with the rest.
      for (const r of chunk) {
        const e = await remote.upsert(table, [prepareRow(table, r, remote.userId)]);
        if (!e) {
          report.pushed++;
          await removeOutbox(seqsById.get(r.id)!);
        } else if (isPermanent(e)) {
          report.failed.push({ table, id: r.id, message: e.message, at: new Date().toISOString() });
          await removeOutbox(seqsById.get(r.id)!);
        } else {
          report.interrupted = true;
          return;
        }
      }
    }
  }
}

async function uploadKeyframes(remote: Remote, row: MotionAnalysis): Promise<MotionAnalysis> {
  let changed = false;
  const keyframes = [];
  for (const k of row.keyframes ?? []) {
    if (k.blob_key && !k.path) {
      const blob = await getBlob(k.blob_key);
      const path = `${row.player_id}/${row.id}/${k.event}.jpg`;
      if (blob && (await remote.upload(path, blob))) {
        keyframes.push({ ...k, path });
        changed = true;
        continue;
      }
    }
    keyframes.push(k);
  }
  if (!changed) return row;
  const next = { ...row, keyframes };
  await putLocal('motion_analyses', next);
  return next;
}

async function pull(remote: Remote, report: SyncReport) {
  for (const table of TABLES) {
    const key = `cursor:${table}`;
    let cursor = (await getMeta<string>(key)) ?? EPOCH;
    for (;;) {
      const { rows, error } = await remote.pull(table, cursor, PAGE);
      if (error && isMissingTable(error)) {
        if (!report.missingTables.includes(table)) report.missingTables.push(table);
        break;
      }
      if (error) {
        report.interrupted = true;
        return;
      }
      report.pulled += await applyRemoteRows(table, rows);
      if (rows.length) {
        cursor = (rows[rows.length - 1] as BaseRow & { server_updated_at: string })
          .server_updated_at;
        await setMeta(key, cursor);
      }
      if (rows.length < PAGE) break;
    }
  }
}

export async function resetCursors(): Promise<void> {
  for (const t of TABLES) await setMeta(`cursor:${t}`, EPOCH);
}

// ---------------------------------------------------------------------------
// Supabase adapter and background scheduler

export function supabaseRemote(sb: SupabaseClient, userId: string): Remote {
  return {
    userId,
    async upsert(table, rows) {
      const { error } = await sb.from(table).upsert(rows, { onConflict: 'id' });
      return error ? { message: error.message, code: error.code } : null;
    },
    async pull(table, since, limit) {
      const { data, error } = await sb
        .from(table)
        .select('*')
        .gt('server_updated_at', since)
        .order('server_updated_at', { ascending: true })
        .limit(limit);
      return {
        rows: (data ?? []) as BaseRow[],
        error: error ? { message: error.message, code: error.code } : null,
      };
    },
    async upload(path, blob) {
      const { error } = await sb.storage
        .from(KEYFRAME_BUCKET)
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      return !error;
    },
  };
}

export type SyncState = 'local' | 'signed-out' | 'offline' | 'idle' | 'syncing' | 'error';
export interface SyncStatus {
  state: SyncState;
  lastSyncAt: string | null;
  lastError: string | null;
}

let status: SyncStatus = { state: 'local', lastSyncAt: null, lastError: null };
const statusListeners = new Set<(s: SyncStatus) => void>();
export function getSyncStatus(): SyncStatus {
  return status;
}
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}
function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s };
  for (const fn of statusListeners) fn(status);
}

let running: Promise<void> | null = null;
let again = false;
let remoteFactory: (() => Promise<Remote | null>) | null = null;

/** Run a sync now (coalesces concurrent requests). */
export function requestSync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      if (!remoteFactory) {
        setStatus({ state: 'local' });
        return;
      }
      if (!navigator.onLine) {
        setStatus({ state: 'offline' });
        return;
      }
      const remote = await remoteFactory();
      if (!remote) {
        setStatus({ state: 'signed-out' });
        return;
      }
      setStatus({ state: 'syncing' });
      try {
        const r = await syncOnce(remote);
        setStatus({
          state: r.interrupted ? 'error' : 'idle',
          lastSyncAt: r.interrupted ? status.lastSyncAt : new Date().toISOString(),
          lastError: r.interrupted
            ? '連線中斷，稍後自動重試'
            : r.failed.length
              ? `${r.failed.length} 筆變更被伺服器拒絕`
              : r.missingTables.length
                ? `伺服器缺少資料表 ${r.missingTables.join('、')}，請在 Supabase 執行最新的 migration（這些資料先留在手機上）`
                : null,
        });
      } catch (err) {
        setStatus({ state: 'error', lastError: (err as Error).message });
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

let started = false;
/** Start background sync: on start, when back online, on local writes (debounced), every minute. */
export function startSync(factory: () => Promise<Remote | null>): void {
  remoteFactory = factory;
  if (started) {
    requestSync();
    return;
  }
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => requestSync(), 2000);
  };
  subscribe((t) => {
    if (t === 'outbox') soon();
  });
  window.addEventListener('online', () => requestSync());
  window.addEventListener('offline', () => setStatus({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') requestSync();
  }, 60_000);
  requestSync();
}
