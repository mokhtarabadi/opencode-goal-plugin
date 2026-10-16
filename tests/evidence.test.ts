/**
 * Evidence schema tests Phase 3.
 * Why these tests exist: lock the proof contract for completion.
 */
import { describe, it, expect } from 'vitest';
import {
  validateEvidenceShape,
  hashEvidence,
  emptyEvidence,
} from '../src/evidence.js';

describe('evidence schema', () => {
  it('rejects empty criteria', () => {
    const got = validateEvidenceShape(emptyEvidence(1700000000000));
    expect(got.ok).toBe(false);
  });
  it('accepts cited files plus passing test', () => {
    const ev = {
      version: 1 as const,
      updatedAtMs: 1700000000000,
      criteria: [
        {
          id: 'c1',
          claim: 'idle sends once',
          files: ['src/loop.ts'],
          tests: [{ command: 'npm test', exitCode: 0 }],
        },
      ],
    };
    expect(validateEvidenceShape(ev).ok).toBe(true);
    expect(hashEvidence(ev).length).toBe(16);
  });
  it('rejects bad version', () => {
    expect(validateEvidenceShape({ version: 2, criteria: [] }).ok).toBe(false);
  });
});
