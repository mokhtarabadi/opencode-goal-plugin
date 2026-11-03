// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
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
  /**
   * Observation of the assistant turn our last continuation started.
   * Why optional exists: only the host wiring can see tool events, and older
   * callers (plus hosts that never report tool activity) pass nothing. An
   * absent observation is never scored, so the park latch cannot fire blind.
   */
  lastTurn?: TurnObservation | null;
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
   * Optional hook fired after a continuation prompt was sent.
   * Why this exists: the host wiring tracks the turn that continuation starts
   * (tool calls, the `question` tool) and cannot know when the next turn begins
   * without this signal. A send failure never fires it.
   */
  onContinuationSent?: (messageId: string) => void;
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
 * Consecutive no-progress continuation turns before the loop parks for input.
 * Why 2: one empty turn is a normal end-of-turn (a summary, a status line), so
 * parking on it would punish a productive loop; two in a row means the agent is
 * waiting on something the loop cannot supply. The task allows 2-3, and the
 * park message itself is recoverable with one `goal_resume` or `goal_set`.
 */
export const IDLE_PARK_THRESHOLD = 2;

/**
 * Observation of the assistant turn started by one continuation prompt.
 * Why this shape exists: the pure loop cannot see the host event stream, so the
 * wiring reports what it observed and this module decides. `turnId` is the
 * continuation message id, which makes scoring idempotent: a replayed
 * observation for a turn already scored no longer matches the current
 * continuation and is ignored.
 */
export interface TurnObservation {
  /** Continuation message id that started the observed turn. */
  turnId: string;
  /** True when the turn invoked at least one tool. */
  usedTool: boolean;
  /** True when the turn asked the human a question (the `question` tool). */
  askedQuestion: boolean;
}

/** Result of folding one observation into the no-progress streak. */
export interface TurnScore {
  /** True when the observation belonged to the current continuation. */
  scored: boolean;
  /** True when the turn did real work (a tool call or a state change). */
  productive: boolean;
  /** Consecutive no-progress turns after this score. */
  noProgressTurns: number;
  /** True when the scored turn asked the human a question. */
  questionAsked: boolean;
  /** True when the loop should stop and post its one idle message. */
  parkRequested: boolean;
}

/**
 * Stamp of the fields only a real transition writes.
 * Why this list: loop bookkeeping (iteration count is written by the loop
 * itself, so it is stamped from the saved state) must never look like progress,
 * while any tool or slash mutation changes at least one field here. Claim and
 * send timestamps are excluded on purpose because a skipped tick rewrites them.
 * @param state goal state to stamp
 */
export function progressKey(state: GoalState): string {
  return [
    state.objective,
    String(state.createdAtMs),
    state.status,
    String(state.iterationCount),
    String(state.recoveryEpoch),
    state.lastSummary,
    String(state.revisionCount),
    String(state.wrapupSent),
    String(state.pendingVerification),
    state.verificationFailReason ?? '',
    state.evidenceHash ?? '',
  ].join('|');
}

/**
 * Fold one turn observation into the consecutive no-progress streak.
 * Why pure: the park decision must be testable without a host, a clock, or disk.
 * Rules: an observation for any turn other than the current continuation is
 * ignored (idempotent replay); a tool call or a state change resets the streak;
 * the `question` tool parks on the next tick regardless of the threshold,
 * because asking the human is the explicit human gate.
 * @param state current goal state
 * @param turn observation reported by the host wiring, null when unknown
 */
export function scoreContinuationTurn(
  state: GoalState,
  turn: TurnObservation | null | undefined,
): TurnScore {
  const unchanged: TurnScore = {
    scored: false,
    productive: false,
    noProgressTurns: state.noProgressTurns,
    questionAsked: false,
    // Keep an existing latch: no observation must never silently unpark.
    parkRequested: state.idleParked === true,
  };
  if (turn === null || turn === undefined) return unchanged;
  if (typeof turn.turnId !== 'string' || turn.turnId.length === 0) {
    return unchanged;
  }
  // Only the turn our last continuation started may be scored. Anything else is
  // a stale replay or a human-initiated turn the loop must not judge.
  if (state.lastContinuedMessageId === '') return unchanged;
  if (turn.turnId !== state.lastContinuedMessageId) return unchanged;
  // Already scored: a parked goal sends no new continuation, so the host keeps
  // replaying the same observation. Scoring it twice would re-park the goal in
  // the tick that a human answer just unparked.
  if (state.lastScoredTurnId !== '' && turn.turnId === state.lastScoredTurnId) {
    return unchanged;
  }
  const stateChanged =
    state.lastTurnKey !== '' && progressKey(state) !== state.lastTurnKey;
  const productive = turn.usedTool === true || stateChanged;
  const questionAsked = turn.askedQuestion === true;
  if (productive) {
    return {
      scored: true,
      productive: true,
      noProgressTurns: 0,
      questionAsked,
      // A question tool is an explicit human gate even when the turn did real
      // work: the agent is asking, not progressing, so the loop must park.
      parkRequested: questionAsked,
    };
  }
  const count = state.noProgressTurns + 1;
  return {
    scored: true,
    productive: false,
    noProgressTurns: count,
    questionAsked,
    parkRequested: questionAsked || count >= IDLE_PARK_THRESHOLD,
  };
}

/**
 * Fold one host tool event into the pending turn observation.
 * Why this helper exists: the wiring must decide whether the running turn used
 * a tool and whether it asked the human a question, and that rule belongs next
 * to the park policy instead of inside the event loop. It never invents a turn:
 * without a continuation to attach to, the event is ignored.
 * @param turn pending observation for the lane, null when no turn is watched
 * @param toolName tool name reported by the host event, when the host sends one
 */
export function observeToolCall(
  turn: TurnObservation | null | undefined,
  toolName?: string | null,
): TurnObservation | null {
  if (turn === null || turn === undefined) return null;
  return {
    ...turn,
    usedTool: true,
    askedQuestion: turn.askedQuestion === true || toolName === 'question',
  };
}

/**
 * Build the one message posted when the loop parks for human input.
 * Why it names the verbs: the operator has exactly two useful moves, answer the
 * open question or park the goal explicitly, and a vague notice leaves the goal
 * burning turns anyway. It never claims a new status; the goal stays active.
 * @param state active goal state the loop parked on
 * @param noProgressTurns consecutive unproductive turns that tripped the park
 * @param questionAsked true when the turn asked the human a direct question
 */
export function buildIdleParkPrompt(
  state: GoalState,
  noProgressTurns: number,
  questionAsked = false,
): string {
  const why = questionAsked
    ? 'the last turn asked for a decision and no answer has arrived.'
    : String(noProgressTurns) +
      ' consecutive turn(s) ended with no tool call and no goal state change.';
  return (
    'Goal idle awaiting input: "' +
    state.objective +
    '"\n' +
    'The auto-continue loop paused: ' +
    why +
    '\n' +
    'Answer the open question, or call goal_block <reason> to park the goal explicitly. ' +
    'Call goal_resume to revive this loop later.'
  );
}

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
 * Send one stop message exactly once, under the file lease.
 * Why shared: the budget wrap-up and the idle park both mean "claim, send once,
 * persist the latch, settle". A second copy of that sequence would sooner or
 * later drift and let one path send twice or skip the retry bookkeeping.
 * A failed send never flips the latch: the pending attempt is persisted so the
 * watchdog can wake the loop and the message is retried.
 * @param args state path, state at claim time, deps, prompt, reason, latch writer
 */
async function sendOneShotStop(args: {
  statePath: string;
  state: GoalState;
  deps: IdleDeps;
  prompt: string;
  successReason: string;
  mark: (state: GoalState) => GoalState;
}): Promise<IdleDecision> {
  const { statePath, state, deps, prompt, successReason, mark } = args;
  // Claim the lease so the one-shot send stays single-flight like any turn.
  let claimed: { claimed: boolean; state: GoalState | null } | null = null;
  try {
    claimed = await deps.tryClaim(
      statePath,
      deps.ownerId,
      LEASE_TTL_MS,
      deps.clock,
    );
  } catch {
    claimed = null;
  }
  // Lease not held: skip this tick without flipping the latch so the message can
  // still be posted later. A lost lease must not consume the one shot.
  if (claimed === null || !claimed.claimed) {
    return { decision: 'skipped', reason: 'lease-held' };
  }
  const now = deps.clock.nowMs();
  let sentOk = false;
  try {
    sentOk = normalizeSendResult(await deps.sendPrompt(prompt)).success;
  } catch {
    // A thrown send is a failure: do not flip the latch.
    sentOk = false;
  }
  if (sentOk) {
    try {
      await deps.saveState(statePath, {
        ...mark(state),
        leaseOwner: null,
        leaseExpiresAtMs: 0,
        updatedAtMs: now,
      });
    } catch {
      // Bookkeeping failure never changes the terminal verdict.
    }
    // A delivered stop message clears any watchdog: the lane is settled.
    try {
      deps.onTurnSettled?.({ ok: true, deadlineMs: null });
    } catch {
      // Settle hook is best-effort.
    }
    return { decision: 'stopped', reason: successReason };
  }
  // Send failed: record a retry attempt and stop without flipping the latch.
  const pending = buildPendingAttempt(state, 'provider-error', now);
  try {
    await deps.saveState(statePath, {
      ...state,
      pendingAttempt: pending,
      failureCount: state.failureCount + 1,
      leaseOwner: null,
      leaseExpiresAtMs: 0,
      updatedAtMs: now,
    });
  } catch {
    // Cleanup failure keeps the send failure as the reported reason.
  }
  // A failed stop send re-arms the watchdog so it can be retried.
  try {
    deps.onTurnSettled?.({ ok: false, deadlineMs: pending.deadlineMs });
  } catch {
    // Settle hook is best-effort.
  }
  return { decision: 'stopped', reason: 'send-failed' };
}

/**
 * Clear the idle park latch because a human message arrived after the park.
 * Why a claim: this is a real state write and must not race an idle tick or a
 * tool mutation. A lost lease leaves the latch for the next tick to clear.
 * @param statePath absolute goal state path
 * @param state parked state at load time
 * @param deps injected clock plus storage
 */
async function unparkOnHumanInput(
  statePath: string,
  state: GoalState,
  deps: IdleDeps,
): Promise<{ ok: boolean; state: GoalState | null }> {
  let claimed: { claimed: boolean; state: GoalState | null };
  try {
    claimed = await deps.tryClaim(
      statePath,
      deps.ownerId,
      LEASE_TTL_MS,
      deps.clock,
    );
  } catch {
    return { ok: false, state: null };
  }
  if (!claimed.claimed) return { ok: false, state: null };
  const now = deps.clock.nowMs();
  // Prefer the claimant's snapshot: the pre-claim load may be stale.
  const base = claimed.state ?? state;
  const next: GoalState = {
    ...base,
    idleParked: false,
    noProgressTurns: 0,
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: now,
  };
  try {
    await deps.saveState(statePath, next);
  } catch {
    // The TTL reclaims the lease this claim took: report the tick as skipped.
    return { ok: false, state: null };
  }
  return { ok: true, state: next };
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
 * @param opts stopRequested is true when STOP_GOAL exists; humanSpoke is true
 * when a message newer than our last continuation arrived after the park
 */
export function shouldContinue(
  state: GoalState | null,
  nowMs: number,
  lastMessageId: string | null,
  limits: Limits,
  opts?: { stopRequested?: boolean; humanSpoke?: boolean },
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
  // Idle park: the loop already posted its one message for this human gate, so
  // no further turn is spent until the human answers or an explicit resume
  // clears the latch. The goal itself stays active throughout.
  if (state.idleParked === true && opts?.humanSpoke !== true) {
    return { ok: false, reason: 'idle-awaiting-input' };
  }
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
    let now = deps.clock.nowMs();
    let stopRequested = false;
    try {
      stopRequested = await deps.hasStopFile();
    } catch {
      // Fail closed: a filesystem error must not silently ignore STOP_GOAL.
      return { decision: 'stopped', reason: 'stop-check-failed' };
    }
    // A message id newer than our last continuation means someone else spoke
    // after the loop parked. This is the same signal the human-message guard
    // already trusts, reused so the answer to the gate can revive the loop.
    const humanSpoke =
      current !== null &&
      current.lastContinuedMessageId !== '' &&
      ctx.lastMessageId !== null &&
      ctx.lastMessageId !== undefined &&
      ctx.lastMessageId !== current.lastContinuedMessageId;
    // Score the turn our last continuation started. Without an observation the
    // streak is never scored, so a host that does not report tool activity can
    // never park a productive goal by accident.
    let effective: GoalState | null = current;
    let score: TurnScore | null =
      effective === null
        ? null
        : scoreContinuationTurn(effective, ctx.lastTurn ?? null);
    if (
      effective !== null &&
      effective.status === 'active' &&
      effective.idleParked === true &&
      humanSpoke
    ) {
      // The answer arrived: clear the latch once so the loop can run again.
      const cleared = await unparkOnHumanInput(statePath, effective, deps);
      if (!cleared.ok) return { decision: 'skipped', reason: 'lease-held' };
      if (cleared.state !== null) {
        effective = cleared.state;
        score = scoreContinuationTurn(effective, ctx.lastTurn ?? null);
      }
      now = deps.clock.nowMs();
    }
    const budget =
      effective === null ? null : checkBudget(effective, now, deps.limits);
    // Idle park: the streak tripped, or the turn asked the human a question.
    // Budget exhaustion keeps precedence so the wrap-up path stays the owner of
    // that case, and STOP_GOAL always wins over a notice.
    const wantsPark =
      effective !== null &&
      score !== null &&
      score.scored &&
      score.parkRequested &&
      effective.status === 'active' &&
      effective.idleParked !== true &&
      effective.pendingVerification !== true &&
      effective.wrapupSent !== true &&
      stopRequested !== true &&
      (budget === null || budget.ok);
    if (wantsPark && effective !== null && score !== null) {
      // One-shot park through the same plumbing as the budget wrap. No status is
      // invented: the goal stays active, so goal_block is callable right away
      // and goal_resume is the single-call way back.
      const parked = score;
      // Remember which turn this verdict was scored from so the replayed
      // observation cannot fire a second park after a human answer.
      const scoredTurnId =
        typeof ctx.lastTurn?.turnId === 'string' ? ctx.lastTurn.turnId : '';
      return sendOneShotStop({
        statePath,
        state: effective,
        deps,
        prompt: buildIdleParkPrompt(
          effective,
          parked.noProgressTurns,
          parked.questionAsked,
        ),
        successReason: 'idle-awaiting-input',
        mark: (s: GoalState): GoalState => ({
          ...s,
          idleParked: true,
          noProgressTurns: parked.noProgressTurns,
          lastScoredTurnId: scoredTurnId,
        }),
      });
    }
    const gate = shouldContinue(
      effective,
      now,
      ctx.lastMessageId ?? null,
      deps.limits,
      { stopRequested, humanSpoke },
    );
    if (!gate.ok) {
      // No-goal and finished goals stop the loop; cooldown and contention only skip one tick.
      const terminal =
        gate.reason === 'no-state' ||
        gate.reason.startsWith('stopped-') ||
        gate.reason === 'max-turns' ||
        gate.reason === 'wall-time' ||
        gate.reason === 'wrapped-up' ||
        gate.reason === 'stop-file' ||
        gate.reason === 'idle-awaiting-input';
      // Wrap-up-once: on the first budget hit send one final wrap prompt, mark
      // the persisted flag, then every later hit stops without another send.
      if (
        (gate.reason === 'max-turns' || gate.reason === 'wall-time') &&
        effective !== null &&
        effective.wrapupSent !== true
      ) {
        return sendOneShotStop({
          statePath,
          state: effective,
          deps,
          prompt: buildWrapupPrompt(effective, gate.reason),
          successReason: gate.reason,
          mark: (s: GoalState): GoalState => ({ ...s, wrapupSent: true }),
        });
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
    const base: GoalState = {
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
      // A send means the loop is running again, and the streak stored here is
      // the score of the turn that just ended (0 after a productive turn).
      noProgressTurns:
        score !== null && score.scored
          ? score.noProgressTurns
          : claimed.state.noProgressTurns,
      idleParked: false,
      leaseOwner: null,
      leaseExpiresAtMs: 0,
    };
    // Stamp the saved shape, not the pre-save one: the loop's own increment must
    // never look like a foreign mutation on the next tick. The scored turn id
    // records that this observation was consumed, so a replay cannot count twice.
    const next: GoalState = {
      ...base,
      lastTurnKey: progressKey(base),
      lastScoredTurnId:
        score !== null &&
        score.scored &&
        typeof ctx.lastTurn?.turnId === 'string'
          ? ctx.lastTurn.turnId
          : claimed.state.lastScoredTurnId,
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
    // Tell the wiring which turn identity to watch for progress signals.
    try {
      deps.onContinuationSent?.(sent.messageId);
    } catch {
      // Observation bookkeeping is best-effort; the loop still sent its turn.
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
