/**
 * Observed proof tests.
 * Why these tests exist: the completion gate used to accept a typed exit code.
 * These prove the runner observes reality, fails closed on timeout and spawn
 * errors, pins its working directory, and that the verifier switches behavior
 * only when observation is requested.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runProofCommand } from '../src/proof.js';
import { verifyLocal, tryCompleteWithEvidence } from '../src/verifier.js';
import type { Clock } from '../src/state.js';
import type { GoalEvidenceFile } from '../src/evidence.js';

/** Fixed clock keeps durations deterministic; proof timing is not asserted. */
class FakeClock implements Clock {
  nowMs(): number {
    return 1700000000000;
  }
}

/** Build a criterion set citing an existing file, one command each. */
function evidenceFor(
  dir: string,
  command: string,
  exitCode = 0,
): GoalEvidenceFile {
  writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
  return {
    version: 1,
    updatedAtMs: 1700000000000,
    criteria: [
      {
        id: 'e1',
        claim: 'work is done',
        files: ['proof.txt'],
        tests: [{ command, exitCode }],
      },
    ],
  };
}

/** Build a single criterion with several recorded commands. */
function multiCommandEvidence(
  dir: string,
  commands: string[],
): GoalEvidenceFile {
  writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
  return {
    version: 1,
    updatedAtMs: 1700000000000,
    criteria: [
      {
        id: 'e1',
        claim: 'work is done',
        files: ['proof.txt'],
        tests: commands.map((command) => ({ command, exitCode: 0 })),
      },
    ],
  };
}

describe('runProofCommand', () => {
  it('observes a real zero exit', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-ok-'));
    const got = await runProofCommand(
      dir,
      'node -e "process.exit(0)"',
      new FakeClock(),
    );
    expect(got.ok).toBe(true);
    expect(got.exitCode).toBe(0);
    expect(got.reason).toBe('ran');
    expect(got.outputHash.length).toBe(16);
  });

  it('reports a real non-zero exit instead of trusting the caller', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-fail-'));
    const got = await runProofCommand(
      dir,
      'node -e "process.exit(3)"',
      new FakeClock(),
    );
    expect(got.ok).toBe(false);
    expect(got.exitCode).toBe(3);
    expect(got.reason).toBe('exit-3');
  });

  it('rejects empty and non-string commands without spawning', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-empty-'));
    const clock = new FakeClock();
    for (const bad of ['', '   ', 42, null, undefined]) {
      const got = await runProofCommand(dir, bad, clock);
      expect(got.ok).toBe(false);
      expect(got.reason).toBe('empty-command');
      expect(got.exitCode).toBeNull();
    }
  });

  it('kills a hanging command and fails closed on timeout', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-hang-'));
    const got = await runProofCommand(
      dir,
      'node -e "setTimeout(() => {}, 30000)"',
      new FakeClock(),
      150,
    );
    expect(got.ok).toBe(false);
    expect(got.timedOut).toBe(true);
    expect(got.reason).toBe('timeout');
  });

  it('runs inside the project directory', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-cwd-'));
    const got = await runProofCommand(
      dir,
      "node -e \"require('fs').writeFileSync('cwd.txt', process.cwd())\"",
      new FakeClock(),
    );
    expect(got.ok).toBe(true);
    expect(existsSync(path.join(dir, 'cwd.txt'))).toBe(true);
  });

  it('reports an output-limit kill distinctly from a timeout', async () => {
    // Node kills a child whose stdout exceeds maxBuffer. A verbose but passing
    // suite must not be reported as a hang; the reason names the real cause.
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-overflow-'));
    const got = await runProofCommand(
      dir,
      'node -e "process.stdout.write(\'x\'.repeat(2*1024*1024))"',
      new FakeClock(),
    );
    expect(got.ok).toBe(false);
    expect(got.reason).toBe('output-limit');
    expect(got.timedOut).toBe(false);
  });
  it('maps a missing binary to spawn-error', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-spawn-'));
    const got = await runProofCommand(
      dir,
      'goal-proof-definitely-not-a-binary --version',
      new FakeClock(),
    );
    expect(got.ok).toBe(false);
    // A shell that cannot find the binary exits 127 rather than failing to spawn.
    expect(got.reason === 'spawn-error' || got.reason === 'exit-127').toBe(
      true,
    );
  });
});

describe('verifyLocal observation mode', () => {
  it('blocks a fabricated exit code whose command really fails', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-fabric-'));
    const ev = evidenceFor(dir, 'node -e "process.exit(1)"', 0);
    const got = await verifyLocal(dir, ev, {
      runTests: true,
      clock: new FakeClock(),
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toBe('evidence-invalid');
    expect(got.failures.join(' ')).toContain('test-failed:e1:exit=1');
  });

  it('passes when the observed command really exits zero', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-real-'));
    const ev = evidenceFor(dir, 'node -e "process.exit(0)"', 0);
    const got = await verifyLocal(dir, ev, {
      runTests: true,
      clock: new FakeClock(),
    });
    expect(got.ok).toBe(true);
    expect(got.reason).toContain('ok:');
  });

  it('keeps declare-only behavior for legacy callers', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-legacy-'));
    const ev = evidenceFor(dir, 'node -e "process.exit(1)"', 0);
    const got = await verifyLocal(dir, ev);
    // No observation requested: historical behavior is preserved on purpose.
    expect(got.ok).toBe(true);
  });

  it('complete path observes by default', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-default-'));
    const ev = evidenceFor(dir, 'node -e "process.exit(7)"', 0);
    const got = await tryCompleteWithEvidence({
      projectDir: dir,
      evidence: ev,
      clock: new FakeClock(),
    });
    expect(got.ok).toBe(false);
    expect(got.failures.join(' ')).toContain('test-failed:e1:exit=7');
  });

  it('complete path can opt out explicitly', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-optout-'));
    const ev = evidenceFor(dir, 'node -e "process.exit(7)"', 0);
    const got = await tryCompleteWithEvidence({
      projectDir: dir,
      evidence: ev,
      clock: new FakeClock(),
      runTests: false,
    });
    expect(got.ok).toBe(true);
  });

  it('reports missing proof when no command was recorded', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-nocmd-'));
    const ev = evidenceFor(dir, '   ', 0);
    const got = await verifyLocal(dir, ev, {
      runTests: true,
      clock: new FakeClock(),
    });
    expect(got.ok).toBe(false);
    expect(got.failures.join(' ')).toContain('missing-passing-test:e1');
  });

  it('runs every recorded command so a trivial pass cannot mask a failure', async () => {
    // The bypass: a passing command beside the failing suite used to win.
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-multi-'));
    const ev = multiCommandEvidence(dir, [
      'node -e "process.exit(0)"',
      'node -e "process.exit(5)"',
    ]);
    const got = await verifyLocal(dir, ev, {
      runTests: true,
      clock: new FakeClock(),
    });
    expect(got.ok).toBe(false);
    expect(got.failures.join(' ')).toContain('test-failed:e1:exit=5');
  });

  it('maps a hanging command to test-timeout through verifyLocal', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-vtimeout-'));
    const ev = evidenceFor(dir, 'node -e "setTimeout(() => {}, 30000)"');
    const got = await verifyLocal(dir, ev, {
      runTests: true,
      clock: new FakeClock(),
      timeoutMs: 150,
    });
    expect(got.ok).toBe(false);
    expect(got.failures.join(' ')).toContain('test-timeout:e1');
  });

  it('maps an unrunnable command to a distinct failure reason', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-vspawn-'));
    const ev = evidenceFor(dir, 'goal-proof-definitely-not-a-binary --version');
    const got = await verifyLocal(dir, ev, {
      runTests: true,
      clock: new FakeClock(),
    });
    expect(got.ok).toBe(false);
    // Shell reports 127 when the binary is missing; both reasons fail closed.
    expect(got.failures.join(' ')).toMatch(/test-not-run|test-failed/);
  });

  it('enforces the command cap across criteria', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-cap-'));
    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
    const criteria = Array.from({ length: 21 }, (_unused, index) => ({
      id: 'e' + String(index),
      claim: 'work is done',
      files: ['proof.txt'],
      tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
    }));
    const ev: GoalEvidenceFile = {
      version: 1,
      updatedAtMs: 1700000000000,
      criteria,
    };
    const got = await verifyLocal(dir, ev, {
      runTests: true,
      clock: new FakeClock(),
    });
    expect(got.ok).toBe(false);
    expect(got.failures.join(' ')).toContain('test-cap:e20');
  });

  it('rejects a relative project directory without spawning', async () => {
    const got = await runProofCommand(
      'relative/project',
      'node -e "process.exit(0)"',
      new FakeClock(),
    );
    expect(got.ok).toBe(false);
    expect(got.reason).toBe('invalid-cwd');
  });
});
