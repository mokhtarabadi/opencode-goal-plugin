/**
 * Evidence schema tests Phase 3.
 * Why these tests exist: lock the proof contract for completion.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  validateEvidenceShape,
  hashEvidence,
  emptyEvidence,
  loadEvidence,
  saveEvidence,
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

describe('evidence legacy fallback boundary', () => {
  /** One criterion, enough to pass shape validation. */
  function stale() {
    return {
      version: 1 as const,
      updatedAtMs: 1700000000000,
      criteria: [
        {
          id: 'stale',
          claim: 'from a finished goal',
          files: ['src/index.ts'],
          tests: [{ command: 'node -e "process.exit(1)"', exitCode: 1 }],
        },
      ],
    };
  }

  it('reads legacy only until the session owns a file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-ev-fallback-'));
    // No scoped file: the pre-isolation sidecar is readable once.
    await saveEvidence(dir, stale());
    expect((await loadEvidence(dir, 'sess-x'))?.criteria.length).toBe(1);
    // The set lane seeds an empty scoped file: from here it is authoritative.
    await saveEvidence(dir, emptyEvidence(1700000001000), 'sess-x');
    expect(await loadEvidence(dir, 'sess-x')).toBeNull();
    // The legacy bucket is untouched, so a legacy-only reader still sees it.
    expect((await loadEvidence(dir))?.criteria.length).toBe(1);
  });

  it('a scoped file decides even when it is invalid', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-ev-fallback2-'));
    await saveEvidence(dir, stale());
    // Corrupt scoped file: fail closed instead of borrowing legacy proof.
    await saveEvidence(
      dir,
      { version: 1, updatedAtMs: 1, criteria: [] } as never,
      'sess-y',
    );
    expect(await loadEvidence(dir, 'sess-y')).toBeNull();
  });
});
