/**
 * Stale goal garbage collection tests.
 * Why these tests exist: abandoned per-session goal files kept re-arming the
 * watchdog forever, so the idle loop woke for lanes that ended days ago.
 * These tests pin the conservative collect rules, the collection log, and
 * the shared fresh-pending helper the startup rearm uses.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectStaleGoalFiles, isFreshPendingAttempt } from '../src/gc.js';
import { STALE_GOAL_MAX_AGE_MS } from '../src/limits.js';
import { initialState, resolveStatePath, saveGoalState } from '../src/state.js';
import type { Clock, GoalState } from '../src/state.js';

/** Fixed clock with mutable now for age math. */
class FakeClock implements Clock {
  constructor(public now: number) {}
  nowMs(): number {
    return this.now;
  }
}

const T0 = 1700000000000;
let projectDir = '';

async function makeProject(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-gc-'));
  projectDir = base;
  return base;
}

async function writeState(
  sessionId: string,
  over: Partial<GoalState>,
  clock: FakeClock,
): Promise<string> {
  const state = { ...initialState('stale probe', clock, '2.0.29'), ...over };
  const filePath = resolveStatePath(projectDir, sessionId);
  await saveGoalState(filePath, state);
  return filePath;
}

async function ageFile(
  filePath: string,
  ageMs: number,
  clock: FakeClock,
): Promise<void> {
  const mtime = new Date(clock.nowMs() - ageMs);
  await fs.utimes(filePath, mtime, mtime);
}

beforeEach(async () => {
  await makeProject();
});

afterEach(async () => {
  if (projectDir !== '') {
    await fs.rm(projectDir, { recursive: true, force: true });
    projectDir = '';
  }
});

describe('isFreshPendingAttempt', () => {
  it('accepts a recent attempt inside the window', () => {
    expect(isFreshPendingAttempt(T0 - 1000, T0, STALE_GOAL_MAX_AGE_MS)).toBe(
      true,
    );
  });

  it('rejects an attempt older than the stale threshold', () => {
    expect(
      isFreshPendingAttempt(
        T0 - STALE_GOAL_MAX_AGE_MS - 1,
        T0,
        STALE_GOAL_MAX_AGE_MS,
      ),
    ).toBe(false);
  });

  it('rejects a future stamp and a non-finite stamp', () => {
    expect(isFreshPendingAttempt(T0 + 1000, T0, STALE_GOAL_MAX_AGE_MS)).toBe(
      false,
    );
    expect(isFreshPendingAttempt(NaN, T0, STALE_GOAL_MAX_AGE_MS)).toBe(false);
  });
});

describe('collectStaleGoalFiles', () => {
  it('returns empty when no goals dir exists', async () => {
    const clock = new FakeClock(T0);
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: () => undefined,
    });
    expect(result.scanned).toBe(0);
    expect(result.collected).toEqual([]);
  });

  it('leaves a fresh file alone', async () => {
    const clock = new FakeClock(T0);
    const filePath = await writeState(
      'sess-fresh',
      { status: 'complete' },
      clock,
    );
    await ageFile(filePath, 1000, clock);
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: () => undefined,
    });
    expect(result.scanned).toBe(1);
    expect(result.collected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('fresh');
  });

  it('collects an old completed file and logs the path', async () => {
    const clock = new FakeClock(T0);
    const filePath = await writeState(
      'sess-old',
      { status: 'complete' },
      clock,
    );
    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
    const lines: string[] = [];
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: (line) => lines.push(line),
    });
    expect(result.collected.length).toBe(1);
    expect(result.collected[0]?.path).toBe(filePath);
    expect(lines.join('\n')).toContain(filePath);
    // Collected by rename: the original path is gone, the archive remains.
    await expect(fs.stat(filePath)).rejects.toBeDefined();
    await expect(
      fs.stat(String(result.collected[0]?.archivedPath)),
    ).resolves.toBeDefined();
  });

  it('never touches the current session even when old', async () => {
    const clock = new FakeClock(T0);
    const filePath = await writeState(
      'sess-now',
      { status: 'active', leaseExpiresAtMs: 0 },
      clock,
    );
    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: () => undefined,
    });
    expect(result.collected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('current-session');
  });

  it('leaves an active goal alone when the current session is unknown', async () => {
    const clock = new FakeClock(T0);
    const filePath = await writeState(
      'sess-active',
      { status: 'active', leaseExpiresAtMs: 0 },
      clock,
    );
    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: null,
      log: () => undefined,
    });
    expect(result.collected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('active-unknown-session');
  });

  it('leaves a leased active lane alone', async () => {
    const clock = new FakeClock(T0);
    const filePath = await writeState(
      'sess-leased',
      {
        status: 'active',
        leaseOwner: 'owner-live',
        leaseExpiresAtMs: T0 + 60000,
      },
      clock,
    );
    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: () => undefined,
    });
    expect(result.collected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('leased');
  });

  it('leaves an unreadable file alone', async () => {
    const clock = new FakeClock(T0);
    const goalsDir = path.join(projectDir, '.opencode', 'goals');
    await fs.mkdir(goalsDir, { recursive: true });
    const badPath = path.join(goalsDir, 'sess-bad.json');
    await fs.writeFile(badPath, '{not-json', 'utf8');
    await ageFile(badPath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: () => undefined,
    });
    expect(result.collected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('unreadable');
  });

  it('ignores the evidence sidecar and lock files', async () => {
    const clock = new FakeClock(T0);
    const goalsDir = path.join(projectDir, '.opencode', 'goals');
    await fs.mkdir(goalsDir, { recursive: true });
    await fs.writeFile(
      path.join(goalsDir, 'sess-now.evidence.json'),
      '{"criteria":[]}',
      'utf8',
    );
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: () => undefined,
    });
    expect(result.scanned).toBe(0);
  });
});

describe('stale active lanes regression', () => {
  it('collects an old active file from another session with cleared lease', async () => {
    const clock = new FakeClock(T0);
    const filePath = await writeState(
      'sess-stale-active',
      { status: 'active', leaseExpiresAtMs: 0 },
      clock,
    );
    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: () => undefined,
    });
    expect(result.collected.map((c) => c.path)).toContain(filePath);
  });

  it('collects an old interrupted file from another session', async () => {
    const clock = new FakeClock(T0);
    const filePath = await writeState(
      'sess-stale-interrupted',
      { status: 'interrupted', leaseExpiresAtMs: 0 },
      clock,
    );
    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: () => undefined,
    });
    expect(result.collected.map((c) => c.path)).toContain(filePath);
  });

  it('collects an old active file with expired lease', async () => {
    const clock = new FakeClock(T0);
    const filePath = await writeState(
      'sess-expired-lease',
      {
        status: 'active',
        leaseOwner: 'owner-dead',
        leaseExpiresAtMs: T0 - 1000,
      },
      clock,
    );
    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
    const result = await collectStaleGoalFiles(projectDir, clock, {
      currentSessionId: 'sess-now',
      log: () => undefined,
    });
    expect(result.collected.map((c) => c.path)).toContain(filePath);
  });
});

describe('isFreshPendingAttempt boundaries', () => {
  it('accepts an attempt exactly at the threshold', () => {
    expect(
      isFreshPendingAttempt(
        T0 - STALE_GOAL_MAX_AGE_MS,
        T0,
        STALE_GOAL_MAX_AGE_MS,
      ),
    ).toBe(true);
  });

  it('rejects non-finite maxAge', () => {
    expect(isFreshPendingAttempt(T0 - 1000, T0, NaN)).toBe(false);
    expect(isFreshPendingAttempt(T0 - 1000, T0, Infinity)).toBe(false);
  });
});
