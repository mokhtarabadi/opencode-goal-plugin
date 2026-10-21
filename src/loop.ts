/**
 * Idle auto-continue loop Phase 2.
 * Why this module exists: decides exactly one safe continuation per idle tick.
 * In-memory flag stops same-process reentry, file lease stops cross-process duplicates.
 */
import { LEASE_TTL_MS, resolveStatePath } from './state.js';
import type { Clock, GoalState } from './state.js';
import {
  checkBudget,
  checkPerSessionCooldown,
  recordPerSessionTick,
  _resetPerSessionCooldownForTests,
} from './limits.js';
import type { Limits } from './limits.js';

/** In-process reentry guard for parallel idle ticks. */
let idleInFlight = false;

/**
 * Per-project token guard so distinct sessions do not block each other
 * while the same project still sends exactly once per tick.
 * Why this map exists: global boolean alone serializes all sessions;
 * token map keyed by projectDir gives per-session fairness while the
 * global flag preserves the legacy single-flight proof. Token values
 * prevent a stale finally from clearing a successor's guard.
 */
const activeContinueTokens = new Map<string, string>();

/** Module token counter for unique per-tick owners without Clock. */
let continueTokenCounter = 0;

/**
 * Read guard for diagnostics.
 * Returns true when any guard is held: legacy flag or token map.
 */
export function isIdleInFlight(): boolean {
  // Either guard held means a turn is in flight somewhere.
  return idleInFlight || activeContinueTokens.size > 0;
}

/**
 * Reset guard for tests only.
 * Clears both legacy flag and per-project tokens plus per-session cooldown.
 */
export function _resetIdleInFlightForTests(): void {
  idleInFlight = false;
  activeContinueTokens.clear();
  try {
    _resetPerSessionCooldownForTests();
  } catch {
    // Reset is best-effort in mixed-version test bundles.
  }
}

/** Idle tick context supplied by the host wiring. */
export interface IdleContext {
  /** Project root containing the .opencode dir. */
  projectDir: string;
  /** Last observed session message id, null when unknown. */
  lastMessageId: string | null;
  /**
   * Session id threading per-session fairness.
   * Why optional exists: older callers pass projectDir only. When present,
   * token plus cooldown keys become projectDir plus sessionId so distinct
   * sessions in one project proceed independently.
   */
  sessionId?: string | null;
}

/** Discriminated result of one send attempt. */
export type SendResult =
  | { success: true; messageId: string; tokenSpend?: number }
  | { success: false; error: string; retryable: boolean };

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
  /**
   * Send one continuation prompt.
   * Return shape is tolerant: an object with success true carries messageId,
   * success false carries error plus retryable. A legacy plain
   * { messageId } return is treated as success when the id is non-empty.
   */
  sendPrompt: (
    prompt: string,
  ) => Promise<SendResult | { messageId: string; tokenSpend?: number }>;
  hasStopFile: () => Promise<boolean>;
  /**
   * Optional hook fired after a turn ends, success or failure.
   * Why this exists: the host clears the watchdog on success and re-arms it on
   * a failure without the pure loop depending on timer state.
   */
  onTurnSettled?: (result: { ok: boolean; deadlineMs: number | null }) => void;
}

/**
 * Normalize a raw send result into a discriminated SendResult.
 * Why this helper exists: older tests and hosts return a plain
 * { messageId } object. A missing or empty id means failure, never a
 * synthesized turn label, so a failed send stays retryable.
 * @param raw unknown result from the host sender
 */
export function normalizeSendResult(raw: unknown): SendResult {
  if (raw !== null && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if ('success' in r) {
      if (
        r['success'] === true &&
        typeof r['messageId'] === 'string' &&
        r['messageId'].length > 0
      ) {
        return {
          success: true,
          messageId: r['messageId'],
          tokenSpend: typeof r['tokenSpend'] === 'number' ? r['tokenSpend'] : 0,
        };
      }
      return {
        success: false,
        error: typeof r['error'] === 'string' ? r['error'] : 'send-failed',
        retryable: r['retryable'] !== false,
      };
    }
    // Legacy shape: non-empty messageId counts as success.
    if (typeof r['messageId'] === 'string' && r['messageId'].length > 0) {
      return {
        success: true,
        messageId: r['messageId'],
        tokenSpend: typeof r['tokenSpend'] === 'number' ? r['tokenSpend'] : 0,
      };
    }
  }
  // Anything else is a retryable failure, never a fake success.
  return { success: false, error: 'send-failed', retryable: true };
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
 * Default watchdog deadline: wake before the 120s lease TTL expires.
 * Why 90s exists: a wake sooner than the lease grants a clean claim while a
 * wake later than TTL would let another process reclaim first.
 */
export const DEFAULT_MAX_TURN_MS = 90000;

/**
 * Build or extend a pending continuation attempt after a failed turn.
 * Why this helper exists: retry state must be explicit and persisted so the
 * watchdog and a restart can resume. Timestamps come from the injected clock.
 * @param state current goal state carrying any prior attempt
 * @param reason failure classification (provider-error or user-abort)
 * @param nowMs injected now in epoch ms
 */
export function buildPendingAttempt(
  state: GoalState,
  reason: string,
  nowMs: number,
): import('./state.js').PendingAttempt {
  // Continue an existing episode when present, else start a fresh one.
  // Loose null check covers an undefined value from a raw disk read.
  const prev = state.pendingAttempt;
  const hasPrev = prev !== null && prev !== undefined;
  return {
    firstAttemptMs: hasPrev ? prev.firstAttemptMs : nowMs,
    lastAttemptMs: nowMs,
    attemptCount: hasPrev ? prev.attemptCount + 1 : 1,
    deadlineMs: nowMs + DEFAULT_MAX_TURN_MS,
    reason,
  };
}

/** Failure classification for crash-versus-abort decisions. */
export type FailureKind = 'user-abort' | 'provider-error'; /**
 * Classify a failure payload as a user abort or a retryable provider error.
 * Why this helper exists: an explicit user abort must park the goal and
 * require a manual resume, while a transient provider error should retry.
 * Precedence: an exact MessageAbortedError name or an explicit abort phrase
 * wins; otherwise the event type hint decides (interrupted means the user
 * stopped, failed means a provider error); otherwise provider-error.
 * Pure and total so callers never throw on a weird error shape.
 * @param err unknown error name or payload
 * @param evType optional host event type hint
 */
export function classifyFailure(err: unknown, evType?: string): FailureKind {
  // Build one lowercase match string from the common error shapes.
  let name = '';
  let message = '';
  if (typeof err === 'string') {
    message = err;
  } else if (err !== null && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown; type?: unknown };
    if (typeof e.name === 'string') name = e.name;
    if (typeof e.message === 'string') message = e.message;
    // Some hosts put the error name on `type`.
    if (name === '' && typeof e.type === 'string') name = e.type;
  }
  const low = (name + ' ' + message).toLowerCase();
  // Exact abort names win without needing an event hint.
  if (low.includes('messageabortederror')) return 'user-abort';
  // An explicit user stop phrase must not be overridden by an event hint.
  if (low.includes('user abort') || low.includes('aborted by user')) {
    return 'user-abort';
  }
  // A bare "aborted" alone is ambiguous: a transport can abort too, so it only
  // counts as an abort when the event hint also says interrupted.
  if (evType === 'session.execution.interrupted') return 'user-abort';
  if (
    low.includes('aborted') ||
    low.includes('canceled') ||
    low.includes('cancelled')
  ) {
    // Without an interrupted hint, treat a bare abort word as a provider error.
    return 'provider-error';
  }
  // Everything else (timeout, network, 5xx, transport, provider) is retryable.
  return 'provider-error';
}

/**
 * Handle one session failure event: classify and either park or mark retry.
 * Why this function exists: a failed or interrupted turn must not stall an
 * active goal silently. A user abort parks the goal and requires a manual
 * resume; a provider error records a retry attempt for the watchdog.
 * @param ctx project dir plus session id
 * @param deps injected clock plus storage
 * @param err the failure payload from the host event
 */
export async function handleSessionFailure(
  ctx: { projectDir: string; sessionId?: string | null },
  deps: {
    clock: Clock;
    loadState: (p: string) => Promise<GoalState | null>;
    saveState: (p: string, s: GoalState) => Promise<void>;
    /** Lease claim so a failure write never races an idle tick. */
    tryClaim?: (
      p: string,
      owner: string,
      ttl: number,
      c: Clock,
    ) => Promise<{ claimed: boolean; state: GoalState | null }>;
    ownerId?: string;
  },
  err: unknown,
  evType?: string,
): Promise<IdleDecision> {
  // Null guards: a host with an empty payload gets a reason, never a throw.
  if (ctx === null || typeof ctx !== 'object') {
    return { decision: 'stopped', reason: 'invalid-context' };
  }
  if (
    typeof ctx.projectDir !== 'string' ||
    ctx.projectDir.trim().length === 0
  ) {
    return { decision: 'stopped', reason: 'invalid-project-dir' };
  }
  if (
    deps === null ||
    typeof deps !== 'object' ||
    typeof deps.loadState !== 'function' ||
    typeof deps.saveState !== 'function'
  ) {
    return { decision: 'stopped', reason: 'invalid-deps' };
  }
  if (
    deps.clock === null ||
    typeof deps.clock !== 'object' ||
    typeof deps.clock.nowMs !== 'function'
  ) {
    return { decision: 'stopped', reason: 'invalid-deps' };
  }
  const storage =
    typeof ctx.sessionId === 'string' && ctx.sessionId.trim().length > 0
      ? ctx.sessionId.trim()
      : undefined;
  const statePath = resolveStatePath(ctx.projectDir, storage);
  const legacyPath = resolveStatePath(ctx.projectDir);
  let current: GoalState | null;
  try {
    current = await deps.loadState(statePath);
    // Scoped missing plus legacy present: migrate old users exactly once.
    if (current === null && statePath !== legacyPath) {
      try {
        current = await deps.loadState(legacyPath);
      } catch {
        current = null;
      }
    }
  } catch {
    return { decision: 'stopped', reason: 'corrupt-state' };
  }
  // No goal or a finished goal: nothing to recover, exit quietly.
  if (current === null) return { decision: 'skipped', reason: 'no-state' };
  if (current.status !== 'active') {
    return { decision: 'skipped', reason: 'stopped-' + current.status };
  }
  // Claim the lease before any failure write so it cannot race an idle tick.
  // Why required: a blind read-modify-write could clear a held lease or lose
  // a failureCount increment. Without a claimer the caller opted out of it.
  if (typeof deps.tryClaim === 'function') {
    let claimed = false;
    try {
      const res = await deps.tryClaim(
        statePath,
        deps.ownerId ?? 'failure',
        LEASE_TTL_MS,
        deps.clock,
      );
      claimed = res.claimed;
      if (res.state !== null) current = res.state;
    } catch {
      return { decision: 'stopped', reason: 'claim-failed' };
    }
    if (!claimed) return { decision: 'skipped', reason: 'lease-held' };
  }
  const now = deps.clock.nowMs();
  const kind = classifyFailure(err, evType);
  const sessionId =
    typeof ctx.sessionId === 'string' && ctx.sessionId.length > 0
      ? ctx.sessionId
      : current.lastSessionId;
  if (kind === 'user-abort') {
    // Park the goal: an explicit abort must never be auto-resumed.
    try {
      await deps.saveState(statePath, {
        ...current,
        status: 'interrupted',
        pendingAttempt: null,
        recoveryEpoch: current.recoveryEpoch + 1,
        lastSessionId: sessionId,
        leaseOwner: null,
        leaseExpiresAtMs: 0,
        updatedAtMs: now,
      });
    } catch {
      return { decision: 'stopped', reason: 'save-failed' };
    }
    return { decision: 'stopped', reason: 'user-abort-parked' };
  }
  // Provider error: record a retry attempt and let the watchdog wake the loop.
  try {
    await deps.saveState(statePath, {
      ...current,
      pendingAttempt: buildPendingAttempt(current, 'provider-error', now),
      failureCount: current.failureCount + 1,
      recoveryEpoch: current.recoveryEpoch + 1,
      lastSessionId: sessionId,
      leaseOwner: null,
      leaseExpiresAtMs: 0,
      updatedAtMs: now,
    });
  } catch {
    return { decision: 'stopped', reason: 'save-failed' };
  }
  return { decision: 'skipped', reason: 'provider-error-retry' };
}

/**
 * Settle a failed send: park on a user abort, else record a retry attempt.
 * Why this helper exists: both the thrown and the non-retryable paths share
 * one recovery policy, so the classification cannot drift between them.
 * @param statePath absolute goal state path
 * @param state the state at claim time
 * @param deps injected deps (clock, saveState, onTurnSettled)
 * @param kind failure classification
 */
async function settleFailedSend(
  statePath: string,
  state: GoalState,
  deps: IdleDeps,
  kind: FailureKind,
  sessionId: string,
): Promise<IdleDecision> {
  const now = deps.clock.nowMs();
  if (kind === 'user-abort') {
    // Park: an explicit abort must never be auto-retried.
    try {
      await deps.saveState(statePath, {
        ...state,
        status: 'interrupted',
        pendingAttempt: null,
        recoveryEpoch: state.recoveryEpoch + 1,
        lastSessionId: sessionId,
        leaseOwner: null,
        leaseExpiresAtMs: 0,
        updatedAtMs: now,
      });
    } catch {
      return { decision: 'stopped', reason: 'save-failed' };
    }
    try {
      deps.onTurnSettled?.({ ok: true, deadlineMs: null });
    } catch {
      // Settle hook is best-effort.
    }
    return { decision: 'stopped', reason: 'user-abort-parked' };
  }
  const pending = buildPendingAttempt(state, 'provider-error', now);
  try {
    await deps.saveState(statePath, {
      ...state,
      pendingAttempt: pending,
      failureCount: state.failureCount + 1,
      // Persist the real lane so a restart can rearm the watchdog.
      lastSessionId: sessionId,
      leaseOwner: null,
      leaseExpiresAtMs: 0,
      updatedAtMs: now,
    });
  } catch {
    // Cleanup failure keeps the send failure as the reported reason.
  }
  try {
    deps.onTurnSettled?.({ ok: false, deadlineMs: pending.deadlineMs });
  } catch {
    // Settle hook is best-effort.
  }
  return { decision: 'stopped', reason: 'send-failed' };
}

/**
 * Build the one-time wrap-up prompt sent when a budget is exhausted.
 * Why this exists: the loop must tell the agent to stop cleanly instead of
 * dying silently. Sent at most once, then the persisted flag blocks re-entry.
 * @param state active goal state
 * @param reason the budget reason that tripped (max-turns or wall-time)
 */
export function buildWrapupPrompt(state: GoalState, reason: string): string {
  return (
    'Goal budget reached (' +
    reason +
    ') for "' +
    state.objective +
    '".\n' +
    'Stop starting new work. Summarize what is done with evidence and finish now.\n' +
    'If the objective is met call /goal complete. Otherwise call /goal block <reason>.'
  );
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
  // A sent wrap-up is terminal: never send a second one after the budget hit.
  if (state.wrapupSent === true) return { ok: false, reason: 'wrapped-up' };
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
  // Token-guarded single-flight: per-session token plus legacy global flag.
  // Why composite key exists: projectDir alone serializes all sessions in one
  // project. Appending sessionId gives per-session fairness while global caps
  // plus file lease still bound total cost. Missing sessionId falls back to
  // projectDir alone for backwards compatibility with older callers.
  const sessionPart =
    typeof ctx.sessionId === 'string' && ctx.sessionId.length > 0
      ? ctx.sessionId
      : 'default';
  const tokenKey = ctx.projectDir + ':' + sessionPart;
  // Bound token map: evict oldest when over 500 lanes to avoid unbounded growth.
  if (activeContinueTokens.size > 500) {
    const oldest = activeContinueTokens.keys().next();
    if (!oldest.done) activeContinueTokens.delete(oldest.value);
  }
  if (activeContinueTokens.has(tokenKey)) {
    return { decision: 'skipped', reason: 'idle-inflight' };
  }
  continueTokenCounter += 1;
  const myToken = deps.ownerId + ':' + String(continueTokenCounter);
  activeContinueTokens.set(tokenKey, myToken);
  idleInFlight = true;
  try {
    // Scoped storage: an idle tick in B loads only B's file, never A's.
    const idleStorage =
      typeof ctx.sessionId === 'string' && ctx.sessionId.trim().length > 0
        ? ctx.sessionId.trim()
        : undefined;
    const statePath = resolveStatePath(ctx.projectDir, idleStorage);
    const legacyPath = resolveStatePath(ctx.projectDir);
    let current: GoalState | null;
    try {
      current = await deps.loadState(statePath);
      if (current === null && statePath !== legacyPath) {
        try {
          current = await deps.loadState(legacyPath);
        } catch {
          current = null;
        }
      }
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
        gate.reason === 'wrapped-up' ||
        gate.reason === 'stop-file';
      // Wrap-up-once: on the first budget hit send one final wrap prompt, mark
      // the persisted flag, then every later hit stops without another send.
      if (
        (gate.reason === 'max-turns' || gate.reason === 'wall-time') &&
        current !== null &&
        (current as GoalState).wrapupSent !== true
      ) {
        const cur = current as GoalState;
        // Claim the lease so the wrap send stays single-flight like any turn.
        let wrapClaimed: { claimed: boolean; state: GoalState | null } | null =
          null;
        try {
          wrapClaimed = await deps.tryClaim(
            statePath,
            deps.ownerId,
            LEASE_TTL_MS,
            deps.clock,
          );
        } catch {
          wrapClaimed = null;
        }
        // Lease not held: skip this tick without flipping the flag so the wrap
        // can still be sent later. A lost lease must not consume the one wrap.
        if (wrapClaimed === null || !wrapClaimed.claimed) {
          return { decision: 'skipped', reason: 'lease-held' };
        }
        let wrapOk = false;
        try {
          const raw = await deps.sendPrompt(
            buildWrapupPrompt(cur, gate.reason),
          );
          wrapOk = normalizeSendResult(raw).success;
        } catch {
          // A thrown wrap send is a failure: do not flip the flag.
          wrapOk = false;
        }
        // Only a real successful wrap marks the goal wrapped.
        if (wrapOk) {
          try {
            await deps.saveState(statePath, {
              ...cur,
              wrapupSent: true,
              leaseOwner: null,
              leaseExpiresAtMs: 0,
              updatedAtMs: now,
            });
          } catch {
            // Bookkeeping failure never changes the terminal verdict.
          }
          // A completed wrap clears any watchdog: the goal is terminal.
          try {
            deps.onTurnSettled?.({ ok: true, deadlineMs: null });
          } catch {
            // Settle hook is best-effort.
          }
          return { decision: 'stopped', reason: gate.reason };
        }
        // Send failed: record a retry attempt and stop without flipping.
        const wrapPending = buildPendingAttempt(cur, 'provider-error', now);
        try {
          await deps.saveState(statePath, {
            ...cur,
            pendingAttempt: wrapPending,
            failureCount: cur.failureCount + 1,
            leaseOwner: null,
            leaseExpiresAtMs: 0,
            updatedAtMs: now,
          });
        } catch {
          // Cleanup failure keeps the send failure as the reported reason.
        }
        // A failed wrap re-arms the watchdog so the wrap can be retried.
        try {
          deps.onTurnSettled?.({
            ok: false,
            deadlineMs: wrapPending.deadlineMs,
          });
        } catch {
          // Settle hook is best-effort.
        }
        return { decision: 'stopped', reason: 'send-failed' };
      }
      return {
        decision: terminal ? 'stopped' : 'skipped',
        reason: gate.reason,
      };
    }
    // Per-session cooldown: same session firing too fast skips only this lane.
    // Why composite key exists: projectDir alone blocks distinct sessions.
    // Session-scoped key preserves fairness while global budgets still cap cost.
    const perSession = checkPerSessionCooldown(
      tokenKey,
      now,
      deps.limits.minDelayMs,
    );
    if (!perSession.ok) {
      return { decision: 'skipped', reason: perSession.reason };
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
    let rawSent: unknown;
    try {
      rawSent = await deps.sendPrompt(prompt);
    } catch (err: unknown) {
      // A thrown send is retryable unless it is a user abort, which parks.
      return settleFailedSend(
        statePath,
        claimed.state,
        deps,
        classifyFailure(err),
        sessionPart,
      );
    }
    const sent = normalizeSendResult(rawSent);
    // A failed send never advances the turn and stays retryable for the watchdog.
    if (!sent.success) {
      // A non-retryable failure is a user abort: park instead of retrying.
      const kind: FailureKind = sent.retryable
        ? 'provider-error'
        : 'user-abort';
      return settleFailedSend(
        statePath,
        claimed.state,
        deps,
        kind,
        sessionPart,
      );
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
      // Success clears the retry episode and records a fresh heartbeat.
      pendingAttempt: null,
      lastHeartbeatMs: afterSend,
      failureCount: 0,
      // Remember the real session so a restart can rearm the right lane.
      lastSessionId: sessionPart,
      leaseOwner: null,
      leaseExpiresAtMs: 0,
    };
    try {
      await deps.saveState(statePath, next);
    } catch {
      return { decision: 'stopped', reason: 'save-failed' };
    }
    // Record per-session tick so this lane cools down independently.
    try {
      recordPerSessionTick(tokenKey, afterSend);
    } catch {
      // Cooldown bookkeeping never blocks a successful send.
    }
    // A successful turn clears any watchdog: no stale wake should fire.
    try {
      deps.onTurnSettled?.({ ok: true, deadlineMs: null });
    } catch {
      // Settle hook is best-effort.
    }
    return { decision: 'sent', reason: 'ok', messageId: sent.messageId };
  } finally {
    // Release only our own token: a successor's guard must survive our exit.
    try {
      if (activeContinueTokens.get(tokenKey) === myToken) {
        activeContinueTokens.delete(tokenKey);
      }
    } catch {
      // Token cleanup is best-effort; lease TTL reclaims anyway.
    }
    idleInFlight = false;
  }
}
