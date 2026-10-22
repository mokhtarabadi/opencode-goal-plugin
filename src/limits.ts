// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
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
  maxWallMs: 7200000,
};

/** Kill-switch filename inside the .opencode dir. Presence stops the loop. */
export const STOP_FILE_NAME = 'STOP_GOAL';

/**
 * Per-session last-tick map for fair cooldown.
 * Why this map exists: global minDelayMs alone throttles all sessions
 * together. Per-session entries keyed by composite projectDir plus sessionId
 * preserve responsiveness while global maxTurns plus maxWallMs still cap
 * total cost. Clock-driven only, no Date.now here. Test-only reset keeps
 * suites isolated.
 */
const perSessionLastTick = new Map<string, number>();

/**
 * Clear per-session cooldown state for tests only.
 */
export function _resetPerSessionCooldownForTests(): void {
  perSessionLastTick.clear();
}

/**
 * Check per-session cooldown without touching global budgets.
 * Returns ok false with reason cooldown when this session fired too recently.
 * @param sessionKey projectDir or session id isolating one lane
 * @param nowMs injected now in epoch ms
 * @param minDelayMs minimum gap from DEFAULT_LIMITS
 */
export function checkPerSessionCooldown(
  sessionKey: string,
  nowMs: number,
  minDelayMs: number,
): { ok: boolean; reason: string } {
  // Missing key means first turn: always pass so goals start promptly.
  const last = perSessionLastTick.get(sessionKey);
  if (last === undefined) return { ok: true, reason: 'ok' };
  // Fresh tick inside the window blocks only this session, not others.
  if (nowMs - last < minDelayMs) return { ok: false, reason: 'cooldown' };
  return { ok: true, reason: 'ok' };
}

/**
 * Record a successful per-session tick with injected time.
 * Evicts oldest when over 500 lanes to avoid unbounded growth.
 * @param sessionKey projectDir plus session id composite isolating one lane
 * @param nowMs injected now in epoch ms
 */
export function recordPerSessionTick(sessionKey: string, nowMs: number): void {
  // Cap at 500 lanes: oldest entry evicted first, keeps memory bounded.
  if (perSessionLastTick.size >= 500 && !perSessionLastTick.has(sessionKey)) {
    const oldest = perSessionLastTick.keys().next();
    if (!oldest.done) perSessionLastTick.delete(oldest.value);
  }
  // Overwrite keeps one entry per lane: bounded by session count.
  perSessionLastTick.set(sessionKey, nowMs);
}

/**
 * Check turn and wall budgets.
 * @param state current goal state
 * @param nowMs injected now in epoch ms
 * @param limits active limits
 */
export function checkBudget(
  state: GoalState,
  nowMs: number,
  limits: Limits,
): { ok: boolean; reason: string } {
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
