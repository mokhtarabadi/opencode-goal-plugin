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
  it('slash complete serializes on the lease instead of racing', async () => {
    // Regression: slash completion now runs real proof commands, so it must hold
    // the lease for the whole pass. Two concurrent completes must not both win.
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-slash-lease-'));
    const clock = new FakeClock();
    await handleGoalCommand('/goal finish it', dir, clock);
    await fsp.writeFile(path.join(dir, 'proof.txt'), 'done\n', 'utf8');
    const cases = [
      'id=e1 claim=one files=proof.txt tests=node -e "process.exit(0)":0',
      'id=e2 claim=two files=proof.txt tests=node -e "process.exit(0)":0',
    ];
    for (const args of cases) {
      const out = await handleGoalCommand('/goal evidence ' + args, dir, clock);
      expect(out).toContain('Criterion recorded');
    }
    const [first, second] = await Promise.all([
      handleGoalCommand('/goal complete', dir, clock),
      handleGoalCommand('/goal complete', dir, clock),
    ]);
    const results = [first, second];
    const wins = results.filter((r) => r === 'Goal marked complete.');
    const busy = results.filter((r) => /busy/i.test(r));
    // Exactly one winner and one contention result: no lost update, no double.
    expect(wins.length).toBe(1);
    expect(busy.length).toBe(1);
  });
  it('slash complete releases the lease on a blocked verdict', async () => {
    // A failed proof must not strand the lease: the next owner can claim it.
    const { tryClaimLease, LEASE_TTL_MS } = await import('../src/state.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-slash-release-'));
    const clock = new FakeClock();
    await handleGoalCommand('/goal release me', dir, clock);
    await fsp.writeFile(path.join(dir, 'proof.txt'), 'done\n', 'utf8');
    await handleGoalCommand(
      '/goal evidence id=e1 claim=x files=proof.txt tests=node -e "process.exit(4)":0',
      dir,
      clock,
    );
    const blocked = await handleGoalCommand('/goal complete', dir, clock);
    expect(blocked).toContain('Complete blocked');
    const state = JSON.parse(
      await fsp.readFile(resolveStatePath(dir), 'utf8'),
    ) as { leaseOwner: string | null };
    expect(state.leaseOwner).toBeNull();
    const claim = await tryClaimLease(
      resolveStatePath(dir),
      'other',
      LEASE_TTL_MS,
      clock,
    );
    expect(claim.claimed).toBe(true);
  });
  it('a goal set during a slow completion is refused by the lease', async () => {
    // Serialization guard: proof takes hundreds of ms, and a slash set now takes
    // the same lease as completion, so the replacement is rejected as busy
    // instead of racing the save.
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-slash-stale-'));
    const clock = new FakeClock();
    await handleGoalCommand('/goal first goal', dir, clock);
    await fsp.writeFile(path.join(dir, 'proof.txt'), 'done\n', 'utf8');
    await handleGoalCommand(
      '/goal evidence id=e1 claim=x files=proof.txt tests=node -e "setTimeout(()=>{}, 800)":0',
      dir,
      clock,
    );
    const completing = handleGoalCommand('/goal complete', dir, clock);
    // Try to replace the goal while the proof command is still running.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const replaced = await handleGoalCommand('/goal second goal', dir, clock);
    expect(replaced).toMatch(/busy/i);
    const out = await completing;
    expect(out).toBe('Goal marked complete.');
    const state = JSON.parse(
      await fsp.readFile(resolveStatePath(dir), 'utf8'),
    ) as { objective: string; status: string };
    // The original goal completed; the rejected replacement never landed.
    expect(state.objective).toBe('first goal');
    expect(state.status).toBe('complete');
  }, 20000);
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
