/**
 * Session isolation regression tests for Task 10.
 * Why these tests exist: prove session B never sees or continues session A's
 * goal after the per-session storage fix. Each lane (slash, tools, idle,
 * evidence) gets one isolation assertion plus legacy migration plus sanitize.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { handleGoalCommand } from '../src/index.js';
import {
  loadGoalState,
  resolveStatePath,
  sanitizeSessionId,
} from '../src/state.js';
import {
  loadEvidence,
  resolveEvidencePath,
  saveEvidence,
  emptyEvidence,
} from '../src/evidence.js';
import { handleSessionIdle } from '../src/loop.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import type { Clock } from '../src/state.js';

/** Fixed clock keeps timestamps deterministic. */
class FakeClock implements Clock {
  nowMs(): number {
    return 1700000000000;
  }
}

describe('session isolation', () => {
  it('slash status in B shows no goal after A sets one', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-status-'));
    const clock = new FakeClock();
    await handleGoalCommand('/goal ship A', dir, clock, '2.0.29', 'sess-A');
    const b = await handleGoalCommand(
      '/goal status',
      dir,
      clock,
      '2.0.29',
      'sess-B',
    );
    expect(b).toContain('No goal set');
    const a = await handleGoalCommand(
      '/goal status',
      dir,
      clock,
      '2.0.29',
      'sess-A',
    );
    expect(a).toContain('ship A');
  });

  it('idle tick in B never continues A objective', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-idle-'));
    const clock = new FakeClock();
    await handleGoalCommand('/goal ship A', dir, clock, '2.0.29', 'sess-A');
    let sent = 0;
    const deps = {
      clock,
      limits: DEFAULT_LIMITS,
      ownerId: 'test',
      loadState: loadGoalState,
      saveState: (await import('../src/state.js')).saveGoalState,
      tryClaim: (await import('../src/state.js')).tryClaimLease,
      sendPrompt: async () => {
        sent += 1;
        return { success: true as const, messageId: 'm1' };
      },
      hasStopFile: async () => false,
    };
    const res = await handleSessionIdle(
      { projectDir: dir, lastMessageId: null, sessionId: 'sess-B' },
      deps,
    );
    expect(sent).toBe(0);
    expect(res.reason).toBe('no-state');
  });

  it('evidence written in A is invisible in B', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-ev-'));
    const clock = new FakeClock();
    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
    await handleGoalCommand('/goal ship A', dir, clock, '2.0.29', 'sess-A');
    const rec = await handleGoalCommand(
      '/goal evidence id=e1 claim=done files=proof.txt tests=npm test:0',
      dir,
      clock,
      '2.0.29',
      'sess-A',
    );
    expect(rec).toContain('Criterion recorded');
    const evB = await loadEvidence(dir, 'sess-B');
    expect(evB).toBeNull();
    const evA = await loadEvidence(dir, 'sess-A');
    expect(evA?.criteria.map((c) => c.id)).toEqual(['e1']);
  });

  it('legacy file migrates on next scoped write without sharing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-legacy-'));
    const clock = new FakeClock();
    // Old caller with no session writes the legacy file.
    await handleGoalCommand('/goal legacy goal', dir, clock);
    expect((await loadGoalState(resolveStatePath(dir)))?.objective).toBe(
      'legacy goal',
    );
    // New session B reads legacy via fallback, then its own write lands scoped.
    const statusB = await handleGoalCommand(
      '/goal status',
      dir,
      clock,
      '2.0.29',
      'sess-B',
    );
    expect(statusB).toContain('legacy goal');
    await handleGoalCommand(
      '/goal block waiting',
      dir,
      clock,
      '2.0.29',
      'sess-B',
    );
    const scopedB = await loadGoalState(resolveStatePath(dir, 'sess-B'));
    expect(scopedB?.status).toBe('blocked');
    const legacy = await loadGoalState(resolveStatePath(dir));
    expect(legacy?.status).toBe('active');
  });

  it('concurrent first writes on a legacy goal serialize', async () => {
    // Migrate-on-write: the scoped file does not exist and the state comes from
    // the legacy fallback, so the lease cannot serialize it. The dedicated lock
    // must let exactly one writer through and leave one consistent scoped file.
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-lock-'));
    const clock = new FakeClock();
    await handleGoalCommand('/goal legacy goal', dir, clock);
    const [a, b] = await Promise.all([
      handleGoalCommand(
        '/goal block reason one',
        dir,
        clock,
        '2.0.29',
        'sess-L',
      ),
      handleGoalCommand(
        '/goal block reason two',
        dir,
        clock,
        '2.0.29',
        'sess-L',
      ),
    ]);
    const results = [a, b];
    expect(
      results.filter((r) => r.includes('Goal marked blocked')).length,
    ).toBe(1);
    expect(results.filter((r) => /busy/i.test(r)).length).toBe(1);
    const scoped = await loadGoalState(resolveStatePath(dir, 'sess-L'));
    expect(scoped?.status).toBe('blocked');
  });
  it('sanitize blocks path traversal without throwing', async () => {
    expect(sanitizeSessionId('../../etc')).toMatch(/^sid-[0-9a-f]{8}$/);
    expect(sanitizeSessionId('sess-A')).toBe('sess-A');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-trav-'));
    const p = resolveStatePath(dir, '../../etc');
    expect(p.startsWith(path.join(dir, '.opencode', 'goals'))).toBe(true);
    expect(p).not.toContain('..');
    const ep = resolveEvidencePath(dir, '../../etc');
    expect(ep.startsWith(path.join(dir, '.opencode', 'goals'))).toBe(true);
  });

  it('scoped evidence save never writes the legacy path', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-evscope-'));
    await saveEvidence(
      dir,
      { ...emptyEvidence(1), criteria: [] },
      'sess-X',
    ).catch(() => undefined);
    // empty criteria still writes the shell; legacy file must stay absent.
    const { existsSync } = await import('node:fs');
    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
  });
});
