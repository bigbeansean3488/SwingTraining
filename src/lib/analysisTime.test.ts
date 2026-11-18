import { describe, expect, it } from 'vitest';
import { analysisTimes } from './analysisTime';
import type { CaptureInfo } from './types';

const row = (capture: Partial<CaptureInfo>, recorded_at = '2026-11-18T03:00:00.000Z') => ({
  created_at: '2026-11-18T03:05:00.000Z',
  recorded_at,
  capture: capture as CaptureInfo,
});

describe('analysis times', () => {
  it('prefers the filming time from the video header', () => {
    const t = analysisTimes(
      row({ filmedAt: '2026-11-16T08:30:00.000Z', fileLastModified: '2026-11-18T02:00:00.000Z' }),
    );
    expect(t).toEqual({
      analyzed: '2026-11-18T03:05:00.000Z',
      filmed: '2026-11-16T08:30:00.000Z',
      filmedSource: 'video',
    });
  });

  it('falls back to the phone file time, marked as such', () => {
    const t = analysisTimes(row({ filmedAt: null, fileLastModified: '2026-11-17T10:00:00.000Z' }));
    expect(t.filmed).toBe('2026-11-17T10:00:00.000Z');
    expect(t.filmedSource).toBe('file');
  });

  it('no filming time when neither is known', () => {
    const t = analysisTimes(row({ filmedAt: null, fileLastModified: null }));
    expect(t.filmed).toBeNull();
    expect(t.filmedSource).toBeNull();
  });

  it('older rows: recorded_at held the file time', () => {
    const t = analysisTimes(row({}, '2026-11-01T01:00:00.000Z'));
    expect(t.filmed).toBe('2026-11-01T01:00:00.000Z');
    expect(t.filmedSource).toBe('file');
    expect(t.analyzed).toBe('2026-11-18T03:05:00.000Z');
  });
});
