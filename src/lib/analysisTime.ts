// Times shown for a motion analysis: when it was filmed and when it was analyzed.
import type { MotionAnalysis } from './types';

export type FilmedSource = 'video' | 'file';

/**
 * Filming time and its source, and the analysis time.
 * - 'video': read from the video header (reliable).
 * - 'file': the phone's file modification time (may be the export or copy time).
 * Rows from before 2026-11-18 have no capture.fileLastModified key and stored
 * the file time in recorded_at.
 */
export function analysisTimes(
  row: Pick<MotionAnalysis, 'created_at' | 'recorded_at' | 'capture'>,
): {
  analyzed: string;
  filmed: string | null;
  filmedSource: FilmedSource | null;
} {
  const c = row.capture ?? ({} as MotionAnalysis['capture']);
  const analyzed = row.created_at;
  if (c.filmedAt) return { analyzed, filmed: c.filmedAt, filmedSource: 'video' };
  if ('fileLastModified' in c) {
    return c.fileLastModified
      ? { analyzed, filmed: c.fileLastModified, filmedSource: 'file' }
      : { analyzed, filmed: null, filmedSource: null };
  }
  return { analyzed, filmed: row.recorded_at, filmedSource: 'file' };
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW');
}
