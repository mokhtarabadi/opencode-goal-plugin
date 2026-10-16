/**
 * Compaction snapshot plus restore tests Phase 3.
 * Why these tests exist: prove goals survive compaction without double resume.
 */
import { describe, it, expect } from 'vitest';
import {
  snapshotForCompaction,
  restoreAfterCompaction,
} from '../src/compaction.js';

/** Fixed clock for compaction timestamps. */
class C {
  constructor(public now = 1700000000000) {}
  nowMs(): number {
    return this.now;
  }
}

describe('compaction', () => {
  it('snapshot preserves count and message', async () => {
    let s: Record<string, unknown> = {
      iterationCount: 2,
      lastTurnAtMs: 100,
      lastContinuedMessageId: 'm1',
      restoreCount: 1,
    };
    const store = {
      loadState: async () => s,
      saveState: async (_p: string, v: unknown) => {
        s = v as Record<string, unknown>;
      },
    };
    const got = await snapshotForCompaction('/tmp/x.json', new C(), store);
    expect(got?.iterationCount).toBe(2);
    expect(got?.lastContinuedMessageId).toBe('m1');
  });
  it('restore bumps count and keeps cooldown', async () => {
    let s: Record<string, unknown> = {
      iterationCount: 2,
      lastTurnAtMs: 1699999990000,
      lastContinuedMessageId: 'm1',
      restoreCount: 1,
    };
    const store = {
      loadState: async () => s,
      saveState: async (_p: string, v: unknown) => {
        s = v as Record<string, unknown>;
      },
    };
    const got = await restoreAfterCompaction(
      '/tmp/x.json',
      new C(1700000000000),
      store,
    );
    expect(got?.restoreCount).toBe(2);
    expect(got?.lastContinuedMessageId).toBe('m1');
    expect(got?.lastTurnAtMs).toBe(1699999990000);
  });
  it('restore returns null without state', async () => {
    const store = { loadState: async () => null, saveState: async () => {} };
    expect(
      await restoreAfterCompaction('/tmp/x.json', new C(), store),
    ).toBeNull();
  });
  it('restore clamps future timestamp to now', async () => {
    // Future last-turn would break cooldown budgets, so restore clamps it.
    let s: Record<string, unknown> = {
      iterationCount: 1,
      lastTurnAtMs: 1800000000000,
      lastContinuedMessageId: 'm1',
      restoreCount: 0,
    };
    const store = {
      loadState: async () => s,
      saveState: async (_p: string, v: unknown) => {
        s = v as Record<string, unknown>;
      },
    };
    const got = await restoreAfterCompaction(
      '/tmp/x.json',
      new C(1700000000000),
      store,
    );
    expect(got?.lastTurnAtMs).toBe(1700000000000);
    expect(got?.restoreCount).toBe(1);
  });
});
