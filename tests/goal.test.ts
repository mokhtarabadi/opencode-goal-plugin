/**
 * Tests for slash goal parsing and transitions.
 * Why these tests exist: lock Phase 1 contract for set plus status plus block plus complete plus clear.
 */
import { describe, expect, it } from 'vitest';
import { blockGoal, clearGoal, completeGoal, parseGoalCommand, setObjective } from '../src/goal.js';
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
  });
  it('rejects empty and overlong', () => {
    expect(parseGoalCommand('/goal   ').kind).toBe('invalid');
    expect(parseGoalCommand('/goal ' + 'x'.repeat(2001))).toEqual(expect.objectContaining({ kind: 'invalid' }));
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
    expect(parseGoalCommand('/goal block ' + 'x'.repeat(2001)).kind).toBe('invalid');
  });
  it('rejects non-string input', () => {
    expect(parseGoalCommand(null as unknown as string).kind).toBe('invalid');
  });
});
