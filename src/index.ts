/**
 * Plugin entry for opencode-goal-plugin Phase 1.
 * Why this file exists: single public surface for ESM plus CJS hosts.
 * Phase 1 handles slash goal set and status only, no idle auto-continue.
 */
import { SystemClock, loadGoalState, resolveStatePath, saveGoalState } from './state.js';
import type { Clock, GoalState } from './state.js';
import { blockGoal, clearGoal, completeGoal, parseGoalCommand, setObjective } from './goal.js';

export const PLUGIN_NAME = 'opencode-goal-plugin';
export const PLUGIN_VERSION = '0.1.0';

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
 * Every failure returns a friendly string: invalid input, bad directory,
 * corrupt state, wrong-status transitions, and save failures each report
 * their own cause instead of throwing or masking each other.
 * @param rawInput raw input like /goal ship feature
 * @param projectDir project root containing .opencode dir
 * @param clock injected clock, defaults to SystemClock
 * @param hostVersion host version string for audit
 */
export async function handleGoalCommand(
  rawInput: string,
  projectDir: string,
  clock: Clock = new SystemClock(),
  hostVersion: string = '2.0.29'
): Promise<string> {
  // Type guards first: a misbehaving host must get a message, never a TypeError.
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
    return 'Goal state is corrupt at ' + statePath + '. Back up the file then clear it.';
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
      return 'Only an active goal can be blocked. Current status: ' + current.status + '.';
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
      return 'Only an active goal can complete. Current status: ' + current.status + '.';
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
 * Phase 1 idle stub. Always returns not-implemented so no loop runs yet.
 */
export function handleIdleStub(): string {
  return 'phase2-not-implemented';
}

const plugin = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  getAvailableHooks,
  handleGoalCommand,
  handleIdleStub
};

export default plugin;
