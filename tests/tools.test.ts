/**
 * Tests for agent-callable goal tools.
 * Why these tests exist: prove the tool lane registers five tools and shares
 * the exact slash handler, so model-driven and user-driven paths cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { registerGoalTools } from '../src/tools.js';
import { resolveEvidencePath } from '../src/evidence.js';
import {
  BlockInputSchema,
  CompleteInputSchema,
  EvidenceInputSchema,
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

/**
 * Criteria currently on disk for one lane.
 * Why a raw read instead of loadEvidence: a freshly seeded sidecar holds an
 * empty list, which shape validation rejects as `evidence-empty`, so
 * loadEvidence maps it to null and cannot report the file at all.
 */
function readCriteria(dir: string, sessionId?: string): unknown[] {
  const file = resolveEvidencePath(dir, sessionId);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    criteria?: unknown[];
  };
  return parsed.criteria ?? [];
}

describe('registerGoalTools', () => {
  it('registers five tools beside the slash lane', async () => {
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
      'goal_evidence',
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
  it('evidence requires id plus claim plus files plus tests and closes extra props', () => {
    expect(EvidenceInputSchema.required).toEqual([
      'id',
      'claim',
      'files',
      'tests',
    ]);
    expect(EvidenceInputSchema.additionalProperties).toBe(false);
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
    const state = await loadGoalState(resolveStatePath(dir, 'sess-1'));
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
  it('different sessionIDs get isolated goals without bleed', async () => {
    // Per-session isolation: each lane owns its file, last writer no longer
    // clobbers the other lane. A sees only A's goal, B only B's.
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
    const stateA = await loadGoalState(resolveStatePath(dir, 'sess-A'));
    const stateB = await loadGoalState(resolveStatePath(dir, 'sess-B'));
    expect(stateA?.objective).toBe('from sess-A');
    expect(stateB?.objective).toBe('from sess-B');
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
  it('a same-session tool call never re-enters an in-flight lease', async () => {
    // Owner ids are per call, not per session: the lease lets a repeated owner
    // re-claim, so a fixed `tool:<session>` owner would admit a second writer.
    const { tryClaimLease, resolveStatePath, LEASE_TTL_MS } =
      await import('../src/state.js');
    const clock = new FakeClock();
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-sameowner-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute(
      { title: 'baseline' },
      { sessionID: 'sess-R' },
    );
    // Simulate an in-flight call from the same session holding the lease.
    const held = await tryClaimLease(
      resolveStatePath(dir, 'sess-R'),
      'tool:sess-R',
      LEASE_TTL_MS,
      clock,
    );
    expect(held.claimed).toBe(true);
    const blocked = await byName(defs, 'goal_block').execute(
      { reason: 'second writer' },
      { sessionID: 'sess-R' },
    );
    expect(blocked.content).toMatch(/busy/i);
  });
  it('held lease blocks tool mutate without changing state', async () => {
    // Simulate the loop holding the lease: tool must back off, not clobber.
    const { readFileSync } = await import('node:fs');
    const { tryClaimLease, resolveStatePath, LEASE_TTL_MS } =
      await import('../src/state.js');
    const clock = new FakeClock();
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-race-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute(
      { title: 'baseline' },
      { sessionID: 'sess-race' },
    );
    const statePath = resolveStatePath(dir, 'sess-race');
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
  it('evidence tool result matches slash result for the same op', async () => {
    const { handleGoalCommand } = await import('../src/index.js');
    const clock = new FakeClock();
    const dirTool = mkdtempSync(path.join(tmpdir(), 'goal-tools-parE-'));
    const dirSlash = mkdtempSync(path.join(tmpdir(), 'goal-tools-parES-'));
    const defs = await toolDefs(dirTool);
    await byName(defs, 'goal_set').execute({ title: 'parity-ev' }, {});
    await handleGoalCommand('/goal parity-ev', dirSlash, clock);
    const input = {
      id: 'e1',
      claim: 'parity holds',
      files: ['src/a.ts'],
      tests: [{ command: 'npm test', exitCode: 0 }],
    };
    const toolEv = await byName(defs, 'goal_evidence').execute(input, {});
    const slashEv = await handleGoalCommand(
      '/goal evidence id=e1 claim=parity holds files=src/a.ts tests=npm test:0',
      dirSlash,
      clock,
    );
    expect(toolEv.content).toBe(slashEv);
    expect(toolEv.content).toContain('Criterion recorded for e1');
  });
});

describe('goal_evidence sole writer', () => {
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
  it('set to evidence to complete passes the gate with real proof', async () => {
    const { writeFileSync } = await import('node:fs');
    const { loadEvidence } = await import('../src/evidence.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evok-'));
    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute(
      { title: 'prove it' },
      { sessionID: 'sess-ev' },
    );
    const rec = await byName(defs, 'goal_evidence').execute(
      {
        id: 'e1',
        claim: 'work is done',
        files: ['proof.txt'],
        // Real zero exit: goal_complete now runs the command and reads its code.
        tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
      },
      { sessionID: 'sess-ev' },
    );
    expect(rec.content).toContain('Criterion recorded for e1');
    const ev = await loadEvidence(dir, 'sess-ev');
    expect(ev?.criteria.map((c) => c.id)).toEqual(['e1']);
    const done = await byName(defs, 'goal_complete').execute(
      {},
      { sessionID: 'sess-ev' },
    );
    expect(done.content).toBe('Goal marked complete.');
  });
  it('hostile shape writes nothing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evbad-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'baseline' }, {});
    const bad = await byName(defs, 'goal_evidence').execute(
      { id: '', claim: '' },
      {},
    );
    expect(bad.content).toContain('Invalid');
    // goal_set seeds an empty sidecar, so "nothing written" means no criterion
    // landed, not that the file is absent.
    expect(readCriteria(dir)).toEqual([]);
  });
  it('duplicate id is rejected with no second write', async () => {
    const { loadEvidence } = await import('../src/evidence.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evdup-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'dup' }, {});
    const input = {
      id: 'e1',
      claim: 'first',
      files: ['src/a.ts'],
      tests: [{ command: 'npm test', exitCode: 0 }],
    };
    expect(
      (await byName(defs, 'goal_evidence').execute(input, {})).content,
    ).toContain('Criterion recorded');
    const dup = await byName(defs, 'goal_evidence').execute(input, {});
    expect(dup.content).toContain('already recorded');
    expect((await loadEvidence(dir))?.criteria.length).toBe(1);
  });
  it('held lease blocks evidence write without changing state', async () => {
    const { existsSync } = await import('node:fs');
    const { tryClaimLease, resolveStatePath, LEASE_TTL_MS } =
      await import('../src/state.js');
    const { resolveEvidencePath } = await import('../src/evidence.js');
    const clock = new FakeClock();
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evrace-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute(
      { title: 'baseline' },
      { sessionID: 'sess-race' },
    );
    const held = await tryClaimLease(
      resolveStatePath(dir, 'sess-race'),
      'loop',
      LEASE_TTL_MS,
      clock,
    );
    expect(held.claimed).toBe(true);
    const out = await byName(defs, 'goal_evidence').execute(
      {
        id: 'e1',
        claim: 'racy',
        files: ['src/a.ts'],
        tests: [{ command: 'npm test', exitCode: 0 }],
      },
      { sessionID: 'sess-race' },
    );
    expect(out.content).toMatch(/busy|lease|Busy/i);
    expect(readCriteria(dir, 'sess-race')).toEqual([]);
  });
  it('blocked goal rejects evidence with no write', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evblk-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'stuck' }, {});
    await byName(defs, 'goal_block').execute({ reason: 'wait' }, {});
    const out = await byName(defs, 'goal_evidence').execute(
      {
        id: 'e1',
        claim: 'late',
        files: ['src/a.ts'],
        tests: [{ command: 'npm test', exitCode: 0 }],
      },
      {},
    );
    expect(out.content).toContain('Only an active goal');
    expect(readCriteria(dir)).toEqual([]);
  });
  it('no goal set reports status with no lease held', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evnone-'));
    const defs = await toolDefs(dir);
    const out = await byName(defs, 'goal_evidence').execute(
      {
        id: 'e1',
        claim: 'orphan',
        files: ['src/a.ts'],
        tests: [{ command: 'npm test', exitCode: 0 }],
      },
      {},
    );
    expect(out.content).toContain('No goal set');
  });
});

describe('hotfix qa-reject negative paths', () => {
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
  const good = {
    id: 'e1',
    claim: 'holds',
    files: ['src/a.ts'],
    tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
  };
  it('slash with empty exit code is invalid and writes nothing', async () => {
    const { existsSync } = await import('node:fs');
    const { handleGoalCommand } = await import('../src/index.js');
    const { resolveEvidencePath } = await import('../src/evidence.js');
    const clock = new FakeClock();
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe1-'));
    await handleGoalCommand('/goal slash-ev', dir, clock);
    const out = await handleGoalCommand(
      '/goal evidence id=e-bad claim=x files=src/a.ts tests=npm test:',
      dir,
      clock,
    );
    expect(out).toContain('Invalid');
    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
  });
  it('slash with spaces-only exit code is invalid and writes nothing', async () => {
    const { existsSync } = await import('node:fs');
    const { handleGoalCommand } = await import('../src/index.js');
    const { resolveEvidencePath } = await import('../src/evidence.js');
    const clock = new FakeClock();
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe1b-'));
    await handleGoalCommand('/goal slash-ev', dir, clock);
    const out = await handleGoalCommand(
      '/goal evidence id=e-bad claim=x files=src/a.ts tests=npm test:  ',
      dir,
      clock,
    );
    expect(out).toContain('Invalid');
    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
  });
  it('bare slash evidence is invalid and writes nothing', async () => {
    const { existsSync } = await import('node:fs');
    const { handleGoalCommand } = await import('../src/index.js');
    const { resolveEvidencePath } = await import('../src/evidence.js');
    const clock = new FakeClock();
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe2-'));
    await handleGoalCommand('/goal slash-ev', dir, clock);
    const out = await handleGoalCommand('/goal evidence', dir, clock);
    expect(out).toContain('Invalid');
    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
  });
  it('tool rejects empty files or empty tests arrays with no write', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe3-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'base' }, {});
    const noFiles = await byName(defs, 'goal_evidence').execute(
      { ...good, files: [] },
      {},
    );
    expect(noFiles.content).toContain('Invalid');
    const noTests = await byName(defs, 'goal_evidence').execute(
      { ...good, tests: [] },
      {},
    );
    expect(noTests.content).toContain('Invalid');
    expect(readCriteria(dir)).toEqual([]);
  });
  it('tool rejects partial bad entries instead of silently dropping', async () => {
    const { loadEvidence } = await import('../src/evidence.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe3b-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'base' }, {});
    const badFile = await byName(defs, 'goal_evidence').execute(
      { ...good, files: ['src/a.ts', 42] },
      {},
    );
    expect(badFile.content).toContain('Invalid');
    const badTest = await byName(defs, 'goal_evidence').execute(
      { ...good, tests: [{ command: '', exitCode: 0 }] },
      {},
    );
    expect(badTest.content).toContain('Invalid');
    expect(await loadEvidence(dir)).toBeNull();
  });
  it('tool trims spaced file entries to match the slash lane', async () => {
    const { loadEvidence } = await import('../src/evidence.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe4-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'base' }, {});
    const out = await byName(defs, 'goal_evidence').execute(
      { ...good, files: ['  src/a.ts  '] },
      {},
    );
    expect(out.content).toContain('Criterion recorded');
    expect((await loadEvidence(dir))?.criteria[0].files).toEqual(['src/a.ts']);
  });
  it('fabricated file citation cannot complete', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe5-'));
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'fake' }, {});
    const rec = await byName(defs, 'goal_evidence').execute(
      { ...good, files: ['src/does-not-exist.ts'] },
      {},
    );
    expect(rec.content).toContain('Criterion recorded');
    const done = await byName(defs, 'goal_complete').execute({}, {});
    expect(done.content).not.toContain('Goal marked complete');
    expect(done.content).toContain('blocked');
  });
  it('evidence after complete rejects with no second write', async () => {
    const { writeFileSync } = await import('node:fs');
    const { loadEvidence } = await import('../src/evidence.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe6-'));
    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
    const defs = await toolDefs(dir);
    await byName(defs, 'goal_set').execute({ title: 'fin' }, {});
    await byName(defs, 'goal_evidence').execute(
      {
        ...good,
        id: 'e1',
        files: ['proof.txt'],
      },
      {},
    );
    expect((await byName(defs, 'goal_complete').execute({}, {})).content).toBe(
      'Goal marked complete.',
    );
    const late = await byName(defs, 'goal_evidence').execute(
      { ...good, id: 'e2' },
      {},
    );
    expect(late.content).toContain('Only an active goal');
    expect((await loadEvidence(dir))?.criteria.length).toBe(1);
  });
});

describe('goal_set clears stale evidence', () => {
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
  it('drops criteria recorded for the previous goal', async () => {
    const { writeFileSync } = await import('node:fs');
    const { loadEvidence } = await import('../src/evidence.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-reset-'));
    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
    const defs = await toolDefs(dir);
    const session = { sessionID: 'sess-reset' };
    await byName(defs, 'goal_set').execute({ title: 'first' }, session);
    await byName(defs, 'goal_evidence').execute(
      {
        id: 'stale',
        claim: 'first goal proof',
        files: ['proof.txt'],
        // A recorded failure: this is the criterion that used to poison the
        // session sidecar and block every later completion.
        tests: [{ command: 'node -e "process.exit(1)"', exitCode: 0 }],
      },
      session,
    );
    expect((await loadEvidence(dir, 'sess-reset'))?.criteria.length).toBe(1);

    await byName(defs, 'goal_set').execute({ title: 'second' }, session);

    const after = readCriteria(dir, 'sess-reset');
    expect(after).toEqual([]);
    // The stale id is free again, so a corrected criterion can be recorded.
    const rec = await byName(defs, 'goal_evidence').execute(
      {
        id: 'stale',
        claim: 'second goal proof',
        files: ['proof.txt'],
        tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
      },
      session,
    );
    expect(rec.content).toContain('Criterion recorded for stale');
  });
  it('completes a new goal even when the old goal recorded a failing command', async () => {
    const { writeFileSync } = await import('node:fs');
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-reset2-'));
    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
    const defs = await toolDefs(dir);
    const session = { sessionID: 'sess-reset2' };
    await byName(defs, 'goal_set').execute({ title: 'old goal' }, session);
    await byName(defs, 'goal_evidence').execute(
      {
        id: 'old',
        claim: 'old proof',
        files: ['proof.txt'],
        tests: [{ command: 'node -e "process.exit(1)"', exitCode: 0 }],
      },
      session,
    );
    await byName(defs, 'goal_set').execute({ title: 'new goal' }, session);
    await byName(defs, 'goal_evidence').execute(
      {
        id: 'new',
        claim: 'new proof',
        files: ['proof.txt'],
        tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
      },
      session,
    );
    const done = await byName(defs, 'goal_complete').execute({}, session);
    expect(done.content).toBe('Goal marked complete.');
  });
  it('slash set and tool set leave the same evidence state', async () => {
    const { handleGoalCommand } = await import('../src/index.js');
    const clock = new FakeClock();
    const dirTool = mkdtempSync(path.join(tmpdir(), 'goal-tools-resetT-'));
    const dirSlash = mkdtempSync(path.join(tmpdir(), 'goal-tools-resetS-'));
    const defs = await toolDefs(dirTool);
    await byName(defs, 'goal_set').execute(
      { title: 'parity-reset' },
      { sessionID: 'sess-parT' },
    );
    await handleGoalCommand(
      '/goal parity-reset',
      dirSlash,
      clock,
      '2.0.29',
      'sess-parS',
    );
    expect(readCriteria(dirTool, 'sess-parT')).toEqual([]);
    expect(readCriteria(dirSlash, 'sess-parS')).toEqual([]);
  });
});
