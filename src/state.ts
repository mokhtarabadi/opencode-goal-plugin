/**
 * File-backed goal state for OpenCode V2 plugin Phase 1.
 * Why this module exists: memory is lost on compaction, file state survives.
 * All timestamps are UTC Unix epoch milliseconds. Clock is injected for tests.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Goal lifecycle status. Interrupted parks a goal after a user abort. */
export type GoalStatus =
  'active' | 'complete' | 'blocked' | 'cleared' | 'interrupted';

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

/**
 * Pending continuation attempt for crash and error recovery.
 * Why this field exists: a failed or interrupted send must be retryable and
 * survive a restart. Storing first plus last attempt time and count in file
 * state lets the watchdog and next tick resume without double counting turns.
 * All timestamps are UTC epoch ms from the injected Clock.
 */
export interface PendingAttempt {
  /** Epoch ms of the first attempt in this retry episode. */
  firstAttemptMs: number;
  /** Epoch ms of the most recent attempt. */
  lastAttemptMs: number;
  /** How many attempts have been made in this episode. */
  attemptCount: number;
  /** Deadline epoch ms after which the watchdog should wake the loop. */
  deadlineMs: number;
  /** Last classification: provider-error or user-abort or unknown. */
  reason: string;
}

/** Persisted goal state shape. Phase 2 adds turn tracking for the idle loop. */
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
  lastTurnAtMs: number;
  lastContinuedMessageId: string;
  restoreCount: number;
  evidencePath: string;
  evidenceHash: string | null;
  pendingVerification: boolean;
  verificationFailReason: string | null;
  revisionCount: number;
  /**
   * Wrap-up sent flag for budget exhaustion.
   * Why this field exists: goal-loop wrap-up-once-then-pause needs exactly
   * one final continuation after limits hit. False by default, optional on
   * disk so older files still load.
   */
  wrapupSent: boolean;
  /**
   * Pending continuation attempt for crash and error recovery.
   * Null when no retry is outstanding. Persisted so restart can rearm.
   */
  pendingAttempt: PendingAttempt | null;
  /** Epoch ms of the last successful heartbeat turn from the injected Clock. */
  lastHeartbeatMs: number;
  /** Consecutive provider failures, reset on a successful turn. */
  failureCount: number;
  /** Monotonic epoch bumped on abort or restart to invalidate stale work. */
  recoveryEpoch: number;
  /**
   * Last real session id that touched this goal.
   * Why this field exists: startup rearm must not invent a fake session lane.
   * Empty means unknown, so no watchdog is armed until a real event arrives.
   */
  lastSessionId: string;
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
export function initialState(
  objective: string,
  clock: Clock,
  hostVersion: string,
): GoalState {
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
    hostVersion,
    lastTurnAtMs: 0,
    lastContinuedMessageId: '',
    restoreCount: 0,
    evidencePath: '',
    evidenceHash: null,
    pendingVerification: false,
    verificationFailReason: null,
    revisionCount: 0,
    wrapupSent: false,
    pendingAttempt: null,
    lastHeartbeatMs: 0,
    failureCount: 0,
    recoveryEpoch: 0,
    lastSessionId: '',
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
  if (
    typeof v['objective'] !== 'string' ||
    (v['objective'] as string).length === 0
  )
    return false;
  if (
    v['status'] !== 'active' &&
    v['status'] !== 'complete' &&
    v['status'] !== 'blocked' &&
    v['status'] !== 'cleared' &&
    v['status'] !== 'interrupted'
  )
    return false;
  if (typeof v['iterationCount'] !== 'number') return false;
  if (typeof v['tokenSpend'] !== 'number') return false;
  if (typeof v['wallTimeMs'] !== 'number') return false;
  if (!(typeof v['leaseOwner'] === 'string' || v['leaseOwner'] === null))
    return false;
  if (typeof v['leaseExpiresAtMs'] !== 'number') return false;
  if (typeof v['lastSummary'] !== 'string') return false;
  if (typeof v['createdAtMs'] !== 'number') return false;
  if (typeof v['updatedAtMs'] !== 'number') return false;
  if (typeof v['hostVersion'] !== 'string') return false;
  // Phase 2 fields stay optional so Phase 1 files load, then normalize fills them.
  if ('lastTurnAtMs' in v && typeof v['lastTurnAtMs'] !== 'number')
    return false;
  if (
    'lastContinuedMessageId' in v &&
    typeof v['lastContinuedMessageId'] !== 'string'
  )
    return false;
  // Phase 3 fields stay optional so older files load, then normalize fills them.
  if ('restoreCount' in v && typeof v['restoreCount'] !== 'number')
    return false;
  if ('evidencePath' in v && typeof v['evidencePath'] !== 'string')
    return false;
  if (
    'evidenceHash' in v &&
    !(typeof v['evidenceHash'] === 'string' || v['evidenceHash'] === null)
  )
    return false;
  if (
    'pendingVerification' in v &&
    typeof v['pendingVerification'] !== 'boolean'
  )
    return false;
  if (
    'verificationFailReason' in v &&
    !(
      typeof v['verificationFailReason'] === 'string' ||
      v['verificationFailReason'] === null
    )
  )
    return false;
  if ('revisionCount' in v && typeof v['revisionCount'] !== 'number')
    return false;
  // Wrap-up flag stays optional so older files load, then normalize fills it.
  if ('wrapupSent' in v && typeof v['wrapupSent'] !== 'boolean') return false;
  // Recovery fields stay optional so older files load, then normalize fills them.
  if ('pendingAttempt' in v) {
    const pa = v['pendingAttempt'];
    if (pa !== null) {
      if (typeof pa !== 'object') return false;
      const p = pa as Record<string, unknown>;
      if (typeof p['firstAttemptMs'] !== 'number') return false;
      if (typeof p['lastAttemptMs'] !== 'number') return false;
      if (typeof p['attemptCount'] !== 'number') return false;
      if (typeof p['deadlineMs'] !== 'number') return false;
      if (typeof p['reason'] !== 'string') return false;
    }
  }
  if ('lastHeartbeatMs' in v && typeof v['lastHeartbeatMs'] !== 'number')
    return false;
  if ('failureCount' in v && typeof v['failureCount'] !== 'number')
    return false;
  if ('recoveryEpoch' in v && typeof v['recoveryEpoch'] !== 'number')
    return false;
  if ('lastSessionId' in v && typeof v['lastSessionId'] !== 'string')
    return false;
  return true;
}

/**
 * Fill Phase 2 defaults for Phase 1 files missing new fields.
 * @param input validated state possibly missing new fields
 */
export function normalizeState(input: GoalState): GoalState {
  // Nullish fallback fills runtime-undefined fields from older phase files.
  const wrap = (input as unknown as { wrapupSent?: unknown }).wrapupSent;
  return {
    ...input,
    lastTurnAtMs: input.lastTurnAtMs ?? 0,
    lastContinuedMessageId: input.lastContinuedMessageId ?? '',
    restoreCount: input.restoreCount ?? 0,
    evidencePath: input.evidencePath ?? '',
    evidenceHash: input.evidenceHash ?? null,
    pendingVerification: input.pendingVerification ?? false,
    verificationFailReason: input.verificationFailReason ?? null,
    revisionCount: input.revisionCount ?? 0,
    wrapupSent: typeof wrap === 'boolean' ? wrap : false,
    pendingAttempt: normalizePendingAttempt(
      (input as unknown as { pendingAttempt?: unknown }).pendingAttempt,
    ),
    lastHeartbeatMs:
      typeof (input as unknown as { lastHeartbeatMs?: unknown })
        .lastHeartbeatMs === 'number'
        ? ((input as unknown as { lastHeartbeatMs: number })
            .lastHeartbeatMs as number)
        : 0,
    failureCount:
      typeof (input as unknown as { failureCount?: unknown }).failureCount ===
      'number'
        ? ((input as unknown as { failureCount: number })
            .failureCount as number)
        : 0,
    recoveryEpoch:
      typeof (input as unknown as { recoveryEpoch?: unknown }).recoveryEpoch ===
      'number'
        ? ((input as unknown as { recoveryEpoch: number })
            .recoveryEpoch as number)
        : 0,
    lastSessionId:
      typeof (input as unknown as { lastSessionId?: unknown }).lastSessionId ===
      'string'
        ? ((input as unknown as { lastSessionId: string })
            .lastSessionId as string)
        : '',
  };
}

/**
 * Normalize a possibly-missing pendingAttempt field from an older file.
 * Why this helper exists: normalizeState needs a total conversion without
 * crashing on undefined, null, or a partial object from disk.
 * @param raw unknown pendingAttempt value
 */
function normalizePendingAttempt(raw: unknown): PendingAttempt | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  // Every field is required: a partial record is dropped, not trusted.
  if (typeof p['firstAttemptMs'] !== 'number') return null;
  if (typeof p['lastAttemptMs'] !== 'number') return null;
  if (typeof p['attemptCount'] !== 'number') return null;
  if (typeof p['deadlineMs'] !== 'number') return null;
  if (typeof p['reason'] !== 'string') return null;
  return {
    firstAttemptMs: p['firstAttemptMs'],
    lastAttemptMs: p['lastAttemptMs'],
    attemptCount: p['attemptCount'],
    deadlineMs: p['deadlineMs'],
    reason: p['reason'],
  };
}

/**
 * Load state from disk, return null if missing.
 * Quarantine-then-throw on corrupt bytes: torn JSON is preserved beside
 * the state file for audit, then the original error still surfaces so
 * callers keep the fail-closed behavior that existing tests assert.
 * @param statePath absolute path to goal-state.json
 */
export async function loadGoalState(
  statePath: string,
): Promise<GoalState | null> {
  let raw: string;
  try {
    // Read raw file, missing file means no active goal, not an error.
    raw = await fs.readFile(statePath, 'utf8');
  } catch (err: unknown) {
    // ENOENT maps to null so callers handle first-run cleanly.
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
  let parsed: unknown;
  try {
    // Parse may throw on torn writes: quarantine before surfacing.
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    // Preserve corrupt bytes for forensics, then fail closed.
    await quarantineCorruptState(statePath);
    throw err;
  }
  if (!isValidState(parsed)) {
    // Shape mismatch also quarantines: partial objects must not clobber truth.
    await quarantineCorruptState(statePath);
    throw new Error('corrupt goal state at ' + statePath);
  }
  // Normalize so Phase 1 files gain Phase 2 turn-tracking defaults.
  return normalizeState(parsed);
}

/** Module-level counter so parallel tmp files never collide in one process. */
let tmpCounter = 0;

/** Module-level counter for corrupt quarantine suffixes without Clock. */
let corruptCounter = 0;

/**
 * Fsync a file path best-effort without breaking the save path.
 * Why this helper exists: crash durability needs the tmp payload on disk
 * before rename publishes it. Failures are swallowed because the rename
 * still preserves atomicity even when the OS denies fsync.
 * @param tmpPath absolute tmp file path just written
 */
async function fsyncFileBestEffort(tmpPath: string): Promise<void> {
  try {
    // Open read handle then sync: ensures payload hits durable storage.
    const fh = await fs.open(tmpPath, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // Fsync unavailable on this FS: atomic rename still holds.
  }
}

/**
 * Fsync a directory best-effort so the rename entry itself is durable.
 * Why this helper exists: POSIX rename durability needs a directory sync.
 * @param dirPath absolute directory containing the state file
 */
async function fsyncDirBestEffort(dirPath: string): Promise<void> {
  try {
    // Directory sync persists the rename entry across a crash.
    const dh = await fs.open(dirPath, 'r');
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  } catch {
    // Directory fsync unsupported (e.g. Windows): safe to ignore.
  }
}

/**
 * Quarantine a corrupt state file without losing forensic bytes.
 * Why this helper exists: prevalentWare pattern quarantine-don't-clobber
 * keeps torn JSON for audit instead of overwriting it with fresh state.
 * Uses pid plus counter suffix so no Clock is needed here.
 * @param statePath absolute path to goal-state.json
 */
async function quarantineCorruptState(statePath: string): Promise<void> {
  try {
    // Unique suffix per process plus counter avoids collisions.
    corruptCounter += 1;
    const dest =
      statePath +
      '.corrupt-' +
      String(process.pid) +
      '-' +
      String(corruptCounter);
    try {
      // Rename preserves bytes for post-mortem; copy fallback covers EXDEV.
      await fs.rename(statePath, dest);
    } catch {
      try {
        const raw = await fs.readFile(statePath, 'utf8');
        await fs.writeFile(dest, raw, 'utf8');
      } catch {
        // Quarantine is best-effort: original throw below still surfaces.
      }
    }
  } catch {
    // Never let quarantine mask the original corrupt error.
  }
}

/**
 * Atomically save state via tmp plus rename with durability hardening.
 * Why this hardening exists: plain write plus rename can leave truncated
 * truth after a crash. Fsync plus chmod 0600 plus dir fsync closes that
 * gap while keeping the tmp plus rename order that 76 tests rely on.
 * @param statePath absolute path to goal-state.json
 * @param state state to persist
 */
export async function saveGoalState(
  statePath: string,
  state: GoalState,
): Promise<void> {
  // Ensure parent dir exists for first-run scaffold.
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  // Unique tmp name per call: parallel writers in one process must not share a tmp file.
  tmpCounter += 1;
  const tmpPath = statePath + '.' + process.pid + '.' + tmpCounter + '.tmp';
  // Write tmp then fsync then chmod then rename gives durable atomic publish.
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  // Harden payload to disk before publish; best-effort on exotic FS.
  await fsyncFileBestEffort(tmpPath);
  try {
    // Restrict state file to owner: goal text can carry sensitive plans.
    await fs.chmod(tmpPath, 0o600);
  } catch {
    // Chmod unsupported: rename still preserves atomicity.
  }
  await fs.rename(tmpPath, statePath);
  // Persist the directory entry so the rename survives a crash.
  await fsyncDirBestEffort(path.dirname(statePath));
  try {
    // Mirror owner-only mode on the final path for umask-robustness.
    await fs.chmod(statePath, 0o600);
  } catch {
    // Non-POSIX FS: mode hardening is optional.
  }
}

/**
 * Try to acquire the claim lock file with exclusive create (atomic on POSIX).
 * Stale locks older than ttlMs are reclaimed so a crashed run cannot hold the loop forever.
 * Fail-closed: any unreadable lock, failed unlink, or failed reacquire denies
 * progress (returns false). No path proceeds without holding the lock.
 */
async function acquireClaimLock(
  lockPath: string,
  owner: string,
  ttlMs: number,
  clock: Clock,
): Promise<boolean> {
  const now = clock.nowMs();
  try {
    // wx flag fails with EEXIST when another run holds the lock: atomic mutex.
    await fs.writeFile(lockPath, JSON.stringify({ owner, at: now }), {
      flag: 'wx',
    });
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
        await fs.writeFile(lockPath, JSON.stringify({ owner, at: now }), {
          flag: 'wx',
        });
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
  clock: Clock,
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
      const held =
        current.leaseOwner !== null &&
        current.leaseExpiresAtMs > now &&
        current.leaseOwner !== owner;
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
      updatedAtMs: now,
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
export async function releaseLease(
  statePath: string,
  owner: string,
  clock: Clock,
): Promise<void> {
  const current = await loadGoalState(statePath);
  if (current === null) return;
  // Only owner can release, prevents clearing another run's lease.
  if (current.leaseOwner !== owner) return;
  const next: GoalState = {
    ...current,
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs(),
  };
  await saveGoalState(statePath, next);
}
