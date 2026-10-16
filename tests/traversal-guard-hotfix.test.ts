/**
 * Traversal guard hotfix tests Phase 4.
 * Why these tests exist: prove empty, dot, non-string, and directory citations fail closed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isCitationInsideProjectDir, verifyLocal } from '../src/verifier.js';

describe('traversal guard hotfix', () => {
  it('rejects empty citation', () => {
    expect(isCitationInsideProjectDir('/tmp/proj', '')).toBe(false);
  });
  it('rejects dot citation', () => {
    expect(isCitationInsideProjectDir('/tmp/proj', '.')).toBe(false);
  });
  it('non-string citation fails closed without throw', () => {
    let out: unknown;
    expect(() => {
      out = isCitationInsideProjectDir('/tmp/proj', null as unknown as string);
    }).not.toThrow();
    expect(out).toBe(false);
  });
  it('verifyLocal rejects empty and directory without throw', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-verify-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/a.ts'), 'x');
    const got = await verifyLocal(dir, {
      version: 1,
      updatedAtMs: 1,
      criteria: [
        { id: 'c1', claim: 'x', files: ['', 'src', 'src/a.ts'], tests: [{ command: 'npm test', exitCode: 0 }] },
      ],
    });
    expect(got.ok).toBe(false);
    expect(got.failures.some((x) => x.includes('traversal-escape') || x.includes('not-a-file'))).toBe(true);
  });
  it('verifyLocal with null file fails closed', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-verify-null-'));
    await fs.writeFile(path.join(dir2, 'a.ts'), 'x');
    let got: unknown;
    await expect(
      (async () => {
        got = await verifyLocal(dir2, {
          version: 1,
          updatedAtMs: 1,
          criteria: [
            { id: 'c1', claim: 'x', files: [null as unknown as string], tests: [{ command: 'npm test', exitCode: 0 }] },
          ],
        });
      })(),
    ).resolves.toBeUndefined();
    expect((got as { ok: boolean }).ok).toBe(false);
  });
});
