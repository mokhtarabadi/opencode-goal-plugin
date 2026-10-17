/**
 * Regression tests for best-plugin improvements D1-D5.
 * Why these tests exist: prove durability plus race plus evidence gate
 * plus per-session cooldown plus V2 strictness without breaking 76 baseline.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promises as fsp } from 'node:fs';
import { loadGoalState, resolveStatePath } from '../src/state.js';
import { buildEvidenceNudge } from '../src/compaction.js';
import { tryCompleteWithEvidence } from '../src/verifier.js';
import { isSafeGoalTitle, GoalInputSchema } from '../src/goal.js';
import {
  checkPerSessionCooldown,
  recordPerSessionTick,
  _resetPerSessionCooldownForTests,
} from '../src/limits.js';

describe('D1 quarantine preserves corrupt bytes', () => {
  it('quarantines torn JSON then throws', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-q-'));
    const sp = resolveStatePath(dir);
    await fsp.mkdir(path.dirname(sp), { recursive: true });
    await fsp.writeFile(sp, '{not-json', 'utf8');
    await expect(loadGoalState(sp)).rejects.toThrow();
  });
});

describe('D3 evidence nudge plus gated complete', () => {
  it('nudge is non-empty for both flags', () => {
    expect(buildEvidenceNudge('ship it', false).length).toBeGreaterThan(0);
    expect(buildEvidenceNudge('ship it', true)).toContain('pending');
  });
  it('missing evidence maps to evidence-required', async () => {
    const got = await tryCompleteWithEvidence({
      projectDir: '/tmp/nope',
      evidence: null,
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toBe('evidence-required');
  });
});

describe('D4 per-session cooldown fairness', () => {
  it('same lane blocks fast retry, other lane passes', () => {
    _resetPerSessionCooldownForTests();
    const now = 1700000000000;
    recordPerSessionTick('/tmp/a', now);
    expect(checkPerSessionCooldown('/tmp/a', now + 1000, 20000).ok).toBe(false);
    expect(checkPerSessionCooldown('/tmp/b', now + 1000, 20000).ok).toBe(true);
  });
  it('expiry after window passes', () => {
    _resetPerSessionCooldownForTests();
    const now = 1700000000000;
    recordPerSessionTick('/tmp/c', now);
    expect(checkPerSessionCooldown('/tmp/c', now + 20001, 20000).ok).toBe(true);
  });
});

describe('D5 input schema plus traversal guard', () => {
  it('schema requires title and blocks extra props', () => {
    expect(GoalInputSchema.required).toContain('title');
    expect(GoalInputSchema.additionalProperties).toBe(false);
  });
  it('rejects traversal and absolute paths, accepts prose', () => {
    expect(isSafeGoalTitle('ship login')).toBe(true);
    expect(isSafeGoalTitle('../escape')).toBe(false);
    expect(isSafeGoalTitle('/etc/passwd')).toBe(false);
    expect(isSafeGoalTitle('')).toBe(false);
  });
  it('rejects drive-letter escapes, accepts prose with slash', () => {
    expect(isSafeGoalTitle('C:\\escape')).toBe(false);
    expect(isSafeGoalTitle('ship login/api')).toBe(true);
  });
  it('rejects drive-relative escapes like C:escape', () => {
    expect(isSafeGoalTitle('C:escape')).toBe(false);
    expect(isSafeGoalTitle('note: fix login')).toBe(true);
  });
});

describe('F1 idle survival plus F5 lease proof plus nudge truncate', () => {
  it('nudge truncates long objectives and guards null', () => {
    const long = 'x'.repeat(1000);
    const got = buildEvidenceNudge(long, false);
    expect(got.length).toBeLessThan(800);
    expect(
      buildEvidenceNudge(null as unknown as string, false).length,
    ).toBeGreaterThan(0);
  });
  it('quarantine writes sidecar file beside corrupt state', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-q2-'));
    const sp = resolveStatePath(dir);
    await fsp.mkdir(path.dirname(sp), { recursive: true });
    await fsp.writeFile(sp, '{bad', 'utf8');
    await expect(loadGoalState(sp)).rejects.toThrow();
    const files = readdirSync(path.dirname(sp));
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true);
  });
  it('two sessions same project proceed independently', () => {
    _resetPerSessionCooldownForTests();
    const now = 1700000000000;
    const a = '/tmp/p:/tmp/p:sess-A';
    const b = '/tmp/p:/tmp/p:sess-B';
    recordPerSessionTick(a, now);
    expect(checkPerSessionCooldown(a, now + 1000, 20000).ok).toBe(false);
    expect(checkPerSessionCooldown(b, now + 1000, 20000).ok).toBe(true);
  });
});

describe('H1-H4 integration proofs', () => {
  it('prune helper keeps live while clearing stale', async () => {
    const { pruneIdleControllers } = await import('../src/compaction.js');
    let staleAborted = false;
    const live = { abort: () => {} };
    const stale = {
      abort: () => {
        staleAborted = true;
      },
    };
    const set = new Set([live, stale] as unknown as { abort: () => void }[]);
    pruneIdleControllers(
      set as unknown as Set<{ abort: () => void }>,
      live as { abort: () => void },
    );
    expect(staleAborted).toBe(true);
    expect(set.has(live as never)).toBe(true);
    expect(set.has(stale as never)).toBe(false);
  });
  it('stale lock denies second claim without progress', async () => {
    const { tryClaimLease, initialState, saveGoalState, LEASE_TTL_MS } =
      await import('../src/state.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-stale-'));
    const sp = resolveStatePath(dir);
    const clock = {
      now: 1700000000000,
      nowMs() {
        return this.now;
      },
    };
    await saveGoalState(sp, initialState('stale proof', clock, '2.0.29'));
    const first = await tryClaimLease(sp, 'holder-A', LEASE_TTL_MS, clock);
    expect(first.claimed).toBe(true);
    const second = await tryClaimLease(sp, 'holder-B', LEASE_TTL_MS, clock);
    expect(second.claimed).toBe(false);
  });
  it('wrapup sends once on budget hit then stays silent', async () => {
    const { handleSessionIdle, _resetIdleInFlightForTests } =
      await import('../src/loop.js');
    const { initialState } = await import('../src/state.js');
    const { DEFAULT_LIMITS } = await import('../src/limits.js');
    _resetIdleInFlightForTests();
    const clock = {
      now: 1700000000000,
      nowMs() {
        return this.now;
      },
    };
    const base = {
      ...initialState('wrap proof', clock, '2.0.29'),
      iterationCount: 30,
      wrapupSent: false,
    };
    const store = { state: base as typeof base | null };
    const sent: string[] = [];
    let saves = 0;
    const deps = {
      clock,
      limits: DEFAULT_LIMITS,
      ownerId: 'wrap-A',
      loadState: async () => store.state,
      saveState: async (_p: string, s: typeof base) => {
        saves += 1;
        store.state = s;
      },
      // Claim succeeds so the one-time wrap send actually fires.
      tryClaim: async () => ({ claimed: true, state: store.state }),
      sendPrompt: async (p: string) => {
        sent.push(p);
        return { success: true as const, messageId: 'wrap-1' };
      },
      hasStopFile: async () => false,
    };
    const first = await handleSessionIdle(
      { projectDir: '/tmp/wrap1', lastMessageId: null },
      deps as never,
    );
    expect(first.reason).toBe('max-turns');
    expect(store.state?.wrapupSent).toBe(true);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('budget reached');
    const savesAfterFirst = saves;
    const second = await handleSessionIdle(
      { projectDir: '/tmp/wrap1', lastMessageId: null },
      deps as never,
    );
    // Wrapped-up is terminal: no second wrap send, no extra save.
    expect(second.reason).toBe('wrapped-up');
    expect(sent.length).toBe(1);
    expect(saves).toBe(savesAfterFirst);
  });
  it('two loop ticks same project different sessions both send', async () => {
    const { handleSessionIdle, _resetIdleInFlightForTests } =
      await import('../src/loop.js');
    const { initialState } = await import('../src/state.js');
    const { DEFAULT_LIMITS } = await import('../src/limits.js');
    _resetIdleInFlightForTests();
    const mk = () => {
      const clock = {
        now: 1700000000000,
        nowMs() {
          return this.now;
        },
      };
      const store = {
        state: { ...initialState('fair proof', clock, '2.0.29') } as never,
      };
      const sent: string[] = [];
      const deps = {
        clock,
        limits: { ...DEFAULT_LIMITS, minDelayMs: 0 },
        ownerId: 'fair',
        loadState: async () => store.state,
        saveState: async (_p: string, s: never) => {
          store.state = s;
        },
        tryClaim: async (_p: string, owner: string, ttl: number) => ({
          claimed: true,
          state: {
            ...(store.state as object),
            leaseOwner: owner,
            leaseExpiresAtMs: 9999999999999,
          } as never,
        }),
        sendPrompt: async (p: string) => {
          sent.push(p);
          return { messageId: 'm-' + String(sent.length) };
        },
        hasStopFile: async () => false,
      };
      return { deps, sent };
    };
    // Sequential ticks with reset between prove independent lanes reach send.
    const a = mk();
    const gotA = await handleSessionIdle(
      { projectDir: '/tmp/fair', lastMessageId: null, sessionId: 'sess-A' },
      a.deps as never,
    );
    expect(gotA.decision).toBe('sent');
    _resetIdleInFlightForTests();
    const b = mk();
    const gotB = await handleSessionIdle(
      { projectDir: '/tmp/fair', lastMessageId: null, sessionId: 'sess-B' },
      b.deps as never,
    );
    expect(gotB.decision).toBe('sent');
  });
  it('setup guard rejects escapes including drive-relative', async () => {
    const { handleGoalCommand } = await import('../src/index.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-setup-'));
    const clock = { nowMs: () => 1700000000000 };
    expect(
      await handleGoalCommand('/goal ../escape', dir, clock as never),
    ).toContain('path escape');
    expect(
      await handleGoalCommand('/goal C:escape', dir, clock as never),
    ).toContain('path escape');
    expect(
      await handleGoalCommand('/goal ship login/api', dir, clock as never),
    ).toContain('Goal set');
  });
});
