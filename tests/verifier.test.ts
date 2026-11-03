/**
 * Verifier tests Phase 3.
 * Why these tests exist: prove completion needs checked proof, never self-report.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { verifyLocal, verifyCompletion } from '../src/verifier.js';
import type { GoalEvidenceFile } from '../src/evidence.js';

/** Evidence with one criterion citing the given paths and a declared pass. */
function evidenceFor(files: string[]): GoalEvidenceFile {
  return {
    version: 1,
    updatedAtMs: 1,
    criteria: [
      {
        id: 'c1',
        claim: 'the cited file exists',
        files,
        tests: [{ command: 'npm test', exitCode: 0 }],
      },
    ],
  };
}

/** Scratch project dir with the given relative files. */
function proj(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'goal-ver-'));
  mkdirSync(join(d, '.opencode'), { recursive: true });
  for (const [k, v] of Object.entries(files)) {
    // Parent dirs first so nested citations like src/a.ts always write.
    mkdirSync(join(d, dirname(k)), { recursive: true });
    writeFileSync(join(d, k), v);
  }
  return d;
}

describe('verifier', () => {
  it('blocks missing evidence', async () => {
    const got = await verifyLocal('/tmp/nope', null);
    expect(got.ok).toBe(false);
  });
  it('fails missing file citation', async () => {
    const d = proj({ 'src/a.ts': 'x' });
    const got = await verifyLocal(d, {
      version: 1,
      updatedAtMs: 1,
      criteria: [
        {
          id: 'c1',
          claim: 'x',
          files: ['nope.ts'],
          tests: [{ command: 'npm test', exitCode: 0 }],
        },
      ],
    });
    expect(got.ok).toBe(false);
  });
  it('fails without passing test', async () => {
    const d = proj({ 'src/a.ts': 'x' });
    const got = await verifyLocal(d, {
      version: 1,
      updatedAtMs: 1,
      criteria: [
        {
          id: 'c1',
          claim: 'x',
          files: ['src/a.ts'],
          tests: [{ command: 'npm test', exitCode: 1 }],
        },
      ],
    });
    expect(got.ok).toBe(false);
  });
  it('passes valid evidence without subagent', async () => {
    const d = proj({ 'src/a.ts': 'x' });
    const got = await verifyCompletion({
      projectDir: d,
      evidence: {
        version: 1,
        updatedAtMs: 1,
        criteria: [
          {
            id: 'c1',
            claim: 'x',
            files: ['src/a.ts'],
            tests: [{ command: 'npm test', exitCode: 0 }],
          },
        ],
      },
    });
    expect(got.ok).toBe(true);
  });
  it('T3 subagent pass completes', async () => {
    // Host subagent agrees with local checks: completion carries both reasons.
    const d = proj({ 'src/a.ts': 'x' });
    const host = {
      runSubagent: async () => ({ pass: true, reason: 'looks good' }),
    };
    const got = await verifyCompletion({
      projectDir: d,
      evidence: {
        version: 1,
        updatedAtMs: 1,
        criteria: [
          {
            id: 'c1',
            claim: 'x',
            files: ['src/a.ts'],
            tests: [{ command: 'npm test', exitCode: 0 }],
          },
        ],
      },
      host,
      useSubagent: true,
      stateSummary: 'goal active turn 3',
    });
    expect(got.ok).toBe(true);
    expect(got.reason).toContain('subagent-pass');
  });
  it('T4 subagent fail keeps goal active', async () => {
    // Host subagent rejects: goal stays active with the fail reason.
    const d = proj({ 'src/a.ts': 'x' });
    const host = {
      runSubagent: async () => ({ pass: false, reason: 'tests not run here' }),
    };
    const got = await verifyCompletion({
      projectDir: d,
      evidence: {
        version: 1,
        updatedAtMs: 1,
        criteria: [
          {
            id: 'c1',
            claim: 'x',
            files: ['src/a.ts'],
            tests: [{ command: 'npm test', exitCode: 0 }],
          },
        ],
      },
      host,
      useSubagent: true,
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toContain('subagent-fail');
  });
  it('T5 subagent throw keeps goal active', async () => {
    // Host runner throws: verifier maps to not-ok instead of escaping.
    const d = proj({ 'src/a.ts': 'x' });
    const host = {
      runSubagent: async () => {
        throw new Error('runner down');
      },
    };
    const got = await verifyCompletion({
      projectDir: d,
      evidence: {
        version: 1,
        updatedAtMs: 1,
        criteria: [
          {
            id: 'c1',
            claim: 'x',
            files: ['src/a.ts'],
            tests: [{ command: 'npm test', exitCode: 0 }],
          },
        ],
      },
      host,
      useSubagent: true,
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toBe('verifier-error');
  });
  it('rejects traversal citation as invalid', async () => {
    // Dot-dot citations fail without touching the filesystem outside.
    const d = proj({ 'src/a.ts': 'x' });
    const got = await verifyLocal(d, {
      version: 1,
      updatedAtMs: 1,
      criteria: [
        {
          id: 'c1',
          claim: 'x',
          files: ['../escape.ts'],
          tests: [{ command: 'npm test', exitCode: 0 }],
        },
      ],
    });
    expect(got.ok).toBe(false);
    expect(got.failures.some((f) => f.startsWith('traversal-escape'))).toBe(
      true,
    );
  });
});

describe('movable citations', () => {
  it('accepts a citation whose file moved to another lane and names it', async () => {
    // A Kanban promotion is normal workflow: the work was correct, only the
    // location changed, so the criterion must still prove.
    const d = proj({ 'tasks/qa/x.md': '# task' });
    mkdirSync(join(d, 'tasks/completed'), { recursive: true });
    renameSync(join(d, 'tasks/qa/x.md'), join(d, 'tasks/completed/x.md'));
    const got = await verifyLocal(d, evidenceFor(['tasks/qa/x.md']));
    expect(got.ok).toBe(true);
    expect(got.citations).toEqual([
      {
        criterionId: 'c1',
        cited: 'tasks/qa/x.md',
        resolved: 'tasks/completed/x.md',
        moved: true,
      },
    ]);
    // The report states which path actually satisfied the citation.
    expect(got.reason).toContain('tasks/completed/x.md');
  });

  it('prefers the exact path over a same-named file elsewhere', async () => {
    const d = proj({ 'a/x.md': 'a', 'b/x.md': 'b' });
    const got = await verifyLocal(d, evidenceFor(['a/x.md']));
    expect(got.ok).toBe(true);
    expect(got.citations?.[0].resolved).toBe('a/x.md');
    expect(got.citations?.[0].moved).toBe(false);
  });

  it('fails an ambiguous basename hit and names both candidates', async () => {
    // Two files share the name: guessing would prove the wrong file, so the
    // criterion fails with the candidates visible instead of a silent pick.
    const d = proj({ 'a/x.md': 'a', 'b/x.md': 'b' });
    const got = await verifyLocal(d, evidenceFor(['tasks/qa/x.md']));
    expect(got.ok).toBe(false);
    const ambiguous = got.failures.find((f) =>
      f.startsWith('ambiguous-citation:c1:tasks/qa/x.md'),
    );
    expect(ambiguous).toBeDefined();
    expect(ambiguous).toContain('a/x.md');
    expect(ambiguous).toContain('b/x.md');
    expect(got.failures.join(' ')).not.toContain('missing-file');
  });

  it('keeps missing-file when nothing matches by basename', async () => {
    // Guard against silent verification weakening: a deleted file must never
    // pass as a move.
    const d = proj({ 'src/a.ts': 'x' });
    const got = await verifyLocal(d, evidenceFor(['tasks/qa/gone.md']));
    expect(got.ok).toBe(false);
    expect(got.failures).toEqual(['missing-file:c1:tasks/qa/gone.md']);
  });

  it('keeps not-a-file for a cited directory', async () => {
    const d = proj({ 'src/a.ts': 'x' });
    mkdirSync(join(d, 'docs'), { recursive: true });
    const got = await verifyLocal(d, evidenceFor(['docs']));
    expect(got.ok).toBe(false);
    expect(got.failures).toEqual(['not-a-file:c1:docs']);
  });
});
