// Local-first database on IndexedDB. Every write is recorded in an outbox that
// the sync engine (src/lib/sync.ts) pushes to Supabase when online.
import { openDB, type IDBPDatabase } from 'idb';
import { SOLO } from './edition';
import { TABLES, type BaseRow, type RowByTable, type TableName } from './types';

// Separate database for the stand-alone app (also keeps them apart on localhost).
const DB_NAME = SOLO ? 'motion-analysis' : 'team-platform';
// 2: reference_motions store.
const DB_VERSION = 2;

export interface OutboxItem {
  seq?: number;
  table: TableName;
  id: string;
  queued_at: string;
}

type Listener = (table: TableName | 'meta' | 'outbox') => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(table: TableName | 'meta' | 'outbox') {
  for (const fn of listeners) fn(table);
}
/** Tell subscribers a table changed (after writing to it directly through `db()`). */
export function notifyChanged(table: TableName): void {
  emit(table);
}

let dbPromise: Promise<IDBPDatabase> | null = null;
export function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      for (const t of TABLES)
        if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('outbox'))
        d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    },
  });
  return dbPromise;
}

/** For tests: drop the cached connection. */
export function resetDbForTests() {
  dbPromise = null;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function listRows<T extends TableName>(
  table: T,
  includeDeleted = false,
): Promise<RowByTable[T][]> {
  const all = (await (await db()).getAll(table)) as RowByTable[T][];
  return includeDeleted ? all : all.filter((r) => !r.deleted_at);
}

export async function getRow<T extends TableName>(
  table: T,
  id: string,
): Promise<RowByTable[T] | undefined> {
  const r = (await (await db()).get(table, id)) as RowByTable[T] | undefined;
  return r && !r.deleted_at ? r : undefined;
}

/**
 * Insert or update a row locally and queue it for sync. Missing base fields
 * are filled in. Returns the stored row.
 */
export async function saveRow<T extends TableName>(
  table: T,
  data: Partial<RowByTable[T]> & Omit<RowByTable[T], keyof BaseRow | 'id'> & { id?: string },
): Promise<RowByTable[T]> {
  const d = await db();
  const now = nowIso();
  const existing = data.id
    ? ((await d.get(table, data.id)) as RowByTable[T] | undefined)
    : undefined;
  const row = {
    ...(existing ?? {}),
    ...data,
    id: data.id ?? uuid(),
    created_at: existing?.created_at ?? data.created_at ?? now,
    updated_at: now,
    deleted_at: data.deleted_at ?? existing?.deleted_at ?? null,
  } as RowByTable[T];
  const tx = d.transaction([table, 'outbox'], 'readwrite');
  await tx.objectStore(table).put(row);
  // The stand-alone analysis app never syncs, so nothing is queued.
  if (!SOLO)
    await tx.objectStore('outbox').add({ table, id: row.id, queued_at: now } satisfies OutboxItem);
  await tx.done;
  emit(table);
  emit('outbox');
  return row;
}

/** Partial update of an existing row. */
export async function updateRow<T extends TableName>(
  table: T,
  id: string,
  patch: Partial<RowByTable[T]>,
): Promise<RowByTable[T]> {
  const existing = (await (await db()).get(table, id)) as RowByTable[T] | undefined;
  if (!existing) throw new Error(`${table}/${id} not found`);
  return saveRow(table, { ...existing, ...patch, id } as never);
}

/** Soft delete (tombstone) so the deletion syncs to other devices. */
export async function deleteRow(table: TableName, id: string): Promise<void> {
  const existing = await (await db()).get(table, id);
  if (!existing) return;
  await saveRow(table, { ...existing, deleted_at: nowIso() } as never);
}

/**
 * Apply rows pulled from the server. Last-write-wins on updated_at: a local
 * row with a newer change (normally still queued in the outbox) is kept and
 * will overwrite the server copy when pushed. Local-only columns survive.
 */
export async function applyRemoteRows(table: TableName, rows: BaseRow[]): Promise<number> {
  if (!rows.length) return 0;
  const d = await db();
  const tx = d.transaction(table, 'readwrite');
  let applied = 0;
  for (const r of rows) {
    const local = (await tx.store.get(r.id)) as BaseRow | undefined;
    if (local && local.updated_at > r.updated_at) continue;
    await tx.store.put({ ...(local ?? {}), ...r });
    applied++;
  }
  await tx.done;
  if (applied) emit(table);
  return applied;
}

/** Write a row locally without queueing it for sync (server-originated changes). */
export async function putLocal(table: TableName, row: BaseRow): Promise<void> {
  await (await db()).put(table, row);
  emit(table);
}

/** Remove a row and its queued changes entirely (rows that never reached the server). */
export async function purgeLocal(table: TableName, id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction([table, 'outbox'], 'readwrite');
  await tx.objectStore(table).delete(id);
  let cursor = await tx.objectStore('outbox').openCursor();
  while (cursor) {
    const v = cursor.value as OutboxItem;
    if (v.table === table && v.id === id) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  emit(table);
  emit('outbox');
}

/** Raw row including tombstones. */
export async function getRaw<T extends TableName>(
  table: T,
  id: string,
): Promise<RowByTable[T] | undefined> {
  return (await (await db()).get(table, id)) as RowByTable[T] | undefined;
}

/** Delete every local row, blob, queued change and setting (sign-out on a shared phone). */
export async function clearAllLocal(): Promise<void> {
  const d = await db();
  const stores = [...TABLES, 'outbox', 'blobs', 'meta'] as const;
  const tx = d.transaction([...stores], 'readwrite');
  for (const s of stores) await tx.objectStore(s).clear();
  await tx.done;
  for (const t of TABLES) emit(t);
  emit('meta');
  emit('outbox');
}

export async function pendingOutbox(): Promise<OutboxItem[]> {
  return (await (await db()).getAll('outbox')) as OutboxItem[];
}

export async function removeOutbox(seqs: number[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  for (const s of seqs) await tx.store.delete(s);
  await tx.done;
  emit('outbox');
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
  emit('meta');
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await (await db()).put('blobs', blob, key);
}
export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await (await db()).get('blobs', key)) as Blob | undefined;
}
export async function deleteBlob(key: string): Promise<void> {
  await (await db()).delete('blobs', key);
}

/** Rough size of everything stored locally (bytes), for the storage page. */
export async function estimateLocalUsage(): Promise<{
  usage: number | null;
  quota: number | null;
}> {
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? null, quota: e.quota ?? null };
  }
  return { usage: null, quota: null };
}
