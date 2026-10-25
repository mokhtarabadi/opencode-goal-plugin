// Sibling Docs: tests/README.md | Decisions: tests/DECISIONS.md
/**
 * Completion-blocked messaging and per-test environment.
 * Why these tests exist: a blocked completion used to print one canned sentence
 * while discarding the verifier's concrete failures, and a proof command could
 * only inherit the host environment. Both are contract-level behaviours, so
 * they are pinned here rather than inferred from a green suite.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  BLOCKED_FAILURE_LIMIT,
  describeVerificationFailure,
  verifyLocal,
} from '../src/verifier.js';
import { validateEvidenceShape } from '../src/evidence.js';
import type { GoalEvidenceFile } from '../src/evidence.js';
import type { Clock } from '../src/state.js';

/** Fixed clock keeps observed durations deterministic. */
class FakeClock implements Clock {
  nowMs(): number {
    return 1700000000000;
  }
}

/** Build a project dir with one cited file so shape and existence checks pass. */
function projectWithCitation(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-blocked-'));
  const file = path.join(dir, 'proof.txt');
  writeFileSync(file, 'proof\n');
  return { dir, file };
}

function evidenceWith(
  dir: string,
  command: string,
  env?: Record<string, string>,
): GoalEvidenceFile {
  return {
    version: 1,
    updatedAtMs: 1700000000000,
    criteria: [
      {
        id: 'e1',
        claim: 'the recorded command passes',
        files: ['proof.txt'],
        tests: [{ command, exitCode: 0, ...(env ? { env } : {}) }],
      },
    ],
  };
}

describe('describeVerificationFailure', () => {
  it('quotes the concrete failures instead of a canned sentence', () => {
    const message = describeVerificationFailure('evidence-invalid', [
      'test-failed:e1:exit=1',
    ]);

    expect(message).toContain('evidence-invalid');
    expect(message).toContain('test-failed:e1:exit=1');
    expect(message).not.toContain('Add file citations plus passing tests');
  });

  it('falls back to the generic hint when the verifier reported none', () => {
    const message = describeVerificationFailure('evidence-invalid', []);
    expect(message).toBe(
      'Complete blocked: evidence-invalid. Add evidence and retry.',
    );
  });

  it('caps how many failures are quoted', () => {
    const many = Array.from({ length: 8 }, (_, i) => 'failure-' + String(i));
    const message = describeVerificationFailure('evidence-invalid', many);

    expect(message).toContain('failure-0');
    expect(message).toContain('failure-' + String(BLOCKED_FAILURE_LIMIT - 1));
    expect(message).not.toContain('failure-6');
    expect(message).toContain('(+3 more)');
  });
});

describe('per-test environment', () => {
  it('accepts an env map in the evidence shape', () => {
    const shape = validateEvidenceShape({
      version: 1,
      updatedAtMs: 1,
      criteria: [
        {
          id: 'e1',
          claim: 'c',
          files: ['a.txt'],
          tests: [{ command: 'true', exitCode: 0, env: { JAVA_HOME: '/jdk' } }],
        },
      ],
    });
    expect(shape.ok).toBe(true);
  });

  it('rejects a non-string env value', () => {
    const shape = validateEvidenceShape({
      version: 1,
      updatedAtMs: 1,
      criteria: [
        {
          id: 'e1',
          claim: 'c',
          files: ['a.txt'],
          tests: [{ command: 'true', exitCode: 0, env: { N: 1 } }],
        },
      ],
    });
    expect(shape.ok).toBe(false);
    expect(shape.reason).toBe('test-env-not-string');
  });

  it('rejects a non-object env', () => {
    const shape = validateEvidenceShape({
      version: 1,
      updatedAtMs: 1,
      criteria: [
        {
          id: 'e1',
          claim: 'c',
          files: ['a.txt'],
          tests: [{ command: 'true', exitCode: 0, env: ['JAVA_HOME=/jdk'] }],
        },
      ],
    });
    expect(shape.ok).toBe(false);
    expect(shape.reason).toBe('test-env-not-object');
  });

  it('does not leak one criterion env into another criterion', async () => {
    const { dir } = projectWithCitation();
    // Criterion two passes only when the variable from criterion one is absent.
    const evidence: GoalEvidenceFile = {
      version: 1,
      updatedAtMs: 1700000000000,
      criteria: [
        {
          id: 'e1',
          claim: 'sees its own token',
          files: ['proof.txt'],
          tests: [
            {
              command: 'test "$GOAL_LEAK_TOKEN" = "ok"',
              exitCode: 0,
              env: { GOAL_LEAK_TOKEN: 'ok' },
            },
          ],
        },
        {
          id: 'e2',
          claim: 'does not inherit the previous env',
          files: ['proof.txt'],
          tests: [{ command: 'test -z "$GOAL_LEAK_TOKEN"', exitCode: 0 }],
        },
      ],
    };

    const result = await verifyLocal(dir, evidence, {
      runTests: true,
      clock: new FakeClock(),
      timeoutMs: 20000,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('passes the env to the observed command', async () => {
    const { dir } = projectWithCitation();
    // The command only exits 0 when the override arrived; without it the shell
    // expands an empty variable and exits 1.
    const evidence = evidenceWith(dir, 'test "$GOAL_PROOF_TOKEN" = "ok"', {
      GOAL_PROOF_TOKEN: 'ok',
    });

    const result = await verifyLocal(dir, evidence, {
      runTests: true,
      clock: new FakeClock(),
      timeoutMs: 20000,
    });

    expect(result.ok).toBe(true);
  });

  it('fails with a specific reason when the command really exits non-zero', async () => {
    const { dir } = projectWithCitation();
    const evidence = evidenceWith(dir, 'exit 3');

    const result = await verifyLocal(dir, evidence, {
      runTests: true,
      clock: new FakeClock(),
      timeoutMs: 20000,
    });

    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('test-failed:e1:exit=3');
  });
});
