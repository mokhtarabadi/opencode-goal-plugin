/**
 * Budget limits Phase 2.
 * Why this module exists: bounds auto-continue so the idle loop cannot run forever.
 * All values are plain numbers, no wall-time reads here.
 */
import type { GoalState } from './state.js';

/** Tunable budget for one goal. */
export interface Limits {
  /** Minimum ms between auto turns, stops tight idle loops. */
  minDelayMs: number;
  /** Maximum auto turns per goal, then the loop stops. */
  maxTurns: number;
  /** Maximum wall ms per goal measured from createdAtMs. */
  maxWallMs: number;
}

/** Defaults from the approved Phase 2 plan. */
export const DEFAULT_LIMITS: Limits = {
  minDelayMs: 20000,
  maxTurns: 30,
  maxWallMs: 7200000
};

/** Kill-switch filename inside the .opencode dir. Presence stops the loop. */
export const STOP_FILE_NAME = 'STOP_GOAL';

/**
 * Check turn and wall budgets.
 * @param state current goal state
 * @param nowMs injected now in epoch ms
 * @param limits active limits
 */
export function checkBudget(state: GoalState, nowMs: number, limits: Limits): { ok: boolean; reason: string } {
  // Turn budget binds first: each sent continuation costs one turn.
  if (state.iterationCount >= limits.maxTurns) {
    return { ok: false, reason: 'max-turns' };
  }
  // Wall budget binds long sessions even when turns stay few.
  if (nowMs - state.createdAtMs >= limits.maxWallMs) {
    return { ok: false, reason: 'wall-time' };
  }
  return { ok: true, reason: 'ok' };
}
