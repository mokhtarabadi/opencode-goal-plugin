/**
 * Tests for file state roundtrip and lease single-flight.
 * Why these tests exist: prove compaction survival and duplicate-continuation guard.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEASE_TTL_MS,
  initialState,
  loadGoalState,
  resolveStatePath,
  saveGoalState,
  tryClaimLease,
} from '../src/state.js';
import type { Clock } from '../src/state.js';

class FakeClock implements Clock {
  constructor(public now: number) {}
  nowMs(): number {
    return this.now;
  }
}

describe('state roundtrip', () => {
  it('saves and loads', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-'));
    const clock = new FakeClock(1700000000000);
    const statePath = resolveStatePath(dir);
    const s = initialState('ship it', clock, '2.0.29');
    await saveGoalState(statePath, s);
    const loaded = await loadGoalState(statePath);
    expect(loaded?.objective).toBe('ship it');
  });
  it('second claimant blocked while lease live, allowed after expiry', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-'));
    const clock = new FakeClock(1700000000000);
    const statePath = resolveStatePath(dir);
    await saveGoalState(statePath, initialState('a', clock, '2.0.29'));
    const first = await tryClaimLease(statePath, 'run-1', LEASE_TTL_MS, clock);
    expect(first.claimed).toBe(true);
    const second = await tryClaimLease(statePath, 'run-2', LEASE_TTL_MS, clock);
    expect(second.claimed).toBe(false);
    clock.now += LEASE_TTL_MS + 1;
    const third = await tryClaimLease(statePath, 'run-2', LEASE_TTL_MS, clock);
    expect(third.claimed).toBe(true);
  });
  it('parallel double idle yields exactly one winner', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-'));
    const clock = new FakeClock(1700000000000);
    const statePath = resolveStatePath(dir);
    await saveGoalState(statePath, initialState('a', clock, '2.0.29'));
    const results = await Promise.all([
      tryClaimLease(statePath, 'idle-A', LEASE_TTL_MS, clock),
      tryClaimLease(statePath, 'idle-B', LEASE_TTL_MS, clock),
    ]);
    const wins = results.filter((r) => r.claimed).length;
    expect(wins).toBe(1);
  });
});

describe('state validation edges', () => {
  it('rejects partial object as corrupt', async () => {
    // Partial objects missing lease fields must fail validation (QA F7).
    const { promises: fsp } = await import('node:fs');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-partial-'));
    const sp = resolveStatePath(dir);
    await fsp.mkdir(path.dirname(sp), { recursive: true });
    await fsp.writeFile(
      sp,
      JSON.stringify({ objective: 'x', status: 'active', updatedAtMs: 1 }),
      'utf8',
    );
    await expect(loadGoalState(sp)).rejects.toThrow();
  });
  it('rejects corrupt json', async () => {
    const { promises: fsp } = await import('node:fs');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-corrupt-'));
    const sp = resolveStatePath(dir);
    await fsp.mkdir(path.dirname(sp), { recursive: true });
    await fsp.writeFile(sp, '{not-json', 'utf8');
    await expect(loadGoalState(sp)).rejects.toThrow();
  });
});

describe('file claim concurrency', () => {
  it('parallel file claims yield exactly one winner', async () => {
    // Real-file proof for the wx claim lock: two processes worth of
    // concurrency collapse to one winner (QA F1, ADR-002).
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-claim-'));
    const sp = resolveStatePath(dir);
    const clock = new FakeClock(1700000000000);
    await saveGoalState(sp, initialState('claim race', clock, '2.0.29'));
    const out = await Promise.all([
      tryClaimLease(sp, 'file-A', LEASE_TTL_MS, clock),
      tryClaimLease(sp, 'file-B', LEASE_TTL_MS, clock),
    ]);
    const wins = out.filter((r) => r.claimed).length;
    expect(wins).toBe(1);
  });
});
