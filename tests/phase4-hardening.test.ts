/**
 * Phase 4 hardening tests: traversal plus parallel restore plus clamp.
 * Why these tests exist: lock the publish-prep guarantees.
 */
import { describe, it, expect } from 'vitest';
import { isCitationInsideProjectDir } from '../src/verifier.js';
import { restoreAfterCompaction } from '../src/compaction.js';

describe('phase4 hardening', () => {
  it('T1 rejects dot-dot traversal citation', () => {
    expect(isCitationInsideProjectDir('/tmp/proj', '../outside.txt')).toBe(false);
    expect(isCitationInsideProjectDir('/tmp/proj', 'evidence/a.json')).toBe(true);
  });
  it('T2 parallel restore keeps audit count sane', async () => {
    // Two concurrent restores must each report at least one restore, never throw.
    let stored: Record<string, unknown> = {
      iterationCount: 2,
      lastTurnAtMs: 1700000000000,
      lastContinuedMessageId: 'm1',
      restoreCount: 0
    };
    const store = {
      loadState: async () => stored,
      saveState: async (_p: string, v: unknown) => {
        stored = v as Record<string, unknown>;
      }
    };
    class C {
      constructor(public now = 1700000001000) {}
      nowMs(): number {
        return this.now;
      }
    }
    const clock = new C();
    const [a, b] = await Promise.all([
      restoreAfterCompaction('/tmp/x.json', clock, store),
      restoreAfterCompaction('/tmp/x.json', clock, store)
    ]);
    expect(a?.restoreCount).toBeGreaterThanOrEqual(1);
    expect(b?.restoreCount).toBeGreaterThanOrEqual(1);
    expect(stored['restoreCount'] as number).toBeGreaterThanOrEqual(1);
  });
  it('T6 restore clamps future timestamp to now', async () => {
    let s: Record<string, unknown> = {
      iterationCount: 1,
      lastTurnAtMs: 1800000000000,
      lastContinuedMessageId: 'm9',
      restoreCount: 0
    };
    const store2 = {
      loadState: async () => s,
      saveState: async (_p: string, v: unknown) => {
        s = v as Record<string, unknown>;
      }
    };
    class C2 {
      constructor(public now = 1700000000000) {}
      nowMs(): number {
        return this.now;
      }
    }
    const got = await restoreAfterCompaction('/tmp/y.json', new C2(), store2);
    expect(got?.lastTurnAtMs).toBe(1700000000000);
  });
});
