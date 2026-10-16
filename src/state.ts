/**
 * File-backed goal state for OpenCode V2 plugin Phase 1.
 * Why this module exists: memory is lost on compaction, file state survives.
 * All timestamps are UTC Unix epoch milliseconds. Clock is injected for tests.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Goal lifecycle status. */
export type GoalStatus = 'active' | 'complete' | 'blocked' | 'cleared';

/** Clock abstraction to keep business logic mockable. */
export interface Clock {
  nowMs(): number;
}

/** Production clock using wall time in one place only. */
export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}

/** Persisted goal state shape. */
export interface GoalState {
  objective: string;
  status: GoalStatus;
  iterationCount: number;
  tokenSpend: number;
  wallTimeMs: number;
  leaseOwner: string | null;
  leaseExpiresAtMs: number;
  lastSummary: string;
  createdAtMs: number;
  updatedAtMs: number;
  hostVersion: string;
}

export const STATE_FILENAME = 'goal-state.json';
export const LEASE_TTL_MS = 120000;

/**
 * Resolve state file path inside project dir.
 * @param projectDir project root containing .opencode dir
 */
export function resolveStatePath(projectDir: string): string {
  // Inline path join keeps storage layout explicit and testable.
  return path.join(projectDir, '.opencode', STATE_FILENAME);
}

/**
 * Create a fresh state for a new objective.
 * @param objective trimmed objective text, must be non-empty
 * @param clock injected clock for timestamps
 * @param hostVersion host version string for compat audit
 */
export function initialState(objective: string, clock: Clock, hostVersion: string): GoalState {
  // Validate early so invalid objectives never reach disk.
  const trimmed = objective.trim();
  if (trimmed.length === 0) {
    throw new Error('objective must be non-empty');
  }
  const now = clock.nowMs();
  return {
    objective: trimmed,
    status: 'active',
    iterationCount: 0,
    tokenSpend: 0,
    wallTimeMs: 0,
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    lastSummary: '',
    createdAtMs: now,
    updatedAtMs: now,
    hostVersion
  };
}

/**
 * Validate parsed state shape against every persisted field.
 * Strictness matters: a partial object that passes validation would later
 * crash arithmetic on undefined counters, so every field is checked.
 * @param value unknown JSON value
 */
function isValidState(value: unknown): value is GoalState {
  // Explicit field checks prevent corrupt files from crashing the loop.
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['objective'] !== 'string' || (v['objective'] as string).length === 0) return false;
  if (v['status'] !== 'active' && v['status'] !== 'complete' && v['status'] !== 'blocked' && v['status'] !== 'cleared') return false;
  if (typeof v['iterationCount'] !== 'number') return false;
  if (typeof v['tokenSpend'] !== 'number') return false;
  if (typeof v['wallTimeMs'] !== 'number') return false;
  if (!(typeof v['leaseOwner'] === 'string' || v['leaseOwner'] === null)) return false;
  if (typeof v['leaseExpiresAtMs'] !== 'number') return false;
  if (typeof v['lastSummary'] !== 'string') return false;
  if (typeof v['createdAtMs'] !== 'number') return false;
  if (typeof v['updatedAtMs'] !== 'number') return false;
  if (typeof v['hostVersion'] !== 'string') return false;
  return true;
}

/**
 * Load state from disk, return null if missing.
 * @param statePath absolute path to goal-state.json
 */
export async function loadGoalState(statePath: string): Promise<GoalState | null> {
  try {
    // Read raw file, missing file means no active goal, not an error.
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isValidState(parsed)) {
      throw new Error('corrupt goal state at ' + statePath);
    }
    return parsed;
  } catch (err: unknown) {
    // ENOENT maps to null so callers handle first-run cleanly.
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

/** Module-level counter so parallel tmp files never collide in one process. */
let tmpCounter = 0;

/**
 * Atomically save state via tmp plus rename.
 * @param statePath absolute path to goal-state.json
 * @param state state to persist
 */
export async function saveGoalState(statePath: string, state: GoalState): Promise<void> {
  // Ensure parent dir exists for first-run scaffold.
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  // Unique tmp name per call: parallel writers in one process must not share a tmp file.
  tmpCounter += 1;
  const tmpPath = statePath + '.' + process.pid + '.' + tmpCounter + '.tmp';
  // Write tmp then rename gives atomic replacement on POSIX.
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmpPath, statePath);
}

/**
 * Try to acquire the claim lock file with exclusive create (atomic on POSIX).
 * Stale locks older than ttlMs are reclaimed so a crashed run cannot hold the loop forever.
 */
async function acquireClaimLock(lockPath: string, owner: string, ttlMs: number, clock: Clock): Promise<boolean> {
  const now = clock.nowMs();
  try {
    // wx flag fails with EEXIST when another run holds the lock: atomic mutex.
    await fs.writeFile(lockPath, JSON.stringify({ owner, at: now }), { flag: 'wx' });
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== 'EEXIST') throw err;
    // Contender holds the lock: reclaim only when provably stale.
    try {
      const raw = await fs.readFile(lockPath, 'utf8');
      const parsed = JSON.parse(raw) as { at?: unknown };
      if (typeof parsed.at === 'number' && now - parsed.at > ttlMs) {
        await fs.unlink(lockPath);
        await fs.writeFile(lockPath, JSON.stringify({ owner, at: now }), { flag: 'wx' });
        return true;
      }
    } catch {
      // Unreadable lock means another live run owns it: loser exits quietly.
    }
    return false;
  }
}

/**
 * Try to claim execution lease. Only one owner wins.
 * @param statePath absolute path to state file
 * @param owner unique owner id for this run
 * @param ttlMs lease time to live in ms
 * @param clock injected clock
 */
export async function tryClaimLease(
  statePath: string,
  owner: string,
  ttlMs: number,
  clock: Clock
): Promise<{ claimed: boolean; state: GoalState | null }> {
  // Short-lived lock file serializes parallel claimants in and across processes.
  const lockPath = statePath + '.lock';
  const locked = await acquireClaimLock(lockPath, owner, ttlMs, clock);
  if (!locked) {
    // Another live run holds the claim lock, loser exits quietly.
    const current = await loadGoalState(statePath);
    return { claimed: false, state: current };
  }
  try {
    // Load-modify-write under the lock plus lease-expiry check gives single-flight.
    const current = await loadGoalState(statePath);
    const now = clock.nowMs();
    if (current !== null) {
      const held = current.leaseOwner !== null && current.leaseExpiresAtMs > now && current.leaseOwner !== owner;
      if (held) {
        return { claimed: false, state: current };
      }
    }
    if (current === null) {
      return { claimed: false, state: null };
    }
    const next: GoalState = {
      ...current,
      leaseOwner: owner,
      leaseExpiresAtMs: now + ttlMs,
      updatedAtMs: now
    };
    await saveGoalState(statePath, next);
    return { claimed: true, state: next };
  } finally {
    // Always release the short-lived lock so the next idle turn can proceed.
    try {
      await fs.unlink(lockPath);
    } catch {
      // Lock already gone (reclaimed as stale elsewhere): safe to ignore.
    }
  }
}

/**
 * Release lease held by owner.
 * @param statePath absolute path to state file
 * @param owner owner id to release
 * @param clock injected clock
 */
export async function releaseLease(statePath: string, owner: string, clock: Clock): Promise<void> {
  const current = await loadGoalState(statePath);
  if (current === null) return;
  // Only owner can release, prevents clearing another run's lease.
  if (current.leaseOwner !== owner) return;
  const next: GoalState = {
    ...current,
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs()
  };
  await saveGoalState(statePath, next);
}
