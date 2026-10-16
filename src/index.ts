/**
 * Plugin entry Phase 2.
 * Why this file exists: single public surface for ESM plus CJS hosts.
 * Slash goal keeps Phase 1 guarded behavior, idle auto-continue is the new opt-in wiring.
 */
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
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
} from './goal.js';
import { handleSessionIdle } from './loop.js';
import { snapshotForCompaction, restoreAfterCompaction } from './compaction.js';
import { DEFAULT_LIMITS, STOP_FILE_NAME } from './limits.js';
import type { Limits } from './limits.js';

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
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal marked complete.';
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
 * Phase 1 stub kept for compatibility.
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
      // ENOENT means no kill switch. Any other error fails closed: the
      // idle handler maps the throw to stop-check-failed instead of ignoring STOP_GOAL.
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

const plugin = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  getAvailableHooks,
  handleGoalCommand,
  handleIdleStub,
  registerIdleHandler,
  defaultHasStopFile,
  registerCompactionHandler,
};

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
    // Opts guard first: bad input gets a reason, never a TypeError.
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

export default plugin;
