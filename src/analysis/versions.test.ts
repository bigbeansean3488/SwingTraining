import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './common';
import { DEFINITION_CHANGES, definitionGeneration, sameDefinitions } from './versions';

describe('engine version comparability', () => {
  it('batting numbers from 1.1.x and 1.2.x are not comparable (contact moved)', () => {
    expect(sameDefinitions('batting', '1.1.0', '1.2.0')).toBe(false);
    expect(sameDefinitions('batting', '1.2.0', '1.2.3')).toBe(true);
    // 1.3.0: contact frame rounded up, peak refined between frames.
    expect(sameDefinitions('batting', '1.2.0', '1.3.0')).toBe(false);
    expect(sameDefinitions('pitching', '1.2.0', '1.3.0')).toBe(true);
  });

  it('pitching did not change in 1.2.0', () => {
    expect(sameDefinitions('pitching', '1.1.0', '1.2.0')).toBe(true);
    expect(sameDefinitions('pitching', '1.0.0', '1.1.0')).toBe(false);
  });

  it('a later version without a listed change stays in the same generation', () => {
    expect(definitionGeneration('batting', '1.2.7')).toBe('1.2.0');
    expect(definitionGeneration('pitching', '1.10.0')).toBe('1.1.0');
  });

  it('every listed change is at or before the current engine', () => {
    for (const kind of ['batting', 'pitching'] as const) {
      const list = DEFINITION_CHANGES[kind];
      expect(definitionGeneration(kind, ENGINE_VERSION)).toBe(list[list.length - 1]);
    }
  });
});
