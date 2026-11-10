/**
 * Tests for slash goal parsing and transitions.
 * Why these tests exist: lock Phase 1 contract for set plus status plus block plus complete plus clear.
 */
import { describe, expect, it } from 'vitest';
import {
  blockGoal,
  clearGoal,
  completeGoal,
  parseGoalCommand,
  resumeGoal,
  setObjective,
} from '../src/goal.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import { shouldContinue } from '../src/loop.js';
import type { Clock } from '../src/state.js';

class FakeClock implements Clock {
  now = 1700000000000;
  nowMs(): number {
    return this.now;
  }
}

describe('parseGoalCommand', () => {
  it('parses set objective', () => {
    const got = parseGoalCommand('/goal ship login');
    expect(got).toEqual({ kind: 'set', objective: 'ship login' });
  });
  it('parses status and clear and complete', () => {
    expect(parseGoalCommand('/goal status')).toEqual({ kind: 'status' });
    expect(parseGoalCommand('/goal clear')).toEqual({ kind: 'clear' });
    expect(parseGoalCommand('/goal complete')).toEqual({ kind: 'complete' });
    expect(parseGoalCommand('/goal resume')).toEqual({ kind: 'resume' });
  });
  it('rejects empty and overlong', () => {
    expect(parseGoalCommand('/goal   ').kind).toBe('invalid');
    expect(parseGoalCommand('/goal ' + 'x'.repeat(2001))).toEqual(
      expect.objectContaining({ kind: 'invalid' }),
    );
  });
});

describe('transitions', () => {
  it('sets objective and resets lease', () => {
    const clock = new FakeClock();
    const next = setObjective(null, 'build api', clock, '2.0.29');
    expect(next.status).toBe('active');
    expect(next.leaseOwner).toBeNull();
  });
  it('blocks then clears', () => {
    const clock = new FakeClock();
    const active = setObjective(null, 'a', clock, '2.0.29');
    const blocked = blockGoal(active, 'waiting', clock);
    expect(blocked.status).toBe('blocked');
    const cleared = clearGoal(blocked, clock);
    expect(cleared.status).toBe('cleared');
  });
  it('completes only from active', () => {
    const clock = new FakeClock();
    const active = setObjective(null, 'a', clock, '2.0.29');
    expect(completeGoal(active, clock).status).toBe('complete');
  });
  it('completion clears the lease plus the park latch and keeps the last note', () => {
    // Pins the post-completion shape: every field a later read could mistake for
    // live work is cleared, while lastSummary stays as the audit note of the goal
    // that just finished. A new objective starts from a fresh state (next test).
    const clock = new FakeClock();
    const active = {
      ...setObjective(null, 'a', clock, '2.0.29'),
      leaseOwner: 'idle:x',
      leaseExpiresAtMs: clock.now + 60000,
      idleParked: true,
      noProgressTurns: 2,
      lastTurnKey: 'stamp',
      lastScoredTurnId: 'turn-1',
      lastSummary: 'checked the api',
    };
    const done = completeGoal(active, clock);
    expect(done.status).toBe('complete');
    expect(done.leaseOwner).toBeNull();
    expect(done.leaseExpiresAtMs).toBe(0);
    expect(done.idleParked).toBe(false);
    expect(done.noProgressTurns).toBe(0);
    expect(done.lastTurnKey).toBe('');
    expect(done.lastScoredTurnId).toBe('');
    // lastSummary belongs to this goal generation, never to an older one, so it
    // is not stale history from a previous objective: setObjective resets it.
    expect(done.lastSummary).toBe('checked the api');
  });
  it('a new objective starts a fresh wall clock', () => {
    // Regression: setObjective used to inherit createdAtMs from the previous
    // goal in the session. checkBudget measures wall time from createdAtMs, so a
    // goal set more than maxWallMs after the first goal in a long session was
    // over budget on arrival: the loop sent one wrap-up and never continued.
    const clock = new FakeClock();
    const first = setObjective(null, 'old goal', clock, '2.0.29');
    clock.now += DEFAULT_LIMITS.maxWallMs + 1;
    const next = setObjective(first, 'new goal', clock, '2.0.29');
    expect(next.createdAtMs).toBe(clock.now);
    expect(shouldContinue(next, clock.now, null, DEFAULT_LIMITS).reason).toBe(
      'ok',
    );
  });
  it('a resumed goal keeps its own creation time', () => {
    // Resume continues the same goal generation, so the wall budget must not be
    // reset by it; only a new objective is a new generation.
    const clock = new FakeClock();
    const parked = {
      ...setObjective(null, 'a', clock, '2.0.29'),
      idleParked: true,
    };
    clock.now += 5000;
    const resumed = resumeGoal(parked, clock);
    expect(resumed.createdAtMs).toBe(parked.createdAtMs);
  });
});

describe('parseGoalCommand edges', () => {
  it('rejects goalie and goals prefix plus bare goal', () => {
    // Prefix glued to other text is not our command (QA F1).
    expect(parseGoalCommand('/goalie test').kind).toBe('invalid');
    expect(parseGoalCommand('/goals test').kind).toBe('invalid');
    expect(parseGoalCommand('/goal').kind).toBe('invalid');
  });
  it('rejects bare block and keyword extras', () => {
    // Bare block names no reason; extras after exact keywords are mistypes (QA F2 F3).
    expect(parseGoalCommand('/goal block').kind).toBe('invalid');
    expect(parseGoalCommand('/goal status extra').kind).toBe('invalid');
    expect(parseGoalCommand('/goal clear extra').kind).toBe('invalid');
    expect(parseGoalCommand('/goal complete extra').kind).toBe('invalid');
  });
  it('rejects overlong block reason', () => {
    expect(parseGoalCommand('/goal block ' + 'x'.repeat(2001)).kind).toBe(
      'invalid',
    );
  });
  it('rejects non-string input', () => {
    expect(parseGoalCommand(null as unknown as string).kind).toBe('invalid');
  });
});
