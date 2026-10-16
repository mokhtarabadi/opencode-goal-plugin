/**
 * Verifier tests Phase 3.
 * Why these tests exist: prove completion needs checked proof, never self-report.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { verifyLocal, verifyCompletion } from '../src/verifier.js';

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
});
