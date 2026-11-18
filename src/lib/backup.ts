// Backup file for the stand-alone analysis app (no account, no cloud): the
// analyses, the people they belong to and the keyframe images, as one JSON
// file the user keeps or passes on. Original videos are not included.
import { fromBase64, toBase64 } from '../analysis/codec';
import { db, getBlob, getMeta, listRows, notifyChanged, putBlob } from './db';
import { ensureMe, ME_KEY } from './identity';
import type { MotionAnalysis, Profile } from './types';

export const BACKUP_FORMAT = 'baseball-motion-analysis-backup';
export const BACKUP_VERSION = 1;

export interface BackupImage {
  type: string;
  base64: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exported_at: string;
  app_version: string;
  /** The exporting device's own profile ("me"). */
  me_profile_id: string | null;
  profiles: Profile[];
  motion_analyses: MotionAnalysis[];
  /** Keyframe images by local blob key. */
  images: Record<string, BackupImage>;
}

export interface RestoreReport {
  analyses: number;
  /** Rows skipped because this device already has a newer copy. */
  skipped: number;
  profiles: number;
  images: number;
}

export async function makeBackup(appVersion: string, now = new Date()): Promise<BackupFile> {
  const analyses = await listRows('motion_analyses');
  const meId = (await getMeta<string>(ME_KEY)) ?? null;
  const used = new Set(analyses.map((a) => a.player_id));
  if (meId) used.add(meId);
  const profiles = (await listRows('profiles')).filter((p) => used.has(p.id));
  const images: Record<string, BackupImage> = {};
  for (const a of analyses) {
    for (const k of a.keyframes) {
      if (!k.blob_key || images[k.blob_key]) continue;
      const b = await getBlob(k.blob_key);
      if (b)
        images[k.blob_key] = {
          type: b.type,
          base64: toBase64(new Uint8Array(await b.arrayBuffer())),
        };
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: now.toISOString(),
    app_version: appVersion,
    me_profile_id: meId,
    profiles,
    motion_analyses: analyses,
    images,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Checks the shape of a parsed backup file; null when it is not one. */
export function parseBackup(raw: unknown): BackupFile | null {
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT || raw.version !== BACKUP_VERSION) return null;
  if (!Array.isArray(raw.profiles) || !Array.isArray(raw.motion_analyses) || !isObj(raw.images))
    return null;
  const rowOk = (r: unknown) =>
    isObj(r) && typeof r.id === 'string' && typeof r.updated_at === 'string';
  if (!raw.profiles.every(rowOk)) return null;
  if (
    !raw.motion_analyses.every(
      (a) =>
        rowOk(a) &&
        isObj(a) &&
        typeof a.player_id === 'string' &&
        (a.kind === 'batting' || a.kind === 'pitching') &&
        Array.isArray(a.keyframes),
    )
  )
    return null;
  return raw as unknown as BackupFile;
}

/**
 * Restores a backup on this device. Rows this device already has in a newer
 * version are kept. With `asMine`, the file's own profile is merged into this
 * device's profile (moving to a new phone); otherwise every person in the
 * file is kept separate (someone else's analyses).
 */
export async function restoreBackup(
  file: BackupFile,
  opts: { asMine: boolean },
): Promise<RestoreReport> {
  const me = await ensureMe();
  const from = opts.asMine ? file.me_profile_id : null;
  const mapId = (id: string | null) => (from && id === from ? me.id : id);
  const report: RestoreReport = { analyses: 0, skipped: 0, profiles: 0, images: 0 };

  for (const [key, img] of Object.entries(file.images)) {
    if (await getBlob(key)) continue;
    await putBlob(
      key,
      new Blob([fromBase64(img.base64) as Uint8Array<ArrayBuffer>], { type: img.type }),
    );
    report.images++;
  }

  const d = await db();
  const tx = d.transaction(['profiles', 'motion_analyses'], 'readwrite');
  for (const p of file.profiles) {
    if (from && p.id === from) continue;
    const local = (await tx.objectStore('profiles').get(p.id)) as Profile | undefined;
    if (local && local.updated_at >= p.updated_at) continue;
    await tx.objectStore('profiles').put({ ...p, user_id: local?.user_id ?? null });
    report.profiles++;
  }
  for (const a of file.motion_analyses) {
    const store = tx.objectStore('motion_analyses');
    const local = (await store.get(a.id)) as MotionAnalysis | undefined;
    if (local && local.updated_at >= a.updated_at) {
      report.skipped++;
      continue;
    }
    await store.put({
      ...a,
      player_id: mapId(a.player_id)!,
      created_by: mapId(a.created_by),
      // Videos are not in backups; keep one this device already has.
      video_blob_key: local?.video_blob_key ?? null,
    } satisfies MotionAnalysis);
    report.analyses++;
  }
  await tx.done;
  notifyChanged('profiles');
  notifyChanged('motion_analyses');
  return report;
}
