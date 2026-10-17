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
  SystemClock,
  loadGoalState,
  resolveStatePath,
  saveGoalState,
  tryClaimLease,
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
import { tryCompleteWithEvidence } from './verifier.js';
import { registerGoalTools } from './tools.js';
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
  const statePath = resolveStatePath(projectDir);
  let current: GoalState | null;
  try {
    current = await loadGoalState(statePath);
  } catch {
    // Corrupt JSON or shape mismatch: point at the file, do not throw.
    return (
      'Goal state is corrupt at ' +
      statePath +
      '. Back up the file then clear it.'
    );
  }
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
    // New objective resets counters and clears any stale lease.
    const next = setObjective(current, parsed.objective, clock, hostVersion);
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      // Save I/O errors report separately from transition errors.
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal set to active: ' + next.objective;
  }
  if (current === null) {
    return 'No goal set. Use /goal <objective> first.';
  }
  if (parsed.kind === 'block') {
    let next: GoalState;
    try {
      next = blockGoal(current, parsed.reason, clock);
    } catch {
      return (
        'Only an active goal can be blocked. Current status: ' +
        current.status +
        '.'
      );
    }
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal marked blocked: ' + parsed.reason;
  }
  if (parsed.kind === 'complete') {
    // Evidence gate: active goals need proof, blocked or done still report status.
    // Why order matters: legacy status error must surface first so existing
    // blocked-complete test keeps its message. Only active goals reach verifier.
    let next: GoalState;
    try {
      next = completeGoal(current, clock);
    } catch {
      return (
        'Only an active goal can complete. Current status: ' +
        current.status +
        '.'
      );
    }
    // Active path now requires evidence: missing proof blocks with friendly text.
    try {
      const ev = await loadEvidence(projectDir);
      const check = await tryCompleteWithEvidence({
        projectDir,
        evidence: ev,
      });
      if (!check.ok) {
        return (
          'Complete blocked: ' +
          check.reason +
          '. Add file citations plus passing tests to evidence.'
        );
      }
    } catch {
      // Verifier failure fails closed: do not mark complete without proof.
      return 'Complete blocked: verifier-error. Add evidence and retry.';
    }
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal marked complete.';
  }
  if (parsed.kind === 'resume') {
    // Resume a parked goal back to active after an explicit user request.
    let resumed: GoalState;
    try {
      resumed = resumeGoal(current, clock);
    } catch {
      return (
        'Only a parked goal can resume. Current status: ' + current.status + '.'
      );
    }
    try {
      await saveGoalState(statePath, resumed);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal resumed: ' + resumed.objective;
  }
  const cleared = clearGoal(current, clock);
  try {
    await saveGoalState(statePath, cleared);
  } catch (err) {
    return 'Failed to save goal state: ' + (err as Error).message;
  }
  return 'Goal cleared.';
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
    const statePath = resolveStatePath(opts.projectDir);
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
                  const statePath = resolveStatePath(projectDir);
                  const current = await loadGoalState(statePath).catch(
                    () => null,
                  );
                  const next = setObjective(
                    current,
                    parsed.objective,
                    clock,
                    '2.0.29',
                  );
                  await saveGoalState(statePath, next);
                  // Seed evidence shell so completion checks have a file from turn one.
                  await saveEvidence(
                    projectDir,
                    emptyEvidence(clock.nowMs()),
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
                const message = await handleGoalCommand(
                  '/goal ' + text,
                  projectDir,
                  clock,
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

    // Session-start resume: rearm any outstanding retry from file state.
    // Why no immediate send: a blind resume would bypass the lease and the
    // 20s cooldown. Rearm only, so the watchdog performs the guarded retry.
    void loadGoalState(resolveStatePath(projectDir))
      .then((st) => {
        if (st === null || st.status !== 'active') return;
        if (st.pendingAttempt === null) return;
        // Rearm the exact last real session. A missing id means no lane is
        // known yet, so skip: the next real event will rearm correctly.
        const lane =
          typeof st.lastSessionId === 'string' && st.lastSessionId.length > 0
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
              void loadGoalState(resolveStatePath(projectDir))
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
              const e = event as { system?: unknown };
              void loadGoalState(resolveStatePath(projectDir))
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
