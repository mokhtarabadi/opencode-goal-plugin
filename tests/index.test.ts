/**
 * Command-level guards for handleGoalCommand.
 * Why these tests exist: prove friendly messages for bad input and corrupt state (QA F5 F6).
 */
import { mkdtempSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleGoalCommand } from '../src/index.js';
import type { Clock } from '../src/state.js';
import { resolveStatePath } from '../src/state.js';

/** Fixed clock keeps command timestamps deterministic. */
class FakeClock implements Clock {
  nowMs(): number {
    return 1700000000000;
  }
}

describe('handleGoalCommand guards', () => {
  it('handles non-string input without throw', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-guard-'));
    const got = await handleGoalCommand(
      null as unknown as string,
      dir,
      new FakeClock(),
    );
    expect(got).toContain('Invalid /goal usage');
  });
  it('handles bad project dir without throw', async () => {
    const got = await handleGoalCommand('/goal status', '', new FakeClock());
    expect(got).toContain('Invalid project directory');
  });
  it('reports corrupt state friendly', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-corrupt-cmd-'));
    const sp = resolveStatePath(dir);
    await fsp.mkdir(path.dirname(sp), { recursive: true });
    await fsp.writeFile(sp, '{bad', 'utf8');
    const got = await handleGoalCommand('/goal status', dir, new FakeClock());
    expect(got).toContain('corrupt');
  });
  it('reports blocked complete as status error not throw', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-blocked-'));
    const clock = new FakeClock();
    await handleGoalCommand('/goal build api', dir, clock);
    await handleGoalCommand('/goal block waiting', dir, clock);
    const got = await handleGoalCommand('/goal complete', dir, clock);
    expect(got).toContain('Only an active goal can complete');
  });
  it('reports save failure separately', async () => {
    // Read-only state dir: load succeeds, save fails with EACCES (QA F4).
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-savefail-'));
    const clock = new FakeClock();
    await handleGoalCommand('/goal ship it', dir, clock);
    await fsp.chmod(resolveStatePath(dir), 0o444);
    await fsp.chmod(path.dirname(resolveStatePath(dir)), 0o555);
    const got = await handleGoalCommand('/goal ship it again', dir, clock);
    await fsp.chmod(path.dirname(resolveStatePath(dir)), 0o755);
    expect(got).toContain('Failed to save goal state');
  });
});
