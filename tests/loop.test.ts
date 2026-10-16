/**
 * Loop behavior tests Phase 2.
 * Why these tests exist: lock single send plus skip rules plus stop rules.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { _resetIdleInFlightForTests, buildContinuationPrompt, handleSessionIdle, shouldContinue } from '../src/loop.js';
import type { IdleDeps } from '../src/loop.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import { initialState } from '../src/state.js';
import type { Clock, GoalState } from '../src/state.js';

/** Fixed clock plus mutable now for cooldown travel. */
class FakeClock implements Clock {
  constructor(public now: number) {}
  nowMs(): number {
    return this.now;
  }
}

/** Fresh active state with optional overrides. */
function makeActive(clock: FakeClock, over: Partial<GoalState> = {}): GoalState {
  return { ...initialState('ship login', clock, '2.0.29'), ...over };
}

/** In-memory deps with controllable store and captured prompts. */
function makeDeps(store: { state: GoalState | null }, clock: FakeClock, sent: string[], extra: Partial<IdleDeps> = {}): IdleDeps {
  return {
    clock,
    limits: DEFAULT_LIMITS,
    ownerId: 'owner-A',
    loadState: async () => store.state,
    saveState: async (_p, s) => {
      store.state = s;
    },
    tryClaim: async (_p, owner, ttl, c) => {
      // Mirror of the file lease: live foreign lease blocks, else claim wins.
      const now = c.nowMs();
      if (store.state === null) return { claimed: false, state: null };
      const held = store.state.leaseOwner !== null && store.state.leaseExpiresAtMs > now && store.state.leaseOwner !== owner;
      if (held) return { claimed: false, state: store.state };
      store.state = { ...store.state, leaseOwner: owner, leaseExpiresAtMs: now + ttl };
      return { claimed: true, state: store.state };
    },
    sendPrompt: async (prompt: string) => {
      sent.push(prompt);
      return { messageId: 'msg-' + String(sent.length), tokenSpend: 10 };
    },
    hasStopFile: async () => false,
    ...extra
  };
}

beforeEach(() => {
  _resetIdleInFlightForTests();
});

describe('shouldContinue', () => {
  it('stops on complete blocked cleared', () => {
    const c = new FakeClock(1700000000000);
    for (const s of ['complete', 'blocked', 'cleared'] as const) {
      const got = shouldContinue(makeActive(c, { status: s }), c.now, null, DEFAULT_LIMITS);
      expect(got.ok).toBe(false);
    }
  });
  it('skips cooldown and human message', () => {
    const c = new FakeClock(1700000000000);
    const cool = makeActive(c, { lastTurnAtMs: c.now - 5000 });
    expect(shouldContinue(cool, c.now, null, DEFAULT_LIMITS).reason).toBe('cooldown');
    const human = makeActive(c, { lastTurnAtMs: 0, lastContinuedMessageId: 'msg-1' });
    expect(shouldContinue(human, c.now, 'msg-human-2', DEFAULT_LIMITS).reason).toBe('human-message');
  });
  it('stops on max turns and wall time', () => {
    const c = new FakeClock(1700000000000);
    const maxed = makeActive(c, { iterationCount: 30 });
    expect(shouldContinue(maxed, c.now, null, DEFAULT_LIMITS).reason).toBe('max-turns');
    const old = makeActive(c, { createdAtMs: c.now - 7200000 - 1 });
    expect(shouldContinue(old, c.now, null, DEFAULT_LIMITS).reason).toBe('wall-time');
  });
  it('prompt contains objective and stop verbs', () => {
    const c = new FakeClock(1700000000000);
    const p = buildContinuationPrompt(makeActive(c));
    expect(p).toContain('ship login');
    expect(p).toContain('complete');
    expect(p).toContain('block');
  });
});

describe('handleSessionIdle', () => {
  it('sends once and updates state', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c, { lastTurnAtMs: 0 }) as GoalState | null };
    const sent: string[] = [];
    const got = await handleSessionIdle({ projectDir: '/tmp/p1', lastMessageId: null }, makeDeps(store, c, sent));
    expect(got.decision).toBe('sent');
    expect(sent.length).toBe(1);
    expect(store.state?.iterationCount).toBe(1);
    expect(store.state?.lastContinuedMessageId).toBe('msg-1');
  });
  it('parallel double idle yields exactly one send', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c, { lastTurnAtMs: 0 }) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent);
    const ctx = { projectDir: '/tmp/p2', lastMessageId: null };
    const out = await Promise.all([handleSessionIdle(ctx, deps), handleSessionIdle(ctx, deps)]);
    const wins = out.filter((r) => r.decision === 'sent').length;
    expect(wins).toBe(1);
    expect(sent.length).toBe(1);
  });
  it('skips when lease held', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c, { leaseOwner: 'other', leaseExpiresAtMs: c.now + 60000 }) as GoalState | null };
    const sent: string[] = [];
    const got = await handleSessionIdle({ projectDir: '/tmp/p3', lastMessageId: null }, makeDeps(store, c, sent));
    expect(got.decision).toBe('skipped');
    expect(got.reason).toBe('lease-held');
    expect(sent.length).toBe(0);
  });
  it('stops on stop file', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { hasStopFile: async () => true });
    const got = await handleSessionIdle({ projectDir: '/tmp/p4', lastMessageId: null }, deps);
    expect(got.decision).toBe('stopped');
    expect(got.reason).toBe('stop-file');
  });
});

describe('handleSessionIdle edges', () => {
  it('maps load throw to corrupt-state', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { loadState: async () => { throw new Error('bad json'); } });
    const got = await handleSessionIdle({ projectDir: '/tmp/e1', lastMessageId: null }, deps);
    expect(got.decision).toBe('stopped');
    expect(got.reason).toBe('corrupt-state');
  });
  it('maps tryClaim throw to claim-failed', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { tryClaim: async () => { throw new Error('lock io'); } });
    const got = await handleSessionIdle({ projectDir: '/tmp/e2', lastMessageId: null }, deps);
    expect(got.reason).toBe('claim-failed');
  });
  it('maps send throw to send-failed and clears lease', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { sendPrompt: async () => { throw new Error('model down'); } });
    const got = await handleSessionIdle({ projectDir: '/tmp/e3', lastMessageId: null }, deps);
    expect(got.reason).toBe('send-failed');
    expect(store.state?.leaseOwner).toBeNull();
  });
  it('rejects empty messageId as send-failed', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { sendPrompt: async () => ({ messageId: '', tokenSpend: 0 }) });
    const got = await handleSessionIdle({ projectDir: '/tmp/e4', lastMessageId: null }, deps);
    expect(got.reason).toBe('send-failed');
    expect(store.state?.iterationCount).toBe(0);
  });
  it('handles null ctx without throw', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const got = await handleSessionIdle(null as unknown as { projectDir: string; lastMessageId: string | null }, makeDeps(store, c, sent));
    expect(got.reason).toBe('invalid-context');
  });
  it('maps stop check throw to stop-check-failed', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { hasStopFile: async () => { throw new Error('fs perm'); } });
    const got = await handleSessionIdle({ projectDir: '/tmp/e6', lastMessageId: null }, deps);
    expect(got.reason).toBe('stop-check-failed');
  });
  it('uses post-send time for cooldown', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c, { lastTurnAtMs: 0 }) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { sendPrompt: async (p: string) => { c.now += 5000; sent.push(p); return { messageId: 'msg-9', tokenSpend: 1 }; } });
    await handleSessionIdle({ projectDir: '/tmp/e7', lastMessageId: null }, deps);
    expect(store.state?.lastTurnAtMs).toBe(1700000005000);
  });
  it('loads Phase 1 file via normalize defaults', async () => {
    const { normalizeState } = await import('../src/state.js');
    const c = new FakeClock(1700000000000);
    const base = makeActive(c);
    const legacy = { ...base } as unknown as Record<string, unknown>;
    delete legacy['lastTurnAtMs'];
    delete legacy['lastContinuedMessageId'];
    const fixed = normalizeState(legacy as unknown as GoalState);
    expect(fixed.lastTurnAtMs).toBe(0);
    expect(fixed.lastContinuedMessageId).toBe('');
  });
  it('rejects bad register opts without throw', async () => {
    const { registerIdleHandler } = await import('../src/index.js');
    expect(registerIdleHandler({}, null as unknown as never).registered).toBe(false);
    expect(registerIdleHandler({}, { projectDir: '', getLastMessageId: () => null, sendPrompt: async () => ({ messageId: 'x' }) }).registered).toBe(false);
  });
});

describe('handleSessionIdle hardening', () => {
  it('returns invalid-deps for missing clock', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent) as unknown as Record<string, unknown>;
    delete deps['clock'];
    const got = await handleSessionIdle({ projectDir: '/tmp/h1', lastMessageId: null }, deps as unknown as IdleDeps);
    expect(got.reason).toBe('invalid-deps');
  });
  it('returns invalid-limits for malformed limits', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { limits: { minDelayMs: 1 } as unknown as typeof DEFAULT_LIMITS });
    const got = await handleSessionIdle({ projectDir: '/tmp/h2', lastMessageId: null }, deps);
    expect(got.reason).toBe('invalid-limits');
  });
  it('maps save after send throw to save-failed', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { saveState: async () => { throw new Error('disk full'); } });
    const first = await handleSessionIdle({ projectDir: '/tmp/h3', lastMessageId: null }, deps);
    expect(first.reason).toBe('save-failed');
  });
  it('treats non numeric spend as zero', async () => {
    const c = new FakeClock(1700000000000);
    const store = { state: makeActive(c) as GoalState | null };
    const sent: string[] = [];
    const deps = makeDeps(store, c, sent, { sendPrompt: async (p: string) => { sent.push(p); return { messageId: 'msg-good', tokenSpend: '10' as unknown as number }; } });
    const got = await handleSessionIdle({ projectDir: '/tmp/h4', lastMessageId: null }, deps);
    expect(got.decision).toBe('sent');
    expect(store.state?.tokenSpend).toBe(0);
  });
  it('registers success with fake host', async () => {
    const { registerIdleHandler } = await import('../src/index.js');
    let cb: (() => Promise<void>) | null = null;
    const host = { onIdle: (f: () => Promise<void>) => { cb = f; } };
    const out = registerIdleHandler(host, { projectDir: '/tmp/h5', getLastMessageId: () => null, sendPrompt: async () => ({ messageId: 'm1' }), ownerId: 't-owner' });
    expect(out.registered).toBe(true);
    expect(typeof cb).toBe('function');
  });
});
