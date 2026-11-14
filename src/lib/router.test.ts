import { describe, expect, it } from 'vitest';
import { parseHash } from './router';

describe('parseHash', () => {
  it('parses empty hash as root', () => {
    expect(parseHash('').path).toEqual([]);
    expect(parseHash('#/').path).toEqual([]);
  });
  it('splits path and query', () => {
    const r = parseHash('#/players/abc%20d?tab=trend');
    expect(r.path).toEqual(['players', 'abc d']);
    expect(r.query.get('tab')).toBe('trend');
  });
});
