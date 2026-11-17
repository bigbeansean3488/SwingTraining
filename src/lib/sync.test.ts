import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyRemoteRows, clearAllLocal, getRaw, pendingOutbox, putBlob, saveRow } from './db';
import { replaceId } from './remap';
import { prepareRow, syncOnce, type Remote, type RemoteError } from './sync';
import type { BaseRow, MotionAnalysis, TableName } from './types';

/** In-memory server that mimics upsert-by-id with last-write-wins. */
function fakeRemote(
  opts: {
    reject?: (table: TableName, row: Record<string, unknown>) => RemoteError | null;
    offline?: boolean;
    /** Tables the server does not have (migration not run). */
    missing?: TableName[];
  } = {},
) {
  const missing = (t: TableName): RemoteError | null =>
    opts.missing?.includes(t)
      ? { message: `Could not find the table 'public.${t}'`, code: 'PGRST205' }
      : null;
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const calls: string[] = [];
  const uploads: string[] = [];
  let clock = 0;
  const remote: Remote = {
    userId: 'user-1',
    async upsert(table, rows) {
      if (opts.offline) return { message: 'Failed to fetch' };
      if (missing(table)) return missing(table);
      for (const r of rows) {
        const e = opts.reject?.(table, r);
        if (e) return e;
      }
      calls.push(`${table}:${rows.length}`);
      const t = tables.get(table) ?? new Map();
      tables.set(table, t);
      for (const r of rows) {
        const old = t.get(r.id as string);
        if (old && (old.updated_at as string) > (r.updated_at as string)) continue;
        t.set(r.id as string, { ...r, server_updated_at: new Date(1e12 + ++clock).toISOString() });
      }
      return null;
    },
    async pull(table, since, limit) {
      if (missing(table)) return { rows: [], error: missing(table) };
      const rows = [...(tables.get(table)?.values() ?? [])]
        .filter((r) => (r.server_updated_at as string) > since)
        .sort((a, b) =>
          (a.server_updated_at as string).localeCompare(b.server_updated_at as string),
        )
        .slice(0, limit);
      return { rows: rows as unknown as BaseRow[], error: null };
    },
    async upload(path) {
      uploads.push(path);
      return true;
    },
  };
  return { remote, tables, calls, uploads };
}

const profile = (name: string) => ({
  user_id: null,
  display_name: name,
  height_cm: null,
  bats: null,
  throws: null,
  birth_year: null,
  notes: null,
  created_by: null,
});

beforeEach(async () => {
  await clearAllLocal();
});

describe('sync', () => {
  it('pushes queued rows in dependency order and empties the outbox', async () => {
    const { remote, calls, tables } = fakeRemote();
    const team = await saveRow('teams', { name: '成大', created_by: null });
    const p = await saveRow('profiles', profile('小明'));
    await saveRow('team_members', {
      team_id: team.id,
      profile_id: p.id,
      role: 'player',
      jersey_number: '7',
      positions: null,
      active: true,
    });
    const r = await syncOnce(remote);
    expect(r.pushed).toBe(3);
    expect(calls).toEqual(['profiles:1', 'teams:1', 'team_members:1']);
    expect(await pendingOutbox()).toEqual([]);
    // created_by is filled with the signed-in user when missing.
    expect(tables.get('teams')!.get(team.id)!.created_by).toBe('user-1');
  });

  it('keeps the queue when offline and retries later', async () => {
    await saveRow('profiles', profile('a'));
    const off = fakeRemote({ offline: true });
    const r = await syncOnce(off.remote);
    expect(r.interrupted).toBe(true);
    expect((await pendingOutbox()).length).toBe(1);
    const on = fakeRemote();
    await syncOnce(on.remote);
    expect(await pendingOutbox()).toEqual([]);
  });

  it('drops only the rows the server rejects permanently and reports them', async () => {
    const bad = await saveRow('profiles', profile('bad'));
    await saveRow('profiles', profile('good'));
    const { remote, tables } = fakeRemote({
      reject: (_t, row) =>
        row.display_name === 'bad'
          ? { message: 'new row violates row-level security policy', code: '42501' }
          : null,
    });
    const r = await syncOnce(remote);
    expect(r.failed.map((f) => f.id)).toEqual([bad.id]);
    expect(tables.get('profiles')!.size).toBe(1);
    expect(await pendingOutbox()).toEqual([]);
  });

  it('a table missing on the server keeps its changes queued without blocking others', async () => {
    const team = await saveRow('teams', { name: '成大', created_by: null });
    const ref = await saveRow('reference_motions', {
      team_id: team.id,
      player_id: null,
      source_analysis_id: null,
      kind: 'pitching',
      label: '示範',
      style: { arm_slot: 'three_quarter' },
      source_note: null,
      recorded_at: null,
      fps: 240,
      time_scale: 1,
      forward: 1,
      model_version: 'm',
      engine_version: '1.1.0',
      events: {},
      metrics: {},
      quality: { warnings: [] },
      keypoints: 'gz:',
      created_by: null,
    });
    const old = fakeRemote({ missing: ['reference_motions'] });
    const r = await syncOnce(old.remote);
    expect(r.interrupted).toBe(false);
    expect(r.failed).toEqual([]);
    expect(r.missingTables).toEqual(['reference_motions']);
    expect(old.tables.get('teams')!.size).toBe(1);
    expect((await pendingOutbox()).map((o) => o.table)).toEqual(['reference_motions']);
    // After the migration has been run, the queued reference goes up.
    const upgraded = fakeRemote();
    const r2 = await syncOnce(upgraded.remote);
    expect(r2.missingTables).toEqual([]);
    expect(upgraded.tables.get('reference_motions')!.get(ref.id)!.created_by).toBe('user-1');
    expect(await pendingOutbox()).toEqual([]);
  });

  it('pull applies newer server rows but keeps newer local edits (last write wins)', async () => {
    const p = await saveRow('profiles', profile('local'));
    await applyRemoteRows('profiles', [
      { ...p, display_name: 'older-server', updated_at: '2000-01-01T00:00:00Z' } as BaseRow,
    ]);
    expect((await getRaw('profiles', p.id))!.display_name).toBe('local');
    await applyRemoteRows('profiles', [
      { ...p, display_name: 'newer-server', updated_at: '2999-01-01T00:00:00Z' } as BaseRow,
    ]);
    expect((await getRaw('profiles', p.id))!.display_name).toBe('newer-server');
  });

  it('a second device receives the rows and tombstones', async () => {
    const { remote, tables } = fakeRemote();
    const p = await saveRow('profiles', profile('x'));
    await syncOnce(remote);
    // Simulate the other device deleting it later.
    tables.get('profiles')!.set(p.id, {
      ...tables.get('profiles')!.get(p.id)!,
      deleted_at: '2999-01-01T00:00:00Z',
      updated_at: '2999-01-01T00:00:00Z',
      server_updated_at: '2999-01-01T00:00:00Z',
    });
    await syncOnce(remote);
    expect((await getRaw('profiles', p.id))!.deleted_at).toBe('2999-01-01T00:00:00Z');
  });

  it('uploads keyframes before pushing an analysis and never sends local-only columns', async () => {
    const { remote, uploads, tables } = fakeRemote();
    await putBlob('kf:1:plant', new Blob(['jpg']));
    const row = await saveRow('motion_analyses', {
      player_id: 'p1',
      team_id: null,
      kind: 'batting',
      recorded_at: '2026-11-14T00:00:00Z',
      capture: {} as MotionAnalysis['capture'],
      fps: 240,
      model_version: 'm',
      engine_version: '1.0.0',
      events: {},
      metrics: {},
      quality: {
        ok: true,
        issues: [],
        warnings: [],
        validFraction: 1,
        meanConfidence: 1,
        fps: 240,
      },
      failure: null,
      forward: 1,
      manual_events: null,
      keypoints: 'gz:',
      keyframes: [{ event: 'plant', blob_key: 'kf:1:plant', path: null }],
      video_blob_key: 'video:1',
      note: null,
      created_by: null,
    });
    await syncOnce(remote);
    expect(uploads).toEqual([`p1/${row.id}/plant.jpg`]);
    const server = tables.get('motion_analyses')!.get(row.id)!;
    expect(server.video_blob_key).toBeUndefined();
    expect((server.keyframes as { path: string }[])[0]!.path).toBe(`p1/${row.id}/plant.jpg`);
    expect((await getRaw('motion_analyses', row.id))!.video_blob_key).toBe('video:1');
  });

  it('prepareRow strips server-managed and local-only fields', () => {
    const out = prepareRow(
      'motion_analyses',
      {
        id: 'a',
        created_at: '',
        updated_at: '',
        deleted_at: null,
        server_updated_at: 'x',
        video_blob_key: 'v',
      } as unknown as BaseRow,
      'u',
    );
    expect(out).not.toHaveProperty('server_updated_at');
    expect(out).not.toHaveProperty('video_blob_key');
    expect(out.created_by).toBe('u');
  });

  it('replaceId rewrites nested references', () => {
    expect(replaceId({ a: 'x', b: [{ c: 'x' }, 'y'] }, 'x', 'z')).toEqual({
      a: 'z',
      b: [{ c: 'z' }, 'y'],
    });
  });
});
