/**
 * Slash goal parsing and status transitions Phase 1.
 * Why this module exists: isolates user input handling from storage and host wiring.
 * All time comes from injected Clock, never from Date.now directly.
 */
import type { Clock, GoalState } from './state.js';
import { initialState } from './state.js';

/** Parsed slash goal command. */
export type ParsedGoal =
  | { kind: 'set'; objective: string }
  | { kind: 'status' }
  | { kind: 'clear' }
  | { kind: 'block'; reason: string }
  | { kind: 'complete' }
  | { kind: 'invalid'; raw: string };

export const MAX_OBJECTIVE_LEN = 2000;

/**
 * Parse raw slash input like /goal <text> or /goal status.
 * Boundary rule: /goal must stand alone (end or whitespace after), so
 * /goalie or /goals never parse as commands. Keywords match exactly or
 * not at all: extra words after status, clear, complete, or bare block
 * are invalid instead of silently becoming objectives.
 * @param rawInput full user input including /goal prefix
 */
export function parseGoalCommand(rawInput: string): ParsedGoal {
  // Non-string input from a misbehaving host is invalid, never a throw.
  if (typeof rawInput !== 'string') {
    return { kind: 'invalid', raw: String(rawInput) };
  }
  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();
  const prefix = '/goal';
  if (lower === prefix) {
    // Bare /goal with no body carries no instruction.
    return { kind: 'invalid', raw: rawInput };
  }
  if (!lower.startsWith(prefix)) {
    return { kind: 'invalid', raw: rawInput };
  }
  const after = trimmed.slice(prefix.length);
  if (after.length === 0) {
    return { kind: 'invalid', raw: rawInput };
  }
  if (!/^\s/.test(after)) {
    // /goalie, /goals, /goalx: prefix glued to other text is not our command.
    return { kind: 'invalid', raw: rawInput };
  }
  const body = after.trim();
  if (body.length === 0) {
    return { kind: 'invalid', raw: rawInput };
  }
  const bodyLower = body.toLowerCase();
  if (bodyLower === 'status') return { kind: 'status' };
  if (bodyLower.startsWith('status ') || bodyLower.startsWith('status\t') || bodyLower.startsWith('status\n')) {
    // status takes no arguments; extra words are likely a mistyped objective.
    return { kind: 'invalid', raw: rawInput };
  }
  if (bodyLower === 'clear') return { kind: 'clear' };
  if (bodyLower.startsWith('clear ') || bodyLower.startsWith('clear\t') || bodyLower.startsWith('clear\n')) {
    return { kind: 'invalid', raw: rawInput };
  }
  if (bodyLower === 'complete') return { kind: 'complete' };
  if (bodyLower.startsWith('complete ') || bodyLower.startsWith('complete\t') || bodyLower.startsWith('complete\n')) {
    return { kind: 'invalid', raw: rawInput };
  }
  if (bodyLower === 'block') {
    // Bare block names no reason, so the blocked state would be unactionable.
    return { kind: 'invalid', raw: rawInput };
  }
  if (bodyLower.startsWith('block ') || bodyLower.startsWith('block\t') || bodyLower.startsWith('block\n')) {
    const reason = body.slice(6).trim();
    if (reason.length === 0) return { kind: 'invalid', raw: rawInput };
    // Overlong reasons are rejected like overlong objectives.
    if (reason.length > MAX_OBJECTIVE_LEN) return { kind: 'invalid', raw: rawInput };
    return { kind: 'block', reason };
  }
  if (body.length > MAX_OBJECTIVE_LEN) {
    return { kind: 'invalid', raw: rawInput };
  }
  return { kind: 'set', objective: body };
}

/**
 * Set a new objective, resetting counters and clearing lease.
 * @param prev previous state or null for first run
 * @param objective new objective text
 * @param clock injected clock
 * @param hostVersion host version for audit
 */
export function setObjective(prev: GoalState | null, objective: string, clock: Clock, hostVersion: string): GoalState {
  // Fresh state keeps history simple for Phase 1, counters restart per objective.
  const fresh = initialState(objective, clock, hostVersion);
  if (prev !== null) {
    // Preserve creation time of first goal in this chain for wall-time budgets later.
    return { ...fresh, createdAtMs: prev.createdAtMs };
  }
  return fresh;
}

/**
 * Mark active goal as blocked with reason in lastSummary.
 * @param current current state must be active
 * @param reason block reason
 * @param clock injected clock
 */
export function blockGoal(current: GoalState, reason: string, clock: Clock): GoalState {
  if (current.status !== 'active') {
    throw new Error('only active goal can be blocked');
  }
  return {
    ...current,
    status: 'blocked',
    lastSummary: reason,
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs()
  };
}

/**
 * Mark active goal as complete.
 * @param current current state must be active
 * @param clock injected clock
 */
export function completeGoal(current: GoalState, clock: Clock): GoalState {
  if (current.status !== 'active') {
    throw new Error('only active goal can complete');
  }
  return {
    ...current,
    status: 'complete',
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs()
  };
}

/**
 * Mark any goal as cleared, requires explicit user action to resume via new set.
 * @param current current state
 * @param clock injected clock
 */
export function clearGoal(current: GoalState, clock: Clock): GoalState {
  return {
    ...current,
    status: 'cleared',
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs()
  };
}
