/**
 * Idle auto-continue loop Phase 2.
 * Why this module exists: decides exactly one safe continuation per idle tick.
 * In-memory flag stops same-process reentry, file lease stops cross-process duplicates.
 */
import { LEASE_TTL_MS, resolveStatePath } from './state.js';
import type { Clock, GoalState } from './state.js';
import { checkBudget } from './limits.js';
import type { Limits } from './limits.js';

/** In-process reentry guard for parallel idle ticks. */
let idleInFlight = false;

/**
 * Read guard for diagnostics.
 */
export function isIdleInFlight(): boolean {
  return idleInFlight;
}

/**
 * Reset guard for tests only.
 */
export function _resetIdleInFlightForTests(): void {
  idleInFlight = false;
}

/** Idle tick context supplied by the host wiring. */
export interface IdleContext {
  /** Project root containing the .opencode dir. */
  projectDir: string;
  /** Last observed session message id, null when unknown. */
  lastMessageId: string | null;
}

/** Injected collaborators so tests never touch disk or model. */
export interface IdleDeps {
  clock: Clock;
  limits: Limits;
  ownerId: string;
  loadState: (p: string) => Promise<GoalState | null>;
  saveState: (p: string, s: GoalState) => Promise<void>;
  tryClaim: (
    p: string,
    owner: string,
    ttl: number,
    c: Clock,
  ) => Promise<{ claimed: boolean; state: GoalState | null }>;
  sendPrompt: (
    prompt: string,
  ) => Promise<{ messageId: string; tokenSpend?: number }>;
  hasStopFile: () => Promise<boolean>;
}

/** Idle tick outcome. */
export interface IdleDecision {
  decision: 'sent' | 'skipped' | 'stopped';
  reason: string;
  messageId?: string;
}

/**
 * Coerce token spend to a safe number: non-numeric input counts as zero
 * so a bad host result cannot poison the budget sum.
 * @param v unknown spend value
 */
function safeSpend(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Pure gate for auto-continue.
 * @param state current state or null when no goal file exists
 * @param nowMs injected now in epoch ms
 * @param lastMessageId last observed session message id
 * @param limits active limits
 * @param opts stopRequested is true when STOP_GOAL exists
 */
export function shouldContinue(
  state: GoalState | null,
  nowMs: number,
  lastMessageId: string | null,
  limits: Limits,
  opts?: { stopRequested?: boolean },
): { ok: boolean; reason: string } {
  if (state === null) return { ok: false, reason: 'no-state' };
  if (state.status !== 'active')
    return { ok: false, reason: 'stopped-' + state.status };
  // Verification in flight pauses auto turns without stopping the goal.
  if (state.pendingVerification === true)
    return { ok: false, reason: 'verification-pending' };
  if (opts?.stopRequested === true) return { ok: false, reason: 'stop-file' };
  // A message id that moved past our last continuation means the human spoke: yield.
  if (
    state.lastContinuedMessageId !== '' &&
    lastMessageId !== null &&
    lastMessageId !== state.lastContinuedMessageId
  ) {
    return { ok: false, reason: 'human-message' };
  }
  const budget = checkBudget(state, nowMs, limits);
  if (!budget.ok) return budget;
  // First turn (lastTurnAtMs 0) always bypasses cooldown so goals start promptly.
  if (
    state.lastTurnAtMs !== 0 &&
    nowMs - state.lastTurnAtMs < limits.minDelayMs
  ) {
    return { ok: false, reason: 'cooldown' };
  }
  return { ok: true, reason: 'ok' };
}

/**
 * Build one continuation prompt restating objective plus turn plus stop verbs.
 * @param state active goal state
 */
export function buildContinuationPrompt(state: GoalState): string {
  const summary = state.lastSummary !== '' ? state.lastSummary : 'none yet';
  return (
    'Continue goal: "' +
    state.objective +
    '"\n' +
    'Status: ' +
    state.status +
    ' | Turn: ' +
    String(state.iterationCount + 1) +
    ' | Last: ' +
    summary +
    '\n' +
    'Take exactly one concrete next step toward the objective.\n' +
    'If done call /goal complete. If stuck call /goal block <reason>. To cancel call /goal clear.\n' +
    'Do not repeat questions. Keep output concise.'
  );
}

/**
 * Apply a finished turn to state.
 * @param state current state
 * @param result message id plus optional spend plus elapsed plus summary
 * @param clock injected clock
 */
export function recordTurnResult(
  state: GoalState,
  result: {
    messageId: string;
    tokenSpend?: number;
    elapsedMs?: number;
    summary?: string;
  },
  clock: Clock,
): GoalState {
  const now = clock.nowMs();
  return {
    ...state,
    iterationCount: state.iterationCount + 1,
    lastTurnAtMs: now,
    lastContinuedMessageId: result.messageId,
    tokenSpend: state.tokenSpend + safeSpend(result.tokenSpend),
    wallTimeMs: state.wallTimeMs + (result.elapsedMs ?? 0),
    lastSummary: result.summary ?? state.lastSummary,
    updatedAtMs: now,
  };
}

/**
 * Handle one session idle tick: load plus gate plus claim plus send plus save.
 * Lock release is best-effort: the file lease TTL reclaims crashed turns.
 * @param ctx project dir plus last message id
 * @param deps injected clock plus storage plus sender
 */
export async function handleSessionIdle(
  ctx: IdleContext,
  deps: IdleDeps,
): Promise<IdleDecision> {
  // Same-process reentry exits first so parallel ticks send exactly once.
  if (idleInFlight) {
    return { decision: 'skipped', reason: 'idle-inflight' };
  }
  // Null guards: a host with an empty payload gets a reason, never a TypeError.
  if (ctx === null || typeof ctx !== 'object') {
    return { decision: 'stopped', reason: 'invalid-context' };
  }
  if (deps === null || typeof deps !== 'object') {
    return { decision: 'stopped', reason: 'invalid-deps' };
  }
  if (
    typeof ctx.projectDir !== 'string' ||
    ctx.projectDir.trim().length === 0
  ) {
    return { decision: 'stopped', reason: 'invalid-project-dir' };
  }
  if (
    typeof deps.loadState !== 'function' ||
    typeof deps.saveState !== 'function'
  ) {
    return { decision: 'stopped', reason: 'invalid-deps' };
  }
  if (
    typeof deps.tryClaim !== 'function' ||
    typeof deps.sendPrompt !== 'function'
  ) {
    return { decision: 'stopped', reason: 'invalid-deps' };
  }
  if (typeof deps.hasStopFile !== 'function') {
    return { decision: 'stopped', reason: 'invalid-deps' };
  }
  // Clock check: a missing clock would throw TypeError on nowMs.
  if (
    deps.clock === null ||
    typeof deps.clock !== 'object' ||
    typeof deps.clock.nowMs !== 'function'
  ) {
    return { decision: 'stopped', reason: 'invalid-deps' };
  }
  if (deps.limits === null || typeof deps.limits !== 'object') {
    return { decision: 'stopped', reason: 'invalid-limits' };
  }
  // Shape check: missing numeric fields would silently bypass budgets.
  if (
    typeof deps.limits.minDelayMs !== 'number' ||
    typeof deps.limits.maxTurns !== 'number' ||
    typeof deps.limits.maxWallMs !== 'number'
  ) {
    return { decision: 'stopped', reason: 'invalid-limits' };
  }
  if (typeof deps.ownerId !== 'string' || deps.ownerId.length === 0) {
    return { decision: 'stopped', reason: 'invalid-owner' };
  }
  idleInFlight = true;
  try {
    const statePath = resolveStatePath(ctx.projectDir);
    let current: GoalState | null;
    try {
      current = await deps.loadState(statePath);
    } catch {
      return { decision: 'stopped', reason: 'corrupt-state' };
    }
    const now = deps.clock.nowMs();
    let stopRequested = false;
    try {
      stopRequested = await deps.hasStopFile();
    } catch {
      // Fail closed: a filesystem error must not silently ignore STOP_GOAL.
      return { decision: 'stopped', reason: 'stop-check-failed' };
    }
    const gate = shouldContinue(
      current,
      now,
      ctx.lastMessageId ?? null,
      deps.limits,
      { stopRequested },
    );
    if (!gate.ok) {
      // No-goal and finished goals stop the loop; cooldown and contention only skip one tick.
      const terminal =
        gate.reason === 'no-state' ||
        gate.reason.startsWith('stopped-') ||
        gate.reason === 'max-turns' ||
        gate.reason === 'wall-time' ||
        gate.reason === 'stop-file';
      return {
        decision: terminal ? 'stopped' : 'skipped',
        reason: gate.reason,
      };
    }
    let claimed: { claimed: boolean; state: GoalState | null };
    try {
      claimed = await deps.tryClaim(
        statePath,
        deps.ownerId,
        LEASE_TTL_MS,
        deps.clock,
      );
    } catch {
      // Lock I/O failure stops this tick instead of escaping to the host.
      return { decision: 'stopped', reason: 'claim-failed' };
    }
    if (!claimed.claimed || claimed.state === null) {
      return { decision: 'skipped', reason: 'lease-held' };
    }
    const prompt = buildContinuationPrompt(claimed.state);
    let sent: { messageId: string; tokenSpend?: number };
    try {
      sent = await deps.sendPrompt(prompt);
    } catch {
      // Send failure clears our lease so the next tick can retry, then stops this tick.
      try {
        await deps.saveState(statePath, {
          ...claimed.state,
          leaseOwner: null,
          leaseExpiresAtMs: 0,
          updatedAtMs: deps.clock.nowMs(),
        });
      } catch {
        // Cleanup failure keeps the original send failure as the reported reason.
      }
      return { decision: 'stopped', reason: 'send-failed' };
    }
    // Validate the send result: an empty id would poison human-message yield next tick.
    if (
      typeof sent !== 'object' ||
      sent === null ||
      typeof sent.messageId !== 'string' ||
      sent.messageId.length === 0
    ) {
      try {
        await deps.saveState(statePath, {
          ...claimed.state,
          leaseOwner: null,
          leaseExpiresAtMs: 0,
          updatedAtMs: deps.clock.nowMs(),
        });
      } catch {
        // Same cleanup path as a thrown send failure.
      }
      return { decision: 'stopped', reason: 'send-failed' };
    }
    // Post-send timestamp: slow sends must not shorten the real cooldown.
    const afterSend = deps.clock.nowMs();
    const next: GoalState = {
      ...claimed.state,
      iterationCount: claimed.state.iterationCount + 1,
      lastTurnAtMs: afterSend,
      lastContinuedMessageId: sent.messageId,
      tokenSpend: claimed.state.tokenSpend + safeSpend(sent.tokenSpend),
      updatedAtMs: afterSend,
      leaseOwner: null,
      leaseExpiresAtMs: 0,
    };
    try {
      await deps.saveState(statePath, next);
    } catch {
      return { decision: 'stopped', reason: 'save-failed' };
    }
    return { decision: 'sent', reason: 'ok', messageId: sent.messageId };
  } finally {
    idleInFlight = false;
  }
}
