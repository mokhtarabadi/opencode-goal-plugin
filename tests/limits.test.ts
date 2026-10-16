/**
 * Limits tests Phase 2.
 * Why these tests exist: lock budget stops for the idle loop.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, checkBudget } from '../src/limits.js';
import { initialState } from '../src/state.js';
import type { Clock } from '../src/state.js';

/** Fixed clock for budget math. */
class FakeClock implements Clock {
  nowMs(): number {
    return 1700000000000;
  }
}

describe('checkBudget', () => {
  it('ok within budgets', () => {
    const c = new FakeClock();
    const s = initialState('a', c, '2.0.29');
    expect(checkBudget(s, c.nowMs(), DEFAULT_LIMITS).ok).toBe(true);
  });
  it('max turns stops', () => {
    const c = new FakeClock();
    const s = { ...initialState('a', c, '2.0.29'), iterationCount: 30 };
    expect(checkBudget(s, c.nowMs(), DEFAULT_LIMITS).reason).toBe('max-turns');
  });
  it('wall time stops', () => {
    const c = new FakeClock();
    const s = {
      ...initialState('a', c, '2.0.29'),
      createdAtMs: c.nowMs() - 7200000 - 1,
    };
    expect(checkBudget(s, c.nowMs(), DEFAULT_LIMITS).reason).toBe('wall-time');
  });
});
