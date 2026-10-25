// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
/**
 * Plugin entry: OpenCode V2 host binding.
 * Why this file exists: the host loader requires a default export shaped as
 * Plugin.define with an id plus a setup function. All slash, state, loop,
 * and guard logic lives in the pure modules below so tests never need a host.
 */
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { Plugin } from '@opencode/plugin';
import {
  LEASE_TTL_MS,
  SystemClock,
  goalIdentity,
  loadGoalState,
  loadGoalStateWithFallback,
  releaseLease,
  resolveLegacyStatePath,
  resolveStatePath,
  saveGoalState,
  tryClaimLease,
  withClaimLock,
} from './state.js';
import type { Clock, GoalState } from './state.js';
import {
  blockGoal,
  clearGoal,
  completeGoal,
  parseGoalCommand,
  setObjective,
  resumeGoal,
  isSafeGoalTitle,
  GoalInputSchema,
} from './goal.js';
import {
  handleSessionIdle,
  handleSessionFailure,
  classifyFailure,
} from './loop.js';
import { DEFAULT_LIMITS, STOP_FILE_NAME } from './limits.js';
import type { Limits } from './limits.js';
import {
  snapshotForCompaction,
  restoreAfterCompaction,
  buildEvidenceNudge,
  pruneIdleControllers,
} from './compaction.js';
import { saveEvidence, emptyEvidence, loadEvidence } from './evidence.js';
import {
  describeVerificationFailure,
  tryCompleteWithEvidence,
} from './verifier.js';
import { PROOF_TOTAL_TIMEOUT_MS } from './proof.js';
import { recordEvidence, registerGoalTools } from './tools.js';
import {
  armWatchdog,
  clearWatchdog,
  rearmFromState,
  _resetWatchdogsForTests,
} from './watchdog.js';

/**
 * V2 contract note: file-state at .opencode/goal-state.json owns truth.
 * Why ctx.storage does not own truth: 76 tests plus compaction survival
 * assume file truth with atomic tmp plus rename. Storage is ephemeral
 * cache only and never replaces the file. No server export exists here
 * by design because V2 ignores server() and reads only id plus setup().
 */

export const PLUGIN_NAME = 'opencode-goal-plugin';
export const PLUGIN_VERSION = '0.2.0';

/**
 * Message when the state lease is already held by another lane.
 * Why shared text: the slash and tool lanes must report contention identically.
 */
const BUSY_GOAL_MESSAGE = 'Goal is busy with another turn. Retry shortly.';

/**
 * Message when the goal identity changed during a long completion pass.
 * Why a distinct string: the caller must retry against the new goal instead of
 * treating the run as a failure of the old one.
 */
const STATE_CHANGED_MESSAGE =
  'Goal state changed while completing. Run /goal status and retry.';

/**
 * Monotonic sequence for slash lease owners.
 * Why this exists: the lease treats a repeated owner id as the same writer and
 * lets it re-claim, so two concurrent slash calls must never share an owner.
 */
let slashOwnerSeq = 0;

/** Minimal host shape, all fields optional so probing never throws. */
export interface MinimalHost {
  version?: unknown;
  registerCommand?: unknown;
  onIdle?: unknown;
  onCompact?: unknown;
  onSessionEnd?: unknown;
}

/**
 * Probe available hooks without throwing.
 * @param host unknown host object from OpenCode V2
 */
export function getAvailableHooks(host: unknown): string[] {
  try {
    if (typeof host !== 'object' || host === null) return [];
    const h = host as MinimalHost;
    const out: string[] = [];
    // Explicit typeof checks keep this fail-closed on renamed host APIs.
    if (typeof h['registerCommand'] === 'function') out.push('registerCommand');
    if (typeof h['onIdle'] === 'function') out.push('onIdle');
    if (typeof h['onCompact'] === 'function') out.push('onCompact');
    if (typeof h['onSessionEnd'] === 'function') out.push('onSessionEnd');
    return out;
  } catch {
    return [];
  }
}

/**
 * Handle a slash goal command against file state.
 * Every failure returns a friendly string, never throws.
 * @param rawInput raw input like /goal ship feature
 * @param projectDir project root containing the .opencode dir
 * @param clock injected clock, defaults to SystemClock
 * @param hostVersion host version string for audit
 */
export async function handleGoalCommand(
  rawInput: string,
  projectDir: string,
  clock: Clock = new SystemClock(),
  hostVersion: string = '2.0.29',
  sessionId?: string | null,
): Promise<string> {
  // Type guards first: a misbehaving host gets a message, never a TypeError.
  if (typeof rawInput !== 'string') {
    return 'Invalid /goal usage. Try /goal <objective> or /goal status.';
  }
  if (typeof projectDir !== 'string' || projectDir.trim().length === 0) {
    return 'Invalid project directory.';
  }
  // Parse before touching disk so invalid input never writes state.
  const parsed = parseGoalCommand(rawInput);
  if (parsed.kind === 'invalid') {
    return 'Invalid /goal usage. Try /goal <objective> or /goal status.';
  }
  const storage =
    typeof sessionId === 'string' && sessionId.trim() !== ''
      ? sessionId.trim()
      : undefined;
  const statePath = resolveStatePath(projectDir, storage);
  const legacyPath = resolveLegacyStatePath(projectDir);
  let current: GoalState | null;
  try {
    current =
      statePath === legacyPath
        ? await loadGoalState(statePath)
        : await loadGoalStateWithFallback(statePath, legacyPath);
  } catch {
    // Corrupt JSON or shape mismatch: point at the file, do not throw.
    return (
      'Goal state is corrupt at ' +
      statePath +
      '. Back up the file then clear it.'
    );
  }
  // One lease owner per operation, so two slash calls never look like the same
  // writer (a repeated owner id would re-enter its own claim). A missing file
  // needs no claim: there is nothing to race before the first write.
  slashOwnerSeq += 1;
  const slashOwner =
    'slash:' +
    (typeof storage === 'string' && storage.length > 0 ? storage : 'default') +
    ':' +
    String(slashOwnerSeq);
  /**
   * Run one slash mutation under the state lease.
   * Why a helper: four branches share the claim, the busy message, and the
   * release safety net, so the policy cannot drift between them.
   * @param fn mutation body that reads fresh state and returns its message
   */
  const withSlashLease = async (fn: () => Promise<string>): Promise<string> => {
    // No state file at all: still serialize the very first write with the lock.
    if (current === null) {
      const locked = await withClaimLock(
        statePath,
        slashOwner,
        LEASE_TTL_MS,
        clock,
        fn,
      );
      if (!locked.ok) return BUSY_GOAL_MESSAGE;
      return locked.value as string;
    }
    // First write to a scoped file: the lease cannot serialize a migrate-on-write
    // because there is no scoped state to claim yet. The dedicated lock does,
    // without writing a lease into the legacy file.
    if (statePath !== legacyPath) {
      let scopedExists = true;
      try {
        scopedExists = (await loadGoalState(statePath)) !== null;
      } catch {
        // Corrupt scoped file falls through to the lease, which fails closed.
        scopedExists = true;
      }
      if (!scopedExists) {
        const locked = await withClaimLock(
          statePath,
          slashOwner,
          LEASE_TTL_MS,
          clock,
          fn,
        );
        if (!locked.ok) return BUSY_GOAL_MESSAGE;
        return locked.value as string;
      }
    }
    try {
      const claim = await tryClaimLease(
        statePath,
        slashOwner,
        LEASE_TTL_MS,
        clock,
      );
      if (!claim.claimed) return BUSY_GOAL_MESSAGE;
    } catch (err) {
      // Claim writes the lease, so a throw here is a real save failure.
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    try {
      return await fn();
    } finally {
      try {
        await releaseLease(statePath, slashOwner, clock);
      } catch {
        // TTL reclaims a stale lease: release failure never blocks a report.
      }
    }
  };
  /**
   * Reload state inside a held lease so a mutation writes the newest snapshot.
   * @returns fresh state, or the corrupt message when the file is unreadable
   */
  const reload = async (): Promise<GoalState | null> => {
    try {
      return statePath === legacyPath
        ? await loadGoalState(statePath)
        : await loadGoalStateWithFallback(statePath, legacyPath);
    } catch {
      return null;
    }
  };
  if (parsed.kind === 'status') {
    if (current === null) return 'No goal set. Use /goal <objective>.';
    return 'Goal ' + current.status + ': ' + current.objective;
  }
  if (parsed.kind === 'set') {
    // V2 strictness: JSON Schema shape plus traversal guard before disk.
    // Why extra check exists: parser allows prose, schema plus guard blocks
    // path escapes that could confuse later file citations. Valid prose passes.
    // Real schema enforcement: title must be string 1..2000, required, no extras.
    const schemaOk =
      GoalInputSchema.required.includes('title') &&
      GoalInputSchema.additionalProperties === false &&
      typeof parsed.objective === 'string' &&
      parsed.objective.trim().length >= 1 &&
      parsed.objective.length <= 2000;
    if (!schemaOk) {
      return 'Invalid /goal usage. Try /goal <objective> or /goal status.';
    }
    if (!isSafeGoalTitle(parsed.objective)) {
      return 'Invalid /goal usage. Objective must not be a path escape.';
    }
    // New objective resets counters and clears any stale lease. Runs under the
    // lease and re-reads so a concurrent transition is never overwritten.
    return withSlashLease(async () => {
      const fresh = await reload();
      if (fresh === null) {
        // No file yet (first set) is fine; unreadable is not.
        const exists = await loadGoalState(statePath).catch(() => null);
        if (exists !== null) {
          return (
            'Goal state is corrupt at ' +
            statePath +
            '. Back up the file then clear it.'
          );
        }
      }
      const next = setObjective(fresh, parsed.objective, clock, hostVersion);
      try {
        await saveGoalState(statePath, next);
      } catch (err) {
        // Save I/O errors report separately from transition errors.
        return 'Failed to save goal state: ' + (err as Error).message;
      }
      return 'Goal set to active: ' + next.objective;
    });
  }
  if (current === null) {
    return 'No goal set. Use /goal <objective> first.';
  }
  if (parsed.kind === 'block') {
    return withSlashLease(async () => {
      const fresh = (await reload()) ?? current;
      let next: GoalState;
      try {
        next = blockGoal(fresh, parsed.reason, clock);
      } catch {
        return (
          'Only an active goal can be blocked. Current status: ' +
          fresh.status +
          '.'
        );
      }
      try {
        await saveGoalState(statePath, next);
      } catch (err) {
        return 'Failed to save goal state: ' + (err as Error).message;
      }
      return 'Goal marked blocked: ' + parsed.reason;
    });
  }
  if (parsed.kind === 'evidence') {
    // Parity by construction: the slash lane calls the tool handler directly,
    // so validation plus lease plus messages cannot drift between lanes.
    // Storage scope is the real session; the lease lane stays 'slash'.
    return await recordEvidence(
      projectDir,
      clock,
      {
        id: parsed.id,
        claim: parsed.claim,
        files: parsed.files,
        tests: parsed.tests,
      },
      'slash',
      storage ?? null,
    );
  }
  if (parsed.kind === 'complete') {
    // Evidence gate: active goals need proof, blocked or done still report status.
    // Why order matters: legacy status error must surface first so existing
    // blocked-complete test keeps its message. Only active goals reach verifier.
    // This is a pre-check only: the authoritative transition is recomputed from
    // freshly reloaded state after the lease is held (see below).
    try {
      completeGoal(current, clock);
    } catch {
      return (
        'Only an active goal can complete. Current status: ' +
        current.status +
        '.'
      );
    }
    // Active path now requires evidence: missing proof blocks with friendly text.
    // Guard first: completion now observes real commands, so a long proof pass
    // must serialize against the loop and the tool lane. The TTL covers the whole
    // proof budget plus a release buffer. `slashOwner` is the same owner every
    // slash mutation uses, so no slash write can slip in during the pass.
    const owner = slashOwner;
    /** The completion body, run under whichever guard applies to this file. */
    const finishComplete = async (): Promise<string> => {
      // Scoped evidence: a session completes only on its own citations.
      let evidenceError = false;
      try {
        const ev = await loadEvidence(projectDir, storage);
        const check = await tryCompleteWithEvidence({
          projectDir,
          evidence: ev,
          clock,
        });
        if (!check.ok) {
          return describeVerificationFailure(check.reason, check.failures);
        }
      } catch {
        // Verifier failure fails closed: do not mark complete without proof.
        evidenceError = true;
      }
      if (evidenceError) {
        return describeVerificationFailure('verifier-error', []);
      }
      // Reload AFTER proof, immediately before the save: a proof pass can run
      // for minutes, so this is the only snapshot safe to write.
      const fresh = await loadGoalStateWithFallback(statePath, legacyPath);
      if (fresh === null) {
        return 'No goal set. Use /goal <objective> first.';
      }
      // Identity check across the whole generation, not just the objective: a
      // block, a clear, or a loop turn during the pass also invalidates this
      // completion. Aborting writes nothing.
      if (goalIdentity(fresh) !== goalIdentity(current)) {
        return STATE_CHANGED_MESSAGE;
      }
      let next: GoalState;
      try {
        next = completeGoal(fresh, clock);
      } catch {
        return (
          'Only an active goal can complete. Current status: ' +
          fresh.status +
          '.'
        );
      }
      try {
        await saveGoalState(statePath, next);
      } catch (err) {
        return 'Failed to save goal state: ' + (err as Error).message;
      }
      return 'Goal marked complete.';
    };
    // Migrate-on-write: with no scoped file yet the lease cannot be claimed, so
    // the dedicated lock guards this first write instead of reporting busy.
    if (statePath !== legacyPath) {
      let scopedMissing = false;
      try {
        scopedMissing = (await loadGoalState(statePath)) === null;
      } catch {
        // Corrupt scoped file falls through to the lease, which fails closed.
      }
      if (scopedMissing) {
        const locked = await withClaimLock(
          statePath,
          owner,
          PROOF_TOTAL_TIMEOUT_MS + 60000,
          clock,
          finishComplete,
        );
        if (!locked.ok) return BUSY_GOAL_MESSAGE;
        return locked.value as string;
      }
    }
    let held = false;
    try {
      const claim = await tryClaimLease(
        statePath,
        owner,
        PROOF_TOTAL_TIMEOUT_MS + 60000,
        clock,
      );
      held = claim.claimed;
    } catch {
      // Lock I/O failure fails closed: never run proof without the lease.
      return BUSY_GOAL_MESSAGE;
    }
    if (!held) return BUSY_GOAL_MESSAGE;
    try {
      return await finishComplete();
    } finally {
      // Release is a no-op after a successful save (the transition clears it),
      // and the safety net for every early return above.
      try {
        await releaseLease(statePath, owner, clock);
      } catch {
        // TTL reclaims a stale lease: release failure never blocks a report.
      }
    }
  }
  if (parsed.kind === 'resume') {
    // Resume a parked goal back to active after an explicit user request.
    return withSlashLease(async () => {
      const fresh = (await reload()) ?? current;
      let resumed: GoalState;
      try {
        resumed = resumeGoal(fresh, clock);
      } catch {
        return (
          'Only a parked goal can resume. Current status: ' + fresh.status + '.'
        );
      }
      try {
        await saveGoalState(statePath, resumed);
      } catch (err) {
        return 'Failed to save goal state: ' + (err as Error).message;
      }
      return 'Goal resumed: ' + resumed.objective;
    });
  }
  return withSlashLease(async () => {
    const fresh = (await reload()) ?? current;
    const cleared = clearGoal(fresh, clock);
    try {
      await saveGoalState(statePath, cleared);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal cleared.';
  });
}

/**
 * Legacy probe stub kept for compatibility with earlier tests.
 */
export function handleIdleStub(): string {
  return 'phase2-not-implemented';
}

/** Options for idle registration. */
export interface RegisterIdleOptions {
  projectDir: string;
  getLastMessageId: () => string | null;
  sendPrompt: (
    prompt: string,
  ) => Promise<{ messageId: string; tokenSpend?: number }>;
  clock?: Clock;
  limits?: Limits;
  ownerId?: string;
}

/**
 * Build a stop-file checker for one project dir.
 * @param projectDir project root containing the .opencode dir
 */
export function defaultHasStopFile(projectDir: string): () => Promise<boolean> {
  return async () => {
    try {
      await fs.access(path.join(projectDir, '.opencode', STOP_FILE_NAME));
      return true;
    } catch (e: unknown) {
      // ENOENT means no kill switch. Other errors fail closed upstream.
      const code = (e as { code?: string }).code;
      if (code === 'ENOENT') return false;
      throw e;
    }
  };
}

/**
 * Register the idle handler only when the host supports onIdle, fail closed otherwise.
 * @param host unknown host object from OpenCode V2
 * @param opts project dir plus host callbacks
 */
export function registerIdleHandler(
  host: unknown,
  opts: RegisterIdleOptions,
): { registered: boolean; reason: string } {
  // Opts guards first: bad input gets a reason string, never a TypeError.
  if (opts === null || typeof opts !== 'object') {
    return { registered: false, reason: 'invalid-opts' };
  }
  if (
    typeof opts.projectDir !== 'string' ||
    opts.projectDir.trim().length === 0
  ) {
    return { registered: false, reason: 'invalid-opts' };
  }
  if (
    typeof opts.getLastMessageId !== 'function' ||
    typeof opts.sendPrompt !== 'function'
  ) {
    return { registered: false, reason: 'invalid-opts' };
  }
  // Probe first so unknown hosts get a reason string, never an exception.
  const hooks = getAvailableHooks(host);
  if (!hooks.includes('onIdle')) {
    return { registered: false, reason: 'idle-hook-unavailable' };
  }
  const h = host as { onIdle?: unknown };
  if (typeof h.onIdle !== 'function') {
    return { registered: false, reason: 'idle-hook-unavailable' };
  }
  const clock = opts.clock ?? new SystemClock();
  const limits = opts.limits ?? DEFAULT_LIMITS;
  // Random owner suffix separates this process from other loop runners.
  const ownerId =
    opts.ownerId ??
    'idle-' +
      String(process.pid) +
      '-' +
      String(Math.floor(Math.random() * 1000000));
  if (typeof ownerId !== 'string' || ownerId.length === 0) {
    return { registered: false, reason: 'invalid-opts' };
  }
  const hasStopFile = defaultHasStopFile(opts.projectDir);
  const cb = async (): Promise<void> => {
    // Safe callback: host callbacks must never throw into the host loop.
    let lastId: string | null = null;
    try {
      lastId = opts.getLastMessageId() ?? null;
    } catch {
      lastId = null;
    }
    const ctx = { projectDir: opts.projectDir, lastMessageId: lastId };
    const deps = {
      clock,
      limits,
      ownerId,
      loadState: loadGoalState,
      saveState: saveGoalState,
      tryClaim: tryClaimLease,
      sendPrompt: opts.sendPrompt,
      hasStopFile,
    };
    try {
      await handleSessionIdle(ctx, deps);
    } catch {
      // handleSessionIdle already maps its own failures; this is a final net.
    }
  };
  try {
    (h.onIdle as (cb: () => Promise<void>) => void)(cb);
    return { registered: true, reason: 'ok' };
  } catch {
    return { registered: false, reason: 'register-failed' };
  }
}

/** Options for compaction registration. */
export interface RegisterCompactionOptions {
  projectDir: string;
  clock?: Clock;
  sessionId?: string | null;
}

/**
 * Register compaction snapshot plus resume handlers when the host supports them.
 * Probes onCompact plus onSessionResume plus onSessionStart and fails closed
 * with a reason when none exist. Snapshot and restore never send and never claim.
 * @param host unknown host object from OpenCode V2
 * @param opts project dir plus optional clock
 */
export function registerCompactionHandler(
  host: unknown,
  opts: RegisterCompactionOptions,
): { registered: boolean; reason: string } {
  // Whole body inside try: any unexpected throw maps to register-failed, never escapes.
  try {
    // Opts guards first: bad input gets a reason string, never a TypeError.
    if (opts === null || typeof opts !== 'object') {
      return { registered: false, reason: 'invalid-opts' };
    }
    if (
      typeof opts.projectDir !== 'string' ||
      opts.projectDir.trim().length === 0
    ) {
      return { registered: false, reason: 'invalid-opts' };
    }
    // Host guard before any dereference: null hosts get unavailable, never TypeError.
    if (host === null || typeof host !== 'object') {
      return { registered: false, reason: 'compaction-hook-unavailable' };
    }
    const hooks = getAvailableHooks(host);
    const hasCompact = hooks.includes('onCompact');
    const h = host as {
      onCompact?: unknown;
      onSessionResume?: unknown;
      onSessionStart?: unknown;
    };
    const resumeFn =
      typeof h.onSessionResume === 'function'
        ? (h.onSessionResume as (cb: () => Promise<void>) => void)
        : typeof h.onSessionStart === 'function'
          ? (h.onSessionStart as (cb: () => Promise<void>) => void)
          : null;
    if (!hasCompact && resumeFn === null) {
      return { registered: false, reason: 'compaction-hook-unavailable' };
    }
    const clock = opts.clock ?? new SystemClock();
    const storage =
      typeof opts.sessionId === 'string' && opts.sessionId.trim() !== ''
        ? opts.sessionId.trim()
        : undefined;
    const statePath = resolveStatePath(opts.projectDir, storage);
    const store = { loadState: loadGoalState, saveState: saveGoalState };
    // Snapshot flushes hot state to disk before compaction wipes memory.
    if (hasCompact && typeof h.onCompact === 'function') {
      (h.onCompact as (cb: () => Promise<void>) => void)(async () => {
        try {
          await snapshotForCompaction(statePath, clock, store);
        } catch {
          // Snapshot failure must not break host compaction.
        }
      });
    }
    // Resume reloads file state and bumps restoreCount; the next idle tick decides.
    if (resumeFn !== null) {
      (resumeFn as (cb: () => Promise<void>) => void)(async () => {
        try {
          await restoreAfterCompaction(statePath, clock, store);
        } catch {
          // Restore failure leaves file state untouched for the next idle load.
        }
      });
    }
    return { registered: true, reason: 'ok' };
  } catch {
    return { registered: false, reason: 'register-failed' };
  }
}

/**
 * Build the work instruction posted when a goal is set through the V2 command.
 * The instruction carries the objective plus the stop verbs so the agent loop
 * knows how to report done, stuck, or cancelled.
 * @param objective active objective text
 * @param iterationCount current turn count for context
 */
export function buildGoalWorkInstruction(
  objective: string,
  iterationCount: number,
): string {
  return (
    'Goal accepted: "' +
    objective +
    '" (turn ' +
    String(iterationCount + 1) +
    ').\n' +
    'Work toward it now with concrete steps.\n' +
    'When done, finish with evidence and call /goal complete. ' +
    'If blocked, call /goal block <reason>. To cancel, call /goal clear. ' +
    'If the goal was parked, call /goal resume to continue.'
  );
}

/**
 * Resolve the project directory for file state from a V2 context.
 * Falls back to the process working directory when the host gives none.
 * @param ctx unknown V2 plugin context
 */
export function resolveProjectDir(ctx: unknown): string {
  try {
    const c = ctx as { location?: { directory?: unknown } };
    if (
      typeof c.location?.directory === 'string' &&
      c.location.directory.length > 0
    ) {
      return c.location.directory;
    }
  } catch {
    // Fall through to the working directory default.
  }
  return process.cwd();
}

/**
 * Post a best-effort visible message to a session without throwing.
 * @param session host session domain with a synthetic prompt call
 * @param sessionID target session id
 * @param text message text
 */
async function notifySynthetic(
  session: {
    synthetic?: (args: { sessionID: string; text: string }) => Promise<unknown>;
  },
  sessionID: string,
  text: string,
): Promise<void> {
  try {
    if (typeof session.synthetic === 'function') {
      await session.synthetic({ sessionID, text });
    }
  } catch {
    // Synthetic delivery is best-effort; never fail hosting over it.
  }
}

/**
 * OpenCode V2 plugin definition. The host loader validates this exact shape:
 * a default export with an id plus a setup function.
 */
export default Plugin.define({
  id: PLUGIN_NAME,
  async setup(ctx) {
    const projectDir = resolveProjectDir(ctx);
    const clock = new SystemClock();
    const ownerId =
      'v2-' +
      String(process.pid) +
      '-' +
      String(Math.floor(Math.random() * 1000000));
    const hasStopFile = defaultHasStopFile(projectDir);

    // Slash goal command: set drives work, the rest report status.
    try {
      const cmd = (ctx as { command?: { transform?: unknown } }).command;
      if (
        cmd !== null &&
        typeof cmd === 'object' &&
        typeof (cmd as { transform?: unknown }).transform === 'function'
      ) {
        await (
          cmd as {
            transform: (
              fn: (editor: {
                add: (d: {
                  name: string;
                  description: string;
                  execute: (i: unknown) => Promise<void>;
                }) => void;
              }) => void,
            ) => Promise<unknown>;
          }
        ).transform((editor) => {
          editor.add({
            name: 'goal',
            description:
              'Set a session goal and auto-continue until complete, blocked, or cleared.',
            execute: async (invocation: unknown) => {
              try {
                const inv = invocation as {
                  sessionID?: unknown;
                  prompt?: { text?: unknown };
                };
                const sessionID =
                  typeof inv.sessionID === 'string' ? inv.sessionID : '';
                const text =
                  typeof inv.prompt?.text === 'string'
                    ? (inv.prompt.text as string)
                    : '';
                const parsed = parseGoalCommand('/goal ' + text);
                if (parsed.kind === 'set') {
                  // Setup guard mirrors handleGoalCommand: reject path escapes here too.
                  // Why duplicate check exists: V2 setup executes set directly,
                  // bypassing the guarded handler below. Both lanes must enforce.
                  if (!isSafeGoalTitle(parsed.objective)) {
                    if (sessionID !== '') {
                      const session = (
                        ctx as {
                          session?: {
                            synthetic?: (a: {
                              sessionID: string;
                              text: string;
                            }) => Promise<unknown>;
                          };
                        }
                      ).session;
                      try {
                        await session?.synthetic?.({
                          sessionID,
                          text: 'Invalid /goal usage. Objective must not be a path escape.',
                        });
                      } catch {
                        // Best-effort notice only.
                      }
                    }
                    return;
                  }
                  const storage = sessionID !== '' ? sessionID : undefined;
                  const statePath = resolveStatePath(projectDir, storage);
                  const legacyPath = resolveLegacyStatePath(projectDir);
                  const current = await (
                    statePath === legacyPath
                      ? loadGoalState(statePath)
                      : loadGoalStateWithFallback(statePath, legacyPath)
                  ).catch(() => null);
                  const next = setObjective(
                    current,
                    parsed.objective,
                    clock,
                    '2.0.29',
                  );
                  await saveGoalState(statePath, next);
                  // Seed evidence shell so completion checks have a file from turn one.
                  // Scoped seed: sessions never share citations.
                  await saveEvidence(
                    projectDir,
                    emptyEvidence(clock.nowMs()),
                    storage,
                  ).catch(() => undefined);
                  if (sessionID !== '') {
                    await (
                      ctx as {
                        session?: { prompt?: (a: unknown) => Promise<unknown> };
                      }
                    ).session
                      ?.prompt?.({
                        sessionID,
                        text: buildGoalWorkInstruction(
                          next.objective,
                          next.iterationCount,
                        ),
                      })
                      .catch(() => undefined);
                  }
                  return;
                }
                // Status, block, complete, and clear reuse the guarded handler, then report.
                // Real session threads through so B never touches A's goal.
                const message = await handleGoalCommand(
                  '/goal ' + text,
                  projectDir,
                  clock,
                  '2.0.29',
                  sessionID !== '' ? sessionID : undefined,
                );
                if (sessionID !== '') {
                  const session = (
                    ctx as {
                      session?: {
                        synthetic?: (a: {
                          sessionID: string;
                          text: string;
                        }) => Promise<unknown>;
                      };
                    }
                  ).session;
                  if (session !== undefined)
                    await notifySynthetic(session, sessionID, message);
                }
              } catch {
                // Command failures stay local; the host loop continues.
              }
            },
          });
        });
      }
    } catch {
      // Command registration is best-effort; idle and hooks still arm below.
    }

    // Agent-callable goal tools: goal_set, goal_block, goal_complete, goal_resume.
    // Why beside the slash lane: both lanes share handleGoalCommand, so the
    // model can drive the goal itself while user slash commands keep working.
    // Best-effort like the command above: a host without the tool domain still
    // runs slash plus idle plus hooks.
    try {
      await registerGoalTools(ctx, projectDir, clock);
    } catch {
      // Tool registration failure never breaks the slash lane below.
    }

    // Idle auto-continue: one safe turn per session idle tick.
    // AbortSet hygiene: every subscribe controller is tracked so compaction
    // can abort stale listeners and prevent duplicate ticks after resume.
    const controller = new AbortController();
    const idleAbortControllers = new Set<AbortController>();
    idleAbortControllers.add(controller);
    // Shared deps builder so idle ticks, failure rearms, and startup resume all
    // use one sender. Why one builder: a second copy could drift and let a wake
    // or a retry send twice under the same lane.
    const buildIdleDeps = (rawID: string) => {
      const session = (
        ctx as { session?: { prompt?: (a: unknown) => Promise<unknown> } }
      ).session;
      const promptFn =
        session !== undefined && typeof session.prompt === 'function'
          ? session.prompt.bind(session)
          : null;
      return {
        clock,
        limits: DEFAULT_LIMITS,
        ownerId,
        loadState: loadGoalState,
        saveState: saveGoalState,
        tryClaim: tryClaimLease,
        sendPrompt: async (prompt: string) => {
          // Real failures stay failures: never synthesize a fake success.
          // A thrown send or an empty message id becomes a retryable result.
          if (promptFn === null) {
            return {
              success: false as const,
              error: 'no-prompt-fn',
              retryable: true,
            };
          }
          try {
            const res = (await promptFn({
              sessionID: rawID,
              text: prompt,
            })) as {
              messageID?: unknown;
              tokenSpend?: unknown;
            } | null;
            const messageID =
              typeof res?.messageID === 'string' && res.messageID.length > 0
                ? res.messageID
                : '';
            if (messageID === '') {
              return {
                success: false as const,
                error: 'empty-message-id',
                retryable: true,
              };
            }
            const tokenSpend =
              typeof res?.tokenSpend === 'number' ? res.tokenSpend : 0;
            return { success: true as const, messageId: messageID, tokenSpend };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            // An abort must not be retried: mark it non-retryable so the loop
            // parks the goal instead of arming a watchdog against a user stop.
            const kind = classifyFailure(err);
            return {
              success: false as const,
              error: msg,
              retryable: kind !== 'user-abort',
            };
          }
        },
        hasStopFile,
        // Settle hook: success clears the watchdog, failure re-arms it.
        onTurnSettled: (r: { ok: boolean; deadlineMs: number | null }) => {
          try {
            if (r.ok || r.deadlineMs === null) {
              clearWatchdog(projectDir, rawID);
              return;
            }
            armWatchdog(projectDir, rawID, r.deadlineMs, clock, async () => {
              await handleSessionIdle(
                { projectDir, lastMessageId: null, sessionId: rawID },
                buildIdleDeps(rawID),
              );
            });
          } catch {
            // Watchdog bookkeeping is best-effort.
          }
        },
      };
    };
    const idleTask = (async () => {
      try {
        const events = (
          ctx as {
            event?: { subscribe?: (a: unknown) => AsyncIterable<unknown> };
          }
        ).event;
        if (events === undefined || typeof events.subscribe !== 'function')
          return;
        const stream = events.subscribe({
          signal: controller.signal,
        }) as AsyncIterable<{
          type?: unknown;
          data?: { sessionID?: unknown };
          properties?: { sessionID?: unknown };
        }>;
        for await (const event of stream) {
          try {
            if (event === null || typeof event !== 'object') continue;
            const evType = (event as { type?: unknown }).type;
            const data = (event as { data?: { sessionID?: unknown } }).data;
            const props = (event as { properties?: { sessionID?: unknown } })
              .properties;
            // Failure events (error / execution.failed / execution.interrupted)
            // are the crash-and-abort signal: classify and park or mark retry.
            if (
              evType === 'session.error' ||
              evType === 'session.execution.failed' ||
              evType === 'session.execution.interrupted'
            ) {
              const failID = data?.sessionID ?? props?.sessionID;
              if (typeof failID !== 'string' || failID.length === 0) continue;
              const errPayload =
                (event as { error?: unknown }).error ??
                (
                  event as {
                    properties?: { error?: unknown };
                    data?: { error?: unknown };
                  }
                ).properties?.error ??
                (event as { data?: { error?: unknown } }).data?.error ??
                evType;
              await handleSessionFailure(
                { projectDir, sessionId: failID },
                {
                  clock,
                  loadState: loadGoalState,
                  saveState: saveGoalState,
                  tryClaim: tryClaimLease,
                  ownerId,
                },
                errPayload,
                typeof evType === 'string' ? evType : undefined,
              );
              // Re-arm the watchdog from the persisted attempt so a retryable
              // provider error wakes the loop even when no idle event follows.
              void loadGoalState(resolveStatePath(projectDir))
                .then((st) => {
                  if (st === null) return;
                  rearmFromState(projectDir, failID, st, clock, async () => {
                    await handleSessionIdle(
                      { projectDir, lastMessageId: null, sessionId: failID },
                      buildIdleDeps(failID),
                    );
                  });
                })
                .catch(() => undefined);
              continue;
            }
            if (evType !== 'session.idle') continue;
            const rawID = data?.sessionID ?? props?.sessionID;
            if (typeof rawID !== 'string' || rawID.length === 0) continue;
            // Thread the real last message id so the human-message yield works.
            // Falling back to null only when the host omits it.
            const lastMsgId =
              (props as { lastMessageID?: unknown } | undefined)
                ?.lastMessageID ??
              (data as { lastMessageID?: unknown } | undefined)
                ?.lastMessageID ??
              null;
            await handleSessionIdle(
              {
                projectDir,
                lastMessageId: typeof lastMsgId === 'string' ? lastMsgId : null,
                sessionId: rawID,
              },
              buildIdleDeps(rawID),
            );
          } catch {
            // One bad tick never kills the subscription.
          }
        }
      } catch {
        // Stream end or abort: quiet exit.
      }
    })();

    // Session-start resume: rearm outstanding retries from file state.
    // Why scan instead of one file: per-session files each own their lane, so
    // a global lastSessionId would reintroduce the leak. Best-effort only.
    void (async () => {
      try {
        // Legacy single file keeps its old lane behavior for old users.
        await loadGoalState(resolveStatePath(projectDir))
          .then((st) => {
            if (st === null || st.status !== 'active') return;
            if (st.pendingAttempt === null) return;
            const lane =
              typeof st.lastSessionId === 'string' &&
              st.lastSessionId.length > 0
                ? st.lastSessionId
                : '';
            if (lane === '') return;
            rearmFromState(projectDir, lane, st, clock, async () => {
              await handleSessionIdle(
                { projectDir, lastMessageId: null, sessionId: lane },
                buildIdleDeps(lane),
              );
            });
          })
          .catch(() => undefined);
        // Scoped files: rearm each lane with a pending retry.
        const { promises: fsp } = await import('node:fs');
        const goalsDir = (await import('node:path')).join(
          projectDir,
          '.opencode',
          'goals',
        );
        let names: string[] = [];
        try {
          names = await fsp.readdir(goalsDir);
        } catch {
          return;
        }
        for (const n of names) {
          if (!n.endsWith('.json') || n.endsWith('.evidence.json')) continue;
          if (n.includes('.lock')) continue;
          const lane = n.slice(0, -'.json'.length);
          if (!/^[A-Za-z0-9_-]{1,64}$|^sid-[0-9a-f]{8}$/.test(lane)) continue;
          try {
            const st = await loadGoalState(resolveStatePath(projectDir, lane));
            if (st === null || st.status !== 'active') continue;
            if (st.pendingAttempt === null) continue;
            rearmFromState(projectDir, lane, st, clock, async () => {
              await handleSessionIdle(
                { projectDir, lastMessageId: null, sessionId: lane },
                buildIdleDeps(lane),
              );
            });
          } catch {
            // One bad scoped file never blocks the rest.
          }
        }
      } catch {
        // Startup rearm is best-effort.
      }
    })();

    // Compaction survival: re-inject the goal summary from file state, never send.
    try {
      const session = (
        ctx as {
          session?: {
            hook?: (n: string, f: (e: unknown) => void) => Promise<unknown>;
          };
        }
      ).session;
      if (session !== undefined && typeof session.hook === 'function') {
        await session
          .hook('compaction', (event: unknown) => {
            try {
              const e = event as { sessionID?: unknown; messages?: unknown };
              if (typeof e.sessionID !== 'string') return;
              // Abort hygiene: stale idle listeners must not double-fire after resume.
              // Keep the live controller via pure helper so behavior is tested.
              // Copy-iterate inside helper avoids skip-during-delete fragility.
              try {
                pruneIdleControllers(idleAbortControllers, controller);
              } catch {
                // Prune failure never blocks compaction; live stays registered.
                idleAbortControllers.add(controller);
              }
              // Scoped restore: a session resumes only its own goal, never another's.
              void loadGoalState(resolveStatePath(projectDir, e.sessionID))
                .then((state) => {
                  if (state === null || state.status !== 'active') return;
                  if (!Array.isArray(e.messages)) return;
                  e.messages.push({
                    role: 'user',
                    content:
                      'Restored goal after compaction: "' +
                      state.objective +
                      '" (turn ' +
                      String(state.iterationCount) +
                      '). Continue it.',
                  });
                })
                .catch(() => undefined);
            } catch {
              // Never break host compaction.
            }
          })
          .catch(() => undefined);
        // Context injection: remind every model request of the active goal.
        await session
          .hook('context', (event: unknown) => {
            try {
              const e = event as { system?: unknown; sessionID?: unknown };
              // Fail closed: without a session id we inject nothing, so B can
              // never see A's goal through a session-less context event.
              if (typeof e.sessionID !== 'string' || e.sessionID === '') return;
              void loadGoalState(resolveStatePath(projectDir, e.sessionID))
                .then((state) => {
                  if (state === null || state.status !== 'active') return;
                  if (!Array.isArray(e.system)) return;
                  // Evidence nudge rides the context hook so bare completes get corrected.
                  const nudge = buildEvidenceNudge(
                    state.objective,
                    state.pendingVerification,
                  );
                  e.system.push({
                    type: 'text',
                    text: 'Active goal: "' + state.objective + '". ' + nudge,
                  });
                })
                .catch(() => undefined);
            } catch {
              // Never break the model request.
            }
          })
          .catch(() => undefined);
      }
    } catch {
      // Hook registration is best-effort on hosts without these hooks.
    }

    // Cleanup on unload: stop the event stream.
    return () => {
      try {
        controller.abort();
      } catch {
        // Abort is best-effort during unload.
      }
      try {
        // Clear tracked controllers so no stale listener survives unload.
        for (const c of idleAbortControllers) {
          try {
            c.abort();
          } catch {
            // Best-effort only.
          }
        }
        idleAbortControllers.clear();
      } catch {
        // Never throw during unload.
      }
      void idleTask.catch(() => undefined);
    };
  },
});
