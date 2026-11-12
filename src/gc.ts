// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
/**
 * Stale goal garbage collection.
 * Why this module exists: every session lane owns one goal file under
 * `.opencode/goals/`, so a long-lived workspace accumulates files for
 * sessions that ended days ago. Each of them still looks like live work to
 * the startup scan, and an abandoned lane with a pending attempt keeps
 * re-arming the watchdog forever. This module reclaims the abandoned files
 * and records every collection so a wrongly collected goal can be recovered.
 * The pass is deliberately conservative: it never touches the current
 * session, it never touches an active goal it cannot prove abandoned, it
 * never destroys a file it cannot read, and it never deletes bytes it
 * cannot recover.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  goalFileStem,
  loadGoalState,
  resolveStateDir,
  sanitizeSessionId,
} from './state.js';
import type { Clock, GoalState } from './state.js';
import { STALE_GOAL_MAX_AGE_MS } from './limits.js';

/** Name of the collection log inside the runtime state dir. */
export const GC_LOG_FILE_NAME = 'goal-gc.log';

/**
 * Why one candidate was left in place.
 * Every reason is explicit so the operator can tell a fresh goal from a
 * protected one and from a file the pass could not read.
 */
export type GcSkipReason =
  /** The file belongs to the session the plugin is currently serving. */
  | 'current-session'
  /** The file is younger than the stale threshold. */
  | 'fresh'
  /** The goal is active but the current session is not known yet. */
  | 'active-unknown-session'
  /** The goal is active and holds a live lease, so its lane is working. */
  | 'leased'
  /** The file could not be read as a goal state. */
  | 'unreadable';

/** One goal file the pass decided to collect. */
export interface CollectedGoal {
  /** Lane id the file belongs to. */
  lane: string;
  /** Absolute path of the file before the collection. */
  path: string;
  /** Absolute path the file was archived to. */
  archivedPath: string;
  /** Age of the file in ms at collection time. */
  ageMs: number;
  /** Goal status recorded in the file. */
  status: string;
}

/** One goal file the pass left in place, with the reason why. */
export interface SkippedGoal {
  /** Lane id the file belongs to. */
  lane: string;
  /** Absolute path of the file that was left alone. */
  path: string;
  /** Why the file was not collected. */
  reason: GcSkipReason;
}

/** Outcome of one garbage collection pass. */
export interface GcResult {
  /** How many goal files the pass looked at. */
  scanned: number;
  /** Files the pass collected, oldest first by scan order. */
  collected: CollectedGoal[];
  /** Files the pass left in place. */
  skipped: SkippedGoal[];
}

/** Options for one garbage collection pass. */
export interface GcOptions {
  /**
   * Session id the plugin is currently serving.
   * Why it matters: the goal of the running session is never collected, not
   * even when it is older than the threshold. When it is unknown the pass
   * refuses to collect any active goal, because it cannot prove that goal
   * is abandoned.
   */
  currentSessionId?: string | null;
  /** Staleness window in ms. Defaults to STALE_GOAL_MAX_AGE_MS. */
  maxAgeMs?: number;
  /** Sink for the collection log. Defaults to the runtime log file. */
  log?: (line: string) => void;
}

/**
 * Append one line to the collection log inside the runtime state dir.
 * Why a file and not the console: the log has to survive the process, and
 * the runtime state dir is already gitignored, so it never lands in a diff.
 * @param projectDir project root containing the .opencode dir
 * @param line the log line to append
 */
async function appendGcLog(projectDir: string, line: string): Promise<void> {
  try {
    const logPath = path.join(projectDir, '.opencode', GC_LOG_FILE_NAME);
    // First run in a fresh workspace: create the runtime state dir.
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, line + '\n', 'utf8');
  } catch {
    // Logging is best-effort: a failed log never blocks a collection.
  }
}

/**
 * Build the default log sink for one project dir.
 * Why a factory and not a module global: the sink closes over the project
 * dir, so two projects never write into each other's log.
 * @param projectDir project root containing the .opencode dir
 */
function defaultGcLogger(projectDir: string): (line: string) => void {
  return (line: string) => {
    // Fire and forget: the pass must not wait on a log write.
    void appendGcLog(projectDir, line);
  };
}

/**
 * Collect abandoned per-session goal files.
 * Why the pass archives instead of deleting: a wrongly collected goal must
 * be recoverable, and the runtime state dir is gitignored, so git history
 * cannot bring it back. The file is renamed out of the scan instead, which
 * keeps every byte and still stops the lane from waking the loop.
 * Why the guards, in order:
 * 1. the current session is never touched, whatever its age says;
 * 2. a file younger than the threshold is never touched;
 * 3. a goal that cannot be read is never touched, because the pass cannot
 *    tell an abandoned file from a valuable one it fails to parse;
 * 4. an active goal is only collected when the current session is known and
 *    the goal belongs to another lane, or when its lane holds no live lease;
 * 5. a live lease means the lane is working right now, so it is left alone.
 * @param projectDir project root containing the .opencode dir
 * @param clock injected clock, the only source of current time
 * @param opts current session, staleness window, and log sink
 */
export async function collectStaleGoalFiles(
  projectDir: string,
  clock: Clock,
  opts: GcOptions = {},
): Promise<GcResult> {
  const result: GcResult = { scanned: 0, collected: [], skipped: [] };
  const maxAgeMs = opts.maxAgeMs ?? STALE_GOAL_MAX_AGE_MS;
  const log = opts.log ?? defaultGcLogger(projectDir);
  const now = clock.nowMs();
  const goalsDir = resolveStateDir(projectDir);
  let names: string[];
  try {
    names = await fs.readdir(goalsDir);
  } catch {
    // No goals dir yet: there is nothing to collect and nothing to fail.
    return result;
  }
  // The current lane is compared in its sanitized form, because that is how
  // the file name is built.
  const currentLane =
    typeof opts.currentSessionId === 'string' &&
    opts.currentSessionId.trim().length > 0
      ? sanitizeSessionId(opts.currentSessionId)
      : null;
  for (const name of names) {
    // Only a real goal file is a candidate: the evidence sidecar, the claim
    // lock, and an interrupted tmp write are all left alone.
    const lane = goalFileStem(name);
    if (lane === null) continue;
    const filePath = path.join(goalsDir, name);
    result.scanned += 1;
    // Guard 1: the running session keeps its goal, always.
    if (currentLane !== null && lane === currentLane) {
      result.skipped.push({ lane, path: filePath, reason: 'current-session' });
      continue;
    }
    let ageMs: number;
    try {
      const stat = await fs.stat(filePath);
      // A directory in the goals dir is not a goal file.
      if (!stat.isFile()) continue;
      ageMs = now - stat.mtimeMs;
    } catch {
      result.skipped.push({ lane, path: filePath, reason: 'unreadable' });
      continue;
    }
    // Guard 2: a young file is live work, never garbage.
    if (ageMs <= maxAgeMs) {
      result.skipped.push({ lane, path: filePath, reason: 'fresh' });
      continue;
    }
    let state: GoalState | null;
    try {
      state = await loadGoalState(filePath);
    } catch {
      // Guard 3: a file the pass cannot read is a file it must not destroy.
      result.skipped.push({ lane, path: filePath, reason: 'unreadable' });
      continue;
    }
    if (state === null) {
      result.skipped.push({ lane, path: filePath, reason: 'unreadable' });
      continue;
    }
    if (state.status === 'active') {
      // Guard 4: without a known current session the pass cannot prove that
      // an active goal is abandoned, so it leaves every active goal alone.
      if (currentLane === null) {
        result.skipped.push({
          lane,
          path: filePath,
          reason: 'active-unknown-session',
        });
        continue;
      }
      // Guard 5: a live lease means the lane is working right now.
      if (state.leaseExpiresAtMs > now) {
        result.skipped.push({ lane, path: filePath, reason: 'leased' });
        continue;
      }
    }
    // Collect: rename out of the scan, keeping every byte for recovery.
    const archivedPath = filePath + '.gc-' + String(now);
    try {
      await fs.rename(filePath, archivedPath);
    } catch {
      result.skipped.push({ lane, path: filePath, reason: 'unreadable' });
      continue;
    }
    const collected: CollectedGoal = {
      lane,
      path: filePath,
      archivedPath,
      ageMs,
      status: state.status,
    };
    result.collected.push(collected);
    // Every collection is logged with its path: the log plus the archived
    // file is what makes a wrongly collected goal recoverable.
    log(
      'goal-gc collected ' +
        filePath +
        ' -> ' +
        archivedPath +
        ' (lane ' +
        lane +
        ', age ' +
        String(ageMs) +
        'ms, status ' +
        state.status +
        ')',
    );
  }
  return result;
}
