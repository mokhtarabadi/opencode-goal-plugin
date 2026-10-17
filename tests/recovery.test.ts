/**
 * Crash and error recovery regression tests.
 * Why these tests exist: an active goal must survive a failed send, a provider
 * error, and a restart. They prove the retryable send, the failure
 * classification, the watchdog wake, the resume rearm, and the wrap-once rule
 * without a live host.
 */
import { describe, expect, it } from 'vitest';
import {
  _resetIdleInFlightForTests,
  buildPendingAttempt,
  buildWrapupPrompt,
  classifyFailure,
  handleSessionFailure,
  handleSessionIdle,
  normalizeSendResult,
  shouldContinue,
} from '../src/loop.js';
import type { IdleDeps } from '../src/loop.js';
import {
  DEFAULT_LIMITS,
  _resetPerSessionCooldownForTests,
} from '../src/limits.js';
import { initialState, normalizeState } from '../src/state.js';
import type { Clock, GoalState } from '../src/state.js';
import {
  armWatchdog,
  clearWatchdog,
  watchdogCount,
  _resetWatchdogsForTests,
} from '../src/watchdog.js';

/** Fixed clock with mutable now. */
class FakeClock implements Clock {
  constructor(public now: number) {}
  nowMs(): number {
    return this.now;
  }
}

/** Fresh active state with overrides. */
function makeActive(
  clock: FakeClock,
  over: Partial<GoalState> = {},
): GoalState {
  return { ...initialState('recover goal', clock, '2.0.29'), ...over };
}

/** Minimal deps with a scripted send result. */
function makeDeps(
  store: { state: GoalState | null },
  clock: FakeClock,
  sendResult: unknown,
  extra: Partial<IdleDeps> = {},
): IdleDeps {
  return {
    clock,
    limits: DEFAULT_LIMITS,
    ownerId: 'owner-R',
    loadState: async () => store.state,
    saveState: async (_p, s) => {
      store.state = s;
    },
    tryClaim: async () => {
      if (store.state === null) return { claimed: false, state: null };
      return { claimed: true, state: store.state };
    },
    sendPrompt: async () => sendResult as never,
    hasStopFile: async () => false,
    ...extra,
  };
}

describe('D1 retryable send', () => {
  it('normalizes a legacy result and a failure', () => {
    expect(normalizeSendResult({ messageId: 'm1' }).success).toBe(true);
    expect(normalizeSendResult({ messageId: '' }).success).toBe(false);
    expect(normalizeSendResult(null).success).toBe(false);
    const fail = normalizeSendResult({ success: true, messageId: '' });
    expect(fail.success).toBe(false);
  });
  it('failed send does not advance the turn and records an attempt', async () => {
    _resetIdleInFlightForTests();
    _resetPerSessionCooldownForTests();
    const clock = new FakeClock(1700000000000);
    const store = {
      state: makeActive(clock, { lastTurnAtMs: 0 }) as GoalState | null,
    };
    const deps = makeDeps(store, clock, {
      success: false,
      error: 'provider down',
      retryable: true,
    });
    const got = await handleSessionIdle(
      { projectDir: '/tmp/rec1', lastMessageId: null },
      deps,
    );
    expect(got.reason).toBe('send-failed');
    // Turn count stays put so the failed attempt can be retried.
    expect(store.state?.iterationCount).toBe(0);
    expect(store.state?.pendingAttempt).not.toBeNull();
    expect(store.state?.failureCount).toBe(1);
  });
});

describe('D2 failure classification plus handler', () => {
  it('classifies abort versus provider error', () => {
    expect(classifyFailure({ name: 'MessageAbortedError' })).toBe('user-abort');
    expect(classifyFailure('aborted by user')).toBe('user-abort');
    // A bare "aborted" is ambiguous: a transport can abort too, so without an
    // interrupted hint it stays a retryable provider error.
    expect(classifyFailure('operation was aborted')).toBe('provider-error');
    expect(
      classifyFailure('operation was aborted', 'session.execution.interrupted'),
    ).toBe('user-abort');
    expect(classifyFailure('provider aborted connection')).toBe(
      'provider-error',
    );
    expect(classifyFailure('request timeout')).toBe('provider-error');
    expect(classifyFailure('ECONNRESET')).toBe('provider-error');
    expect(classifyFailure(undefined)).toBe('provider-error');
  });
  it('user abort parks the goal and clears the attempt', async () => {
    const clock = new FakeClock(1700000000000);
    const store = { state: makeActive(clock) as GoalState | null };
    const got = await handleSessionFailure(
      { projectDir: '/tmp/rec2', sessionId: 's1' },
      {
        clock,
        loadState: async () => store.state,
        saveState: async (_p, s) => {
          store.state = s;
        },
      },
      { name: 'MessageAbortedError' },
    );
    expect(got.reason).toBe('user-abort-parked');
    expect(store.state?.status).toBe('interrupted');
    expect(store.state?.pendingAttempt).toBeNull();
  });
  it('provider error records a retry attempt', async () => {
    const clock = new FakeClock(1700000000000);
    const store = { state: makeActive(clock) as GoalState | null };
    const got = await handleSessionFailure(
      { projectDir: '/tmp/rec3', sessionId: 's1' },
      {
        clock,
        loadState: async () => store.state,
        saveState: async (_p, s) => {
          store.state = s;
        },
      },
      'fetch failed',
    );
    expect(got.reason).toBe('provider-error-retry');
    expect(store.state?.status).toBe('active');
    expect(store.state?.pendingAttempt).not.toBeNull();
    expect(store.state?.failureCount).toBe(1);
  });
});

describe('D3 watchdog', () => {
  it('arms, fires once, and clears', async () => {
    _resetWatchdogsForTests();
    const clock = new FakeClock(1700000000000);
    let fired = 0;
    armWatchdog('/tmp/w1', 's1', clock.nowMs() + 1000, clock, async () => {
      fired += 1;
    });
    expect(watchdogCount()).toBe(1);
    await new Promise((r) => setTimeout(r, 1100));
    expect(fired).toBe(1);
    // Handle removed after firing: no stale re-fire.
    expect(watchdogCount()).toBe(0);
    clearWatchdog('/tmp/w1', 's1');
    expect(watchdogCount()).toBe(0);
  });
});

describe('D5 wrap-once prompt', () => {
  it('wrap prompt names the objective and stop verbs', () => {
    const clock = new FakeClock(1700000000000);
    const p = buildWrapupPrompt(makeActive(clock), 'max-turns');
    expect(p).toContain('recover goal');
    expect(p).toContain('budget reached');
    expect(p).toContain('complete');
  });
  it('gate stops once the wrap flag is set', () => {
    const clock = new FakeClock(1700000000000);
    const wrapped = makeActive(clock, { wrapupSent: true });
    expect(
      shouldContinue(wrapped, clock.now, null, DEFAULT_LIMITS).reason,
    ).toBe('wrapped-up');
  });
});

describe('D6 persisted guards', () => {
  it('pending attempt survives a reload and normalize fills old files', () => {
    const clock = new FakeClock(1700000000000);
    const withAttempt = {
      ...makeActive(clock),
      pendingAttempt: buildPendingAttempt(
        makeActive(clock),
        'provider-error',
        clock.nowMs(),
      ),
      lastHeartbeatMs: clock.nowMs(),
      failureCount: 2,
      recoveryEpoch: 3,
    };
    const reloaded = normalizeState(
      JSON.parse(JSON.stringify(withAttempt)) as GoalState,
    );
    expect(reloaded.pendingAttempt?.attemptCount).toBe(1);
    expect(reloaded.failureCount).toBe(2);
    expect(reloaded.recoveryEpoch).toBe(3);
    // An older file without the recovery fields still loads with defaults.
    const legacy = JSON.parse(JSON.stringify(makeActive(clock))) as Record<
      string,
      unknown
    >;
    delete legacy['pendingAttempt'];
    delete legacy['lastHeartbeatMs'];
    delete legacy['failureCount'];
    delete legacy['recoveryEpoch'];
    const norm = normalizeState(legacy as unknown as GoalState);
    expect(norm.pendingAttempt).toBeNull();
    expect(norm.lastHeartbeatMs).toBe(0);
    expect(norm.failureCount).toBe(0);
    expect(norm.recoveryEpoch).toBe(0);
  });
});

describe('hotfix guards', () => {
  it('failure path skips when the lease is held', async () => {
    const clock = new FakeClock(1700000000000);
    const store = { state: makeActive(clock) as GoalState | null };
    let saves = 0;
    const got = await handleSessionFailure(
      { projectDir: '/tmp/hx1', sessionId: 's1' },
      {
        clock,
        loadState: async () => store.state,
        saveState: async () => {
          saves += 1;
        },
        tryClaim: async () => ({ claimed: false, state: store.state }),
        ownerId: 'hf',
      },
      'fetch failed',
    );
    expect(got.reason).toBe('lease-held');
    // A held lease must not be clobbered by the failure write.
    expect(saves).toBe(0);
  });
  it('non-retryable send parks the goal', async () => {
    _resetIdleInFlightForTests();
    _resetPerSessionCooldownForTests();
    const clock = new FakeClock(1700000000000);
    const store = {
      state: makeActive(clock, { lastTurnAtMs: 0 }) as GoalState | null,
    };
    const deps = makeDeps(store, clock, {
      success: false,
      error: 'aborted by user',
      retryable: false,
    });
    const got = await handleSessionIdle(
      { projectDir: '/tmp/hx2', lastMessageId: null },
      deps,
    );
    expect(got.reason).toBe('user-abort-parked');
    expect(store.state?.status).toBe('interrupted');
    expect(store.state?.pendingAttempt).toBeNull();
  });
  it('interrupted goal resumes via resumeGoal', async () => {
    const { resumeGoal } = await import('../src/goal.js');
    const clock = new FakeClock(1700000000000);
    const parked = makeActive(clock, { status: 'interrupted' });
    const resumed = resumeGoal(parked, clock);
    expect(resumed.status).toBe('active');
    expect(resumed.recoveryEpoch).toBe(1);
    // Active goals cannot resume again.
    expect(() => resumeGoal(resumed, clock)).toThrow();
  });
  it('wrap does not flip when the lease is not claimed', async () => {
    _resetIdleInFlightForTests();
    const clock = new FakeClock(1700000000000);
    const store = {
      state: makeActive(clock, {
        iterationCount: 30,
        wrapupSent: false,
      }) as GoalState | null,
    };
    const sent: string[] = [];
    const deps = makeDeps(
      store,
      clock,
      { success: true, messageId: 'w1' },
      {
        tryClaim: async () => ({ claimed: false, state: store.state }),
        sendPrompt: async (p: string) => {
          sent.push(p);
          return { success: true as const, messageId: 'w1' };
        },
      },
    );
    const got = await handleSessionIdle(
      { projectDir: '/tmp/hx3', lastMessageId: null },
      deps,
    );
    expect(got.reason).toBe('lease-held');
    expect(sent.length).toBe(0);
    // Flag stays false so the wrap can still be sent later.
    expect(store.state?.wrapupSent).toBe(false);
  });
  it('corrupt deadline does not tight-loop', async () => {
    _resetWatchdogsForTests();
    const clock = new FakeClock(1700000000000);
    let fired = 0;
    armWatchdog('/tmp/hx4', 's1', Number.NaN, clock, async () => {
      fired += 1;
    });
    // A NaN deadline falls back to the default window, so nothing fires now.
    expect(fired).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(fired).toBe(0);
    clearWatchdog('/tmp/hx4', 's1');
    expect(watchdogCount()).toBe(0);
  });
  it('rearm treats undefined pending as none', async () => {
    const { rearmFromState } = await import('../src/watchdog.js');
    _resetWatchdogsForTests();
    const clock = new FakeClock(1700000000000);
    const state = {
      ...makeActive(clock),
      pendingAttempt: undefined as never,
    };
    rearmFromState('/tmp/hx5', 's1', state, clock, async () => undefined);
    expect(watchdogCount()).toBe(0);
  });
  it('failed send persists the real session lane', async () => {
    _resetIdleInFlightForTests();
    _resetPerSessionCooldownForTests();
    const clock = new FakeClock(1700000000000);
    const store = {
      state: makeActive(clock, {
        lastTurnAtMs: 0,
        lastSessionId: '',
      }) as GoalState | null,
    };
    const deps = makeDeps(store, clock, {
      success: false,
      error: 'provider down',
      retryable: true,
    });
    await handleSessionIdle(
      { projectDir: '/tmp/hx6', lastMessageId: null, sessionId: 'sess-9' },
      deps,
    );
    // A restart can now rearm the exact lane from persisted state.
    expect(store.state?.lastSessionId).toBe('sess-9');
    expect(store.state?.pendingAttempt).not.toBeNull();
  });
  it('wrap settles the watchdog on success and failure', async () => {
    _resetIdleInFlightForTests();
    _resetPerSessionCooldownForTests();
    const clock = new FakeClock(1700000000000);
    const mk = (wrapOk: boolean) => {
      const store = {
        state: makeActive(clock, {
          iterationCount: 30,
          wrapupSent: false,
        }) as GoalState | null,
      };
      const settled: { ok: boolean; deadlineMs: number | null }[] = [];
      const deps = makeDeps(store, clock, null, {
        tryClaim: async () => ({ claimed: true, state: store.state }),
        sendPrompt: async () =>
          wrapOk
            ? { success: true as const, messageId: 'w1' }
            : { success: false as const, error: 'down', retryable: true },
        onTurnSettled: (r) => settled.push(r),
      });
      return { deps, settled, store };
    };
    const ok = mk(true);
    const a = await handleSessionIdle(
      { projectDir: '/tmp/hx7', lastMessageId: null },
      ok.deps,
    );
    expect(a.reason).toBe('max-turns');
    expect(ok.settled[0]?.ok).toBe(true);
    expect(ok.store.state?.wrapupSent).toBe(true);
    _resetIdleInFlightForTests();
    _resetPerSessionCooldownForTests();
    const bad = mk(false);
    const b = await handleSessionIdle(
      { projectDir: '/tmp/hx8', lastMessageId: null },
      bad.deps,
    );
    expect(b.reason).toBe('send-failed');
    expect(bad.settled[0]?.ok).toBe(false);
    expect(typeof bad.settled[0]?.deadlineMs).toBe('number');
    // Flag stays false so the wrap can still be retried.
    expect(bad.store.state?.wrapupSent).toBe(false);
  });
  it('buildPendingAttempt tolerates undefined pending', () => {
    const clock = new FakeClock(1700000000000);
    const state = {
      ...makeActive(clock),
      pendingAttempt: undefined as never,
    };
    expect(() =>
      buildPendingAttempt(state, 'provider-error', clock.nowMs()),
    ).not.toThrow();
    expect(
      buildPendingAttempt(state, 'provider-error', clock.nowMs()).attemptCount,
    ).toBe(1);
  });
});
