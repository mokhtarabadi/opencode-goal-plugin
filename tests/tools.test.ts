/**
 * Tests for agent-callable goal tools.
 * Why these tests exist: prove the tool lane registers four tools and shares
 * the exact slash handler, so model-driven and user-driven paths cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { registerGoalTools } from '../src/tools.js';
import {
  BlockInputSchema,
  CompleteInputSchema,
  GoalInputSchema,
  ResumeInputSchema,
} from '../src/goal.js';
import type { Clock } from '../src/state.js';

/** Fixed clock keeps tool timestamps deterministic. */
class FakeClock implements Clock {
  nowMs(): number {
    return 1700000000000;
  }
}

/** Captured tool definition with a callable execute. */
interface CapturedDef {
  name: string;
  description: string;
  input: unknown;
  execute: (input: unknown, context: unknown) => Promise<{ content: string }>;
}

/** Fake host ctx capturing editor.add calls. */
function fakeCtx(defs: CapturedDef[]): unknown {
  return {
    tool: {
      transform: async (
        fn: (editor: { add: (d: CapturedDef) => void }) => void,
      ) => {
        fn({ add: (d: CapturedDef) => defs.push(d) });
      },
    },
  };
}

describe('registerGoalTools', () => {
  it('registers four tools beside the slash lane', async () => {
    const defs: CapturedDef[] = [];
    const out = await registerGoalTools(
      fakeCtx(defs),
      mkdtempSync(path.join(tmpdir(), 'goal-tools-')),
      new FakeClock(),
    );
    expect(out).toEqual({ registered: true, reason: 'ok' });
    expect(defs.map((d) => d.name)).toEqual([
      'goal_set',
      'goal_block',
      'goal_complete',
      'goal_resume',
    ]);
    for (const d of defs) {
      expect(typeof d.description).toBe('string');
      expect(d.description.length).toBeGreaterThan(0);
    }
  });
  it('fails closed without throwing on a host without the tool domain', async () => {
    const out = await registerGoalTools({}, '/tmp/x', new FakeClock());
    expect(out.registered).toBe(false);
    expect(out.reason).toBe('tool-hook-unavailable');
  });
  it('fails closed on bad opts without throwing', async () => {
    const defs: CapturedDef[] = [];
    expect(
      (await registerGoalTools(fakeCtx(defs), '', new FakeClock())).registered,
    ).toBe(false);
    expect(defs.length).toBe(0);
  });
});

describe('tool schemas', () => {
  it('set reuses GoalInputSchema closed shape', () => {
    expect(GoalInputSchema.required).toContain('title');
    expect(GoalInputSchema.additionalProperties).toBe(false);
  });
  it('block requires reason and complete plus resume take no args', () => {
    expect(BlockInputSchema.required).toContain('reason');
    expect(BlockInputSchema.additionalProperties).toBe(false);
    expect(CompleteInputSchema.additionalProperties).toBe(false);
    expect(ResumeInputSchema.additionalProperties).toBe(false);
  });
});

describe('tool execute parity with slash', () => {
  async function toolDefs(dir: string): Promise<CapturedDef[]> {
    const defs: CapturedDef[] = [];
    await registerGoalTools(fakeCtx(defs), dir, new FakeClock());
    return defs;
  }
  function byName(defs: CapturedDef[], name: string): CapturedDef {
    const found = defs.find((d) => d.name === name);
    if (!found) throw new Error('missing tool ' + name);
    return found;
  }
  it('goal_set writes the same state as slash and rejects escapes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-set-'));
    const defs = await toolDefs(dir);
    const ok = await byName(defs, 'goal_set').execute(
      { title: 'ship tool lane' },
      { sessionID: 'sess-1' },
    );
    expect(ok.content).toContain('Goal set to active');
    const bad = await byName(defs, 'goal_set').execute(
      { title: '../escape' },
      { sessionID: 'sess-1' },
    );
    expect(bad.content).toContain('path escape');
    const nonString = await byName(defs, 'goal_set').execute({ title: 42 }, {});
    expect(nonString.content).toContain('Invalid');
  });
  it('goal_block and goal_resume round-trip a parked goal', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-block-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'park me' }, {});
    const blocked = await byName(defs, 'goal_block').execute(
      { reason: 'waiting on review' },
      {},
    );
    expect(blocked.content).toContain('blocked');
    const resumed = await byName(defs, 'goal_resume').execute({}, {});
    expect(resumed.content).toContain('resumed');
  });
  it('goal_complete stays blocked without evidence', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-complete-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'prove it' }, {});
    const done = await byName(defs, 'goal_complete').execute({}, {});
    expect(done.content).toContain('blocked');
  });
  it('execute never throws on hostile input', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-hostile-'));
    const defs = await toolDefs(dir);
    for (const d of defs) {
      const out = await d.execute(null, null);
      expect(typeof out.content).toBe('string');
    }
  });
  it('hostile null input leaves file state unchanged', async () => {
    // Snapshot the state file before and after hostile calls: no mutation.
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolveStatePath } = await import('../src/state.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-snap-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'baseline' }, {});
    const statePath = resolveStatePath(dir);
    expect(existsSync(statePath)).toBe(true);
    const before = readFileSync(statePath, 'utf8');
    for (const d of defs) {
      await d.execute(null, null);
      await d.execute(undefined, undefined);
      await d.execute({}, { sessionID: 42 });
    }
    expect(readFileSync(statePath, 'utf8')).toBe(before);
  });
  it('reserved-word title sets literally instead of misrouting', async () => {
    // 'block foo' as a goal_set title must not park the goal as blocked.
    const { loadGoalState, resolveStatePath } = await import('../src/state.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-reserved-'));
    const defs = await toolDefs(dir);
    const out = await byName(defs, 'goal_set').execute(
      { title: 'block foo' },
      { sessionID: 'sess-1' },
    );
    expect(out.content).toContain('Goal set to active');
    const state = await loadGoalState(resolveStatePath(dir));
    expect(state?.status).toBe('active');
    expect(state?.objective).toBe('block foo');
  });
  it('newline injection title never executes a second command', async () => {
    const { loadGoalState, resolveStatePath } = await import('../src/state.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-inject-'));
    const defs = await toolDefs(dir);
    const evil = 'ship it\n/goal clear';
    const out = await byName(defs, 'goal_set').execute({ title: evil }, {});
    expect(out.content).toContain('Goal set to active');
    const state = await loadGoalState(resolveStatePath(dir));
    // Objective stored literally, goal stays active: no second command ran.
    expect(state?.status).toBe('active');
    expect(state?.objective).toBe(evil);
  });
  it('different sessionIDs share one project goal without bleed', async () => {
    // Single-goal-per-project semantics: sequential writes are consistent,
    // last writer wins, and neither call throws or corrupts state.
    const { loadGoalState, resolveStatePath } = await import('../src/state.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-sess-'));
    const defs = await toolDefs(dir);
    const a = await byName(defs, 'goal_set').execute(
      { title: 'from sess-A' },
      { sessionID: 'sess-A' },
    );
    const b = await byName(defs, 'goal_set').execute(
      { title: 'from sess-B' },
      { sessionID: 'sess-B' },
    );
    expect(a.content).toContain('Goal set to active');
    expect(b.content).toContain('Goal set to active');
    const state = await loadGoalState(resolveStatePath(dir));
    expect(state?.objective).toBe('from sess-B');
  });
  it('projects stay isolated from each other', async () => {
    const { loadGoalState, resolveStatePath } = await import('../src/state.js');
    const dirA = mkdtempSync(path.join(tmpdir(), 'goal-tools-isoA-'));
    const dirB = mkdtempSync(path.join(tmpdir(), 'goal-tools-isoB-'));
    const defsA = await toolDefs(dirA);
    await byName(defsA, 'goal_set').execute({ title: 'alpha' }, {});
    const stateB = await loadGoalState(resolveStatePath(dirB));
    expect(stateB).toBeNull();
  });
  it('held lease blocks tool mutate without changing state', async () => {
    // Simulate the loop holding the lease: tool must back off, not clobber.
    const { readFileSync } = await import('node:fs');
    const { tryClaimLease, resolveStatePath, LEASE_TTL_MS } =
      await import('../src/state.js');
    const clock = new FakeClock();
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-race-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'baseline' }, {});
    const statePath = resolveStatePath(dir);
    const before = readFileSync(statePath, 'utf8');
    const held = await tryClaimLease(statePath, 'loop', LEASE_TTL_MS, clock);
    expect(held.claimed).toBe(true);
    const blocked = await byName(defs, 'goal_block').execute(
      { reason: 'racy' },
      { sessionID: 'sess-race' },
    );
    expect(blocked.content).toMatch(/busy|lease|Busy/i);
    expect(readFileSync(statePath, 'utf8')).not.toContain(
      '"status": "blocked"',
    );
    expect(JSON.parse(readFileSync(statePath, 'utf8')).objective).toBe(
      JSON.parse(before).objective,
    );
  });
  it('tool result matches slash result for the same op', async () => {
    // Parity guard: tool lane and slash lane must never drift in messages.
    const { handleGoalCommand } = await import('../src/index.js');
    const clock = new FakeClock();
    const dirTool = mkdtempSync(path.join(tmpdir(), 'goal-tools-parT-'));
    const dirSlash = mkdtempSync(path.join(tmpdir(), 'goal-tools-parS-'));
    const defs = await toolDefs(dirTool);
    const toolSet = await byName(defs, 'goal_set').execute(
      { title: 'parity' },
      {},
    );
    const slashSet = await handleGoalCommand('/goal parity', dirSlash, clock);
    expect(toolSet.content).toBe(slashSet);
    // Like-for-like on fresh dirs: set then block in each lane separately.
    const dirTool2 = mkdtempSync(path.join(tmpdir(), 'goal-tools-parT2-'));
    const dirSlash2 = mkdtempSync(path.join(tmpdir(), 'goal-tools-parS2-'));
    const defs2 = await toolDefs(dirTool2);
    const toolSet2 = await byName(defs2, 'goal_set').execute(
      { title: 'parity2' },
      {},
    );
    const slashSet2 = await handleGoalCommand(
      '/goal parity2',
      dirSlash2,
      clock,
    );
    expect(toolSet2.content).toBe(slashSet2);
    const toolBlock2 = await byName(defs2, 'goal_block').execute(
      { reason: 'r' },
      {},
    );
    const slashBlock2 = await handleGoalCommand(
      '/goal block r',
      dirSlash2,
      clock,
    );
    expect(toolBlock2.content).toBe(slashBlock2);
  });
});
