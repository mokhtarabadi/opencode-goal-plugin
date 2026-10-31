// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
/**
 * Watchdog timer for the idle-never-arrives stall.
 * Why this module exists: the idle-only trigger cannot wake the loop when the
 * host emits no further event after a crash. A bounded timer re-checks file
 * state, and every fire goes through the same lease claim plus token guard as
 * an idle tick, so a wake can never double-send.
 * The timer handle lives in memory only; the deadline and attempt count live
 * in file state so a restart can rearm.
 */
import type { Clock, GoalState } from './state.js';

/** Default watchdog deadline in ms: wake before the 120s lease TTL expires. */
export const DEFAULT_MAX_TURN_MS = 90000;

/** In-memory timer handles keyed by projectDir plus sessionId. */
const watchdogHandles = new Map<string, { timer: unknown }>();

/** Build the composite watchdog key. */
function watchdogKey(projectDir: string, sessionId: string): string {
  return projectDir + ':' + sessionId;
}

/**
 * Clear one watchdog timer if present.
 * @param projectDir project root
 * @param sessionId session lane id
 */
export function clearWatchdog(projectDir: string, sessionId: string): void {
  const key = watchdogKey(projectDir, sessionId);
  const entry = watchdogHandles.get(key);
  if (entry === undefined) return;
  try {
    // clearTimeout is tolerant of an already-fired or cleared handle.
    clearTimeout(entry.timer as ReturnType<typeof setTimeout>);
  } catch {
    // Clearing an expired handle is a no-op, never an error.
  }
  watchdogHandles.delete(key);
}

/**
 * Arm one watchdog timer for a session lane.
 * Why one per key: a second arm replaces the first so a lane never stacks
 * timers. The handle is unref'd when the runtime supports it so a pending
 * wake never keeps the process alive by itself.
 * @param projectDir project root
 * @param sessionId session lane id
 * @param deadlineMs absolute epoch ms after which the wake should fire
 * @param clock injected clock used only for the delay math
 * @param onFire async callback invoked once when the timer fires
 */
export function armWatchdog(
  projectDir: string,
  sessionId: string,
  deadlineMs: number,
  clock: Clock,
  onFire: () => Promise<void>,
): void {
  // Replace any existing timer for this lane so we never double-fire.
  clearWatchdog(projectDir, sessionId);
  const now = clock.nowMs();
  // Validate the deadline: a NaN, infinite, or negative value from corrupt
  // state must not tight-loop. Fall back to the default window from the clock.
  const safeDeadline =
    typeof deadlineMs === 'number' &&
    Number.isFinite(deadlineMs) &&
    deadlineMs >= 0
      ? deadlineMs
      : now + DEFAULT_MAX_TURN_MS;
  // Cap the delay to a sane minimum so a past deadline still wakes promptly.
  const delay = Math.max(1000, safeDeadline - now);
  // Bound the map: evict the oldest lane before adding a new one.
  if (
    watchdogHandles.size >= 500 &&
    !watchdogHandles.has(watchdogKey(projectDir, sessionId))
  ) {
    const oldest = watchdogHandles.keys().next();
    if (!oldest.done) watchdogHandles.delete(oldest.value);
  }
  const timer = setTimeout(() => {
    // Remove the handle first: the lane is no longer armed.
    watchdogHandles.delete(watchdogKey(projectDir, sessionId));
    void onFire().catch(() => undefined);
  }, delay);
  // unref keeps a parked wake from blocking process exit.
  const handle = timer as unknown as { unref?: () => void };
  if (typeof handle.unref === 'function') {
    handle.unref();
  }
  watchdogHandles.set(watchdogKey(projectDir, sessionId), { timer });
}

/**
 * Rearm a watchdog from persisted state when a retry is outstanding.
 * Why this exists: after a restart the in-memory timer is gone, but the
 * pending attempt and its deadline survive in the state file.
 * @param projectDir project root
 * @param sessionId session lane id
 * @param state current goal state
 * @param clock injected clock
 * @param onFire async callback invoked once when the timer fires
 */
export function rearmFromState(
  projectDir: string,
  sessionId: string,
  state: GoalState,
  clock: Clock,
  onFire: () => Promise<void>,
): void {
  const pending = state.pendingAttempt;
  // Guard null and undefined so a partial file never arms a timer.
  if (pending === null || pending === undefined) return;
  // Only rearm while the goal can still make progress.
  if (state.status !== 'active') return;
  armWatchdog(projectDir, sessionId, pending.deadlineMs, clock, onFire);
}

/**
 * Clear every armed watchdog timer.
 * Why public (not test-only): the plugin setup() cleanup uses this on unload
 * so watchdog timers never leak across host reloads.
 */
export function clearAllWatchdogs(): void {
  for (const entry of watchdogHandles.values()) {
    try {
      clearTimeout(entry.timer as ReturnType<typeof setTimeout>);
    } catch {
      // Best-effort cleanup only.
    }
  }
  watchdogHandles.clear();
}

/**
 * Reset all timers for tests only.
 */
export function _resetWatchdogsForTests(): void {
  clearAllWatchdogs();
}

/**
 * Read the count of armed watchdogs for diagnostics and tests.
 */
export function watchdogCount(): number {
  return watchdogHandles.size;
}
