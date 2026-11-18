import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeBackup, parseBackup, restoreBackup, type BackupFile } from './backup';
import { clearAllLocal, getBlob, getRaw, listRows, putBlob, saveRow } from './db';
import { ensureMe } from './identity';
import type { MotionAnalysis } from './types';

function analysis(playerId: string, over: Partial<MotionAnalysis> = {}) {
  return {
    player_id: playerId,
    team_id: null,
    kind: 'batting' as const,
    recorded_at: '2026-11-14T00:00:00Z',
    capture: {} as MotionAnalysis['capture'],
    fps: 240,
    model_version: 'm',
    engine_version: '1.3.0',
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
    keyframes: [{ event: 'contact', blob_key: 'kf:a:contact', path: null }],
    video_blob_key: 'video:a',
    note: null,
    created_by: playerId,
    ...over,
  };
}

/** Exports this "phone", then wipes it and becomes a new phone with its own profile. */
async function exportAndSwitchPhone(): Promise<BackupFile> {
  const file = JSON.parse(JSON.stringify(await makeBackup('0.1.0'))) as BackupFile;
  await clearAllLocal();
  return file;
}

describe('backup of the stand-alone analysis app', () => {
  beforeEach(async () => {
    await clearAllLocal();
  });

  it('exports analyses, the people they belong to and keyframe images, not videos', async () => {
    const me = await ensureMe();
    await saveRow('profiles', { ...me, display_name: '小明' });
    await putBlob(
      'kf:a:contact',
      new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' }),
    );
    await putBlob('video:a', new Blob(['big video']));
    await saveRow('motion_analyses', analysis(me.id));

    const b = await makeBackup('0.1.0', new Date('2026-11-18T00:00:00Z'));
    expect(b.me_profile_id).toBe(me.id);
    expect(b.profiles.map((p) => p.display_name)).toEqual(['小明']);
    expect(b.motion_analyses).toHaveLength(1);
    expect(Object.keys(b.images)).toEqual(['kf:a:contact']);
    expect(b.images['kf:a:contact']!.type).toBe('image/jpeg');
    expect(JSON.stringify(b)).not.toContain('big video');
    expect(parseBackup(JSON.parse(JSON.stringify(b)))).not.toBeNull();
  });

  it('restores my own backup on a new phone as my records', async () => {
    const old = await ensureMe();
    await putBlob('kf:a:contact', new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' }));
    const row = await saveRow('motion_analyses', analysis(old.id));
    const file = await exportAndSwitchPhone();

    const me = await ensureMe();
    expect(me.id).not.toBe(old.id);
    const r = await restoreBackup(file, { asMine: true });
    expect(r).toMatchObject({ analyses: 1, skipped: 0, images: 1 });
    const back = (await getRaw('motion_analyses', row.id))!;
    expect(back.player_id).toBe(me.id);
    expect(back.created_by).toBe(me.id);
    expect(back.video_blob_key).toBeNull();
    expect(new Uint8Array(await (await getBlob('kf:a:contact'))!.arrayBuffer())).toEqual(
      new Uint8Array([9, 8, 7]),
    );
    // The old phone's profile is not brought over.
    expect((await listRows('profiles')).map((p) => p.id)).toEqual([me.id]);
  });

  it("keeps someone else's backup as a separate person", async () => {
    const friend = await ensureMe();
    await saveRow('profiles', { ...friend, display_name: '阿華' });
    await saveRow('motion_analyses', analysis(friend.id));
    const file = await exportAndSwitchPhone();

    const me = await ensureMe();
    await restoreBackup(file, { asMine: false });
    const rows = await listRows('motion_analyses');
    expect(rows[0]!.player_id).toBe(friend.id);
    const names = (await listRows('profiles')).map((p) => p.display_name).sort();
    expect(names).toEqual(['我', '阿華'].sort());
    expect(me.id).not.toBe(friend.id);
  });

  it('keeps newer local rows and reports the same file imported twice as skipped', async () => {
    const me = await ensureMe();
    const row = await saveRow('motion_analyses', analysis(me.id));
    const file = JSON.parse(JSON.stringify(await makeBackup('0.1.0'))) as BackupFile;
    await saveRow('motion_analyses', { ...row, note: '後來寫的筆記' });

    const r = await restoreBackup(file, { asMine: true });
    expect(r).toMatchObject({ analyses: 0, skipped: 1 });
    const local = (await getRaw('motion_analyses', row.id))!;
    expect(local.note).toBe('後來寫的筆記');
    expect(local.video_blob_key).toBe('video:a');
  });

  it('rejects files that are not backups', () => {
    expect(parseBackup(null)).toBeNull();
    expect(parseBackup({ format: 'other', version: 1 })).toBeNull();
    expect(
      parseBackup({
        format: 'baseball-motion-analysis-backup',
        version: 1,
        profiles: [],
        motion_analyses: [{ id: 'x', updated_at: 'y', kind: 'swimming', keyframes: [] }],
        images: {},
      }),
    ).toBeNull();
  });
});
