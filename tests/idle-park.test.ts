/**
 * Idle human-gate park tests.
 * Why these tests exist: the auto-continue loop used to keep spending turns
 * while the agent was correctly parked waiting for a human answer, so a single
 * unresolved gate could burn the entire turn budget restating the same status.
 * These tests pin the streak, the one-shot message, the `question` hint, and the
 * resume path that turns the loop back on.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IDLE_PARK_THRESHOLD,
  _resetIdleInFlightForTests,
  buildIdleParkPrompt,
  handleSessionIdle,
  observeToolCall,
  progressKey,
  scoreContinuationTurn,
  shouldContinue,
} from '../src/loop.js';
import type { IdleDeps, TurnObservation } from '../src/loop.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import { initialState } from '../src/state.js';
import type { Clock, GoalState } from '../src/state.js';
import { blockGoal, resumeGoal } from '../src/goal.js';

/** Fixed clock with mutable now so cooldowns can be travelled. */
class FakeClock implements Clock {
  constructor(public now: number) {}
  nowMs(): number {
    return this.now;
  }
}

const T0 = 1700000000000;

/** Active state stamped exactly as the loop saves it. */
function active(clock: FakeClock, over: Partial<GoalState> = {}): GoalState {
  const base = {
    ...initialState('ship the human gate', clock, '2.0.29'),
    ...over,
  };
  // The stamp must match the state, or the first tick reads a foreign mutation.
  return { ...base, lastTurnKey: progressKey(base) };
}

/** In-memory deps with a controllable store and captured prompts. */
function makeDeps(
  store: { state: GoalState | null },
  clock: FakeClock,
  sent: string[],
  extra: Partial<IdleDeps> = {},
): IdleDeps {
  return {
    clock,
    limits: DEFAULT_LIMITS,
    ownerId: 'owner-park',
    loadState: async () => store.state,
    saveState: async (_p, s) => {
      store.state = s;
    },
    tryClaim: async (_p, owner, ttl, c) => {
      const now = c.nowMs();
      if (store.state === null) return { claimed: false, state: null };
      const held =
        store.state.leaseOwner !== null &&
        store.state.leaseExpiresAtMs > now &&
        store.state.leaseOwner !== owner;
      if (held) return { claimed: false, state: store.state };
      store.state = {
        ...store.state,
        leaseOwner: owner,
        leaseExpiresAtMs: now + ttl,
      };
      return { claimed: true, state: store.state };
    },
    sendPrompt: async (prompt: string) => {
      sent.push(prompt);
      return { messageId: 'msg-' + String(sent.length), tokenSpend: 1 };
    },
    hasStopFile: async () => false,
    ...extra,
  };
}

/** One idle tick for the same lane, with an optional turn observation. */
function tick(
  deps: IdleDeps,
  lastTurn: TurnObservation | null,
  lastMessageId: string | null = null,
): Promise<{ decision: string; reason: string }> {
  return handleSessionIdle(
    {
      projectDir: '/tmp/idle-park',
      lastMessageId,
      sessionId: 'sess-park',
      lastTurn,
    },
    deps,
  );
}

beforeEach(() => {
  _resetIdleInFlightForTests();
});

describe('scoreContinuationTurn', () => {
  it('keeps the park threshold inside the designed 2-3 tick window', () => {
    // Acceptance: a parked goal stops within at most three ticks.
    expect(IDLE_PARK_THRESHOLD).toBeGreaterThanOrEqual(2);
    expect(IDLE_PARK_THRESHOLD).toBeLessThanOrEqual(3);
  });

  it('counts an empty turn and ignores a stale observation', () => {
    const clock = new FakeClock(T0);
    const state = active(clock, { lastContinuedMessageId: 'turn-1' });
    const empty = scoreContinuationTurn(state, {
      turnId: 'turn-1',
      usedTool: false,
      askedQuestion: false,
    });
    expect(empty.scored).toBe(true);
    expect(empty.productive).toBe(false);
    expect(empty.noProgressTurns).toBe(1);
    expect(empty.parkRequested).toBe(false);

    // A different turn id is not ours to judge: nothing is counted.
    const stale = scoreContinuationTurn(state, {
      turnId: 'turn-other',
      usedTool: false,
      askedQuestion: false,
    });
    expect(stale.scored).toBe(false);
    expect(stale.noProgressTurns).toBe(0);
  });

  it('parks on the threshold, and on a question even before it', () => {
    const clock = new FakeClock(T0);
    const atThreshold = active(clock, {
      lastContinuedMessageId: 'turn-2',
      noProgressTurns: IDLE_PARK_THRESHOLD - 1,
    });
    const tripped = scoreContinuationTurn(atThreshold, {
      turnId: 'turn-2',
      usedTool: false,
      askedQuestion: false,
    });
    expect(tripped.noProgressTurns).toBe(IDLE_PARK_THRESHOLD);
    expect(tripped.parkRequested).toBe(true);

    // A question parks on the very next tick, even after a productive turn.
    const fresh = active(clock, { lastContinuedMessageId: 'turn-q' });
    const asked = scoreContinuationTurn(fresh, {
      turnId: 'turn-q',
      usedTool: true,
      askedQuestion: true,
    });
    expect(asked.productive).toBe(true);
    expect(asked.questionAsked).toBe(true);
    expect(asked.parkRequested).toBe(true);
  });

  it('resets the streak on a tool call and on a foreign state change', () => {
    const clock = new FakeClock(T0);
    const stale = active(clock, {
      lastContinuedMessageId: 'turn-3',
      noProgressTurns: 1,
    });
    const withTool = scoreContinuationTurn(stale, {
      turnId: 'turn-3',
      usedTool: true,
      askedQuestion: false,
    });
    expect(withTool.productive).toBe(true);
    expect(withTool.noProgressTurns).toBe(0);

    // A mutation by another writer (a slash command, a tool) changes the stamp.
    const changed = { ...stale, lastSummary: 'evidence recorded elsewhere' };
    const mutated = scoreContinuationTurn(changed, {
      turnId: 'turn-3',
      usedTool: false,
      askedQuestion: false,
    });
    expect(mutated.productive).toBe(true);
    expect(mutated.noProgressTurns).toBe(0);
  });
});

describe('shouldContinue idle park', () => {
  it('stops a parked goal and lets a human message through', () => {
    const clock = new FakeClock(T0);
    const parked = active(clock, {
      lastTurnAtMs: 0,
      idleParked: true,
      lastContinuedMessageId: 'turn-9',
    });
    expect(
      shouldContinue(parked, clock.now, 'turn-9', DEFAULT_LIMITS).reason,
    ).toBe('idle-awaiting-input');
    // The answer path does not extend the park: the gate lets it through and
    // the pre-existing human-message rule decides that tick.
    const answered = shouldContinue(
      parked,
      clock.now,
      'human-1',
      DEFAULT_LIMITS,
      {
        humanSpoke: true,
      },
    );
    expect(answered.reason).toBe('human-message');
  });
});

describe('idle park end to end', () => {
  it('parks after two empty turns and posts exactly one message', async () => {
    const clock = new FakeClock(T0);
    const store = {
      state: active(clock, {
        lastTurnAtMs: 0,
        lastContinuedMessageId: 'seed-turn',
      }) as GoalState | null,
    };
    const sent: string[] = [];
    const deps = makeDeps(store, clock, sent);

    // Turn one ended empty: it is counted, but a continuation still goes out.
    const first = await tick(deps, {
      turnId: 'seed-turn',
      usedTool: false,
      askedQuestion: false,
    });
    expect(first.decision).toBe('sent');
    expect(store.state?.noProgressTurns).toBe(1);
    expect(store.state?.idleParked).toBe(false);

    // Turn two is empty too: the park replaces the continuation.
    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
    const second = await tick(deps, {
      turnId: 'msg-1',
      usedTool: false,
      askedQuestion: false,
    });
    expect(second.decision).toBe('stopped');
    expect(second.reason).toBe('idle-awaiting-input');
    expect(store.state?.idleParked).toBe(true);
    expect(sent.length).toBe(2);
    expect(sent[1]).toContain('idle awaiting input');
    expect(sent[1]).toContain('goal_block <reason>');

    // A third tick stays silent: the one message was already posted.
    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
    const third = await tick(deps, {
      turnId: 'msg-1',
      usedTool: false,
      askedQuestion: false,
    });
    expect(third.reason).toBe('idle-awaiting-input');
    expect(sent.length).toBe(2);
  });

  it('a productive turn resets the streak instead of parking', async () => {
    const clock = new FakeClock(T0);
    const store = {
      state: active(clock, {
        lastTurnAtMs: 0,
        lastContinuedMessageId: 'seed-turn',
      }) as GoalState | null,
    };
    const sent: string[] = [];
    const deps = makeDeps(store, clock, sent);

    await tick(deps, {
      turnId: 'seed-turn',
      usedTool: false,
      askedQuestion: false,
    });
    expect(store.state?.noProgressTurns).toBe(1);

    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
    const productive = await tick(deps, {
      turnId: 'msg-1',
      usedTool: true,
      askedQuestion: false,
    });
    expect(productive.decision).toBe('sent');
    expect(store.state?.noProgressTurns).toBe(0);

    // The next empty turn starts over at one: no park on the third tick.
    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
    const after = await tick(deps, {
      turnId: 'msg-2',
      usedTool: false,
      askedQuestion: false,
    });
    expect(after.decision).toBe('sent');
    expect(store.state?.idleParked).toBe(false);
    expect(sent.some((p) => p.includes('idle awaiting input'))).toBe(false);
  });

  it('the question tool parks the next tick', async () => {
    const clock = new FakeClock(T0);
    const store = {
      state: active(clock, {
        lastTurnAtMs: 0,
        lastContinuedMessageId: 'seed-turn',
      }) as GoalState | null,
    };
    const sent: string[] = [];
    const deps = makeDeps(store, clock, sent);

    const parked = await tick(deps, {
      turnId: 'seed-turn',
      usedTool: true,
      askedQuestion: true,
    });
    expect(parked.reason).toBe('idle-awaiting-input');
    expect(store.state?.idleParked).toBe(true);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('asked for a decision');
    expect(sent[0]).toContain('goal_block <reason>');
  });

  it('a human answer clears the latch and the loop can continue', async () => {
    const clock = new FakeClock(T0);
    const store = {
      state: active(clock, {
        lastTurnAtMs: 0,
        lastContinuedMessageId: 'turn-7',
        idleParked: true,
        noProgressTurns: IDLE_PARK_THRESHOLD,
        lastScoredTurnId: 'turn-7',
      }) as GoalState | null,
    };
    const sent: string[] = [];
    const deps = makeDeps(store, clock, sent);

    // The host reports a message newer than our continuation: someone answered.
    const answered = await tick(
      deps,
      { turnId: 'turn-7', usedTool: false, askedQuestion: false },
      'human-answer-1',
    );
    expect(answered.reason).toBe('human-message');
    expect(store.state?.idleParked).toBe(false);
    expect(sent.length).toBe(0);

    // Once the host reports our continuation again, the loop sends a new turn.
    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
    const resumed = await tick(
      deps,
      { turnId: 'turn-7', usedTool: false, askedQuestion: false },
      'turn-7',
    );
    expect(resumed.decision).toBe('sent');
    expect(sent.length).toBe(1);
  });

  it('never parks without an observation from the host', async () => {
    // Fail-safe: the wiring withholds the observation on a host that reports no
    // tool activity, and the loop must then keep working instead of guessing.
    const clock = new FakeClock(T0);
    const store = {
      state: active(clock, {
        lastTurnAtMs: 0,
        lastContinuedMessageId: 'turn-x',
        noProgressTurns: IDLE_PARK_THRESHOLD,
      }) as GoalState | null,
    };
    const sent: string[] = [];
    const deps = makeDeps(store, clock, sent);
    const got = await tick(deps, null);
    expect(got.decision).toBe('sent');
    expect(store.state?.idleParked).toBe(false);
    expect(sent.length).toBe(1);
  });

  it('goal_resume and goal_block both clear the latch', () => {
    const clock = new FakeClock(T0);
    const parked = active(clock, {
      idleParked: true,
      noProgressTurns: IDLE_PARK_THRESHOLD,
      lastScoredTurnId: 'turn-5',
    });
    const resumed = resumeGoal(parked, clock);
    expect(resumed.status).toBe('active');
    expect(resumed.idleParked).toBe(false);
    expect(resumed.noProgressTurns).toBe(0);
    expect(resumed.lastScoredTurnId).toBe('');

    const blocked = blockGoal(parked, 'waiting for the manager', clock);
    expect(blocked.status).toBe('blocked');
    expect(blocked.idleParked).toBe(false);
    expect(blocked.noProgressTurns).toBe(0);
  });
});

describe('observeToolCall', () => {
  it('marks a tool call and detects the question tool', () => {
    const base: TurnObservation = {
      turnId: 'turn-1',
      usedTool: false,
      askedQuestion: false,
    };
    const plain = observeToolCall(base, 'bash');
    expect(plain?.usedTool).toBe(true);
    expect(plain?.askedQuestion).toBe(false);

    const asked = observeToolCall(base, 'question');
    expect(asked?.usedTool).toBe(true);
    expect(asked?.askedQuestion).toBe(true);

    // No watched turn means nothing to attach the event to.
    expect(observeToolCall(null, 'bash')).toBeNull();
  });
});

describe('buildIdleParkPrompt', () => {
  it('names the objective and the explicit remedy', () => {
    const clock = new FakeClock(T0);
    const prompt = buildIdleParkPrompt(active(clock), 2);
    expect(prompt).toContain('ship the human gate');
    expect(prompt).toContain('2 consecutive turn(s)');
    expect(prompt).toContain('goal_block <reason>');
  });
});
