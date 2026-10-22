// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
/**
 * Observed test proof runner.
 * Why this module exists: the completion gate used to trust the exit code the
 * caller wrote into the evidence sidecar. Because the agent writes that value
 * itself through `goal_evidence`, the gate rejected empty proof but not false
 * proof. This runner executes the recorded command and reports what actually
 * happened, so completion reads an observation instead of a claim.
 *
 * Boundaries, stated plainly: this is NOT a sandbox and it does not confine the
 * command to the repository. `cwd` sets where the command starts; an absolute
 * path or a `cd` still reaches the rest of the machine. The limits are time, a
 * per-verification command cap, and a bounded output buffer. The justification
 * for running at all is that the evidence sidecar is lease-protected runtime
 * state whose only writer is `goal_evidence`, and the calling agent already
 * holds shell access in its own session, so no capability is added. Never use
 * this runner on a command from an untrusted party.
 */
import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Clock } from './state.js';

/**
 * Per-command wall clock budget.
 * Why 300s: a real full suite on a large repo still fits, a hung or interactive
 * command does not. The gate must fail closed rather than wait forever.
 */
export const PROOF_TIMEOUT_MS = 300000;

/**
 * Captured output ceiling.
 * Why bounded: proof needs a digest for audit, never a full transcript, so a
 * noisy command cannot exhaust memory or bloat the verifier.
 */
export const PROOF_MAX_BUFFER = 1024 * 1024;

/**
 * Commands executed per verification pass.
 * Why capped: a padded sidecar must not turn completion into an unbounded
 * command batch. Every criterion still needs its own proof, so the cap is
 * generous relative to realistic evidence.
 */
export const PROOF_MAX_COMMANDS = 20;

/**
 * Total wall clock budget for one verification pass.
 * Why a separate total: twenty commands at the per-command ceiling would be
 * twenty times the lease window, so the pass needs its own deadline that the
 * caller can also use to size the lease it holds during verification.
 */
export const PROOF_TOTAL_TIMEOUT_MS = 600000;

/** Observed outcome of one proof command. */
export interface ProofResult {
  /** True only when the command ran to completion and exited 0. */
  ok: boolean;
  /** Real exit code, or null when the command never produced one. */
  exitCode: number | null;
  /** True when the timeout killed the command. */
  timedOut: boolean;
  /** Stable machine reason: ran, exit-N, timeout, spawn-error, empty-command. */
  reason: string;
  /** Wall time measured with the injected Clock, so business logic stays deterministic. */
  durationMs: number;
  /** Short sha256 over captured stdout plus stderr, for audit only. */
  outputHash: string;
}

/**
 * Build the failure result for a command that could not produce a pass.
 * Why a helper: four early-exit paths share one shape, and keeping them in one
 * place means a new reason string cannot drift from the interface.
 * @param reason stable machine reason
 * @param durationMs measured wall time, zero when nothing ran
 * @param outputHash digest of whatever was captured, empty when nothing ran
 * @param timedOut true only for the timeout path
 */
function unrunable(
  reason: string,
  durationMs: number,
  outputHash: string,
  timedOut: boolean = false,
): ProofResult {
  return {
    ok: false,
    exitCode: null,
    timedOut,
    reason,
    durationMs,
    outputHash,
  };
}

/**
 * Execute one recorded proof command inside the project directory.
 * Never throws: every spawn, signal, and timeout path maps to a result, because
 * a verifier that throws would surface as an opaque verifier-error instead of a
 * specific reason the caller can act on.
 * @param projectDir absolute project root, used as the working directory
 * @param command recorded command string; non-strings are rejected without spawning
 * @param clock injected clock used only for duration measurement
 * @param timeoutMs per-command budget, defaults to PROOF_TIMEOUT_MS
 */
export async function runProofCommand(
  projectDir: string,
  command: unknown,
  clock: Clock,
  timeoutMs: number = PROOF_TIMEOUT_MS,
): Promise<ProofResult> {
  const started = clock.nowMs();
  // Trim and type-check before spawning: an empty command would be a silent no-op.
  const cmd = typeof command === 'string' ? command.trim() : '';
  if (cmd.length === 0) return unrunable('empty-command', 0, '');
  // Absolute cwd only: a relative path would resolve against the server process
  // and could point the proof outside the repo it claims to verify.
  if (typeof projectDir !== 'string' || !path.isAbsolute(projectDir))
    return unrunable('invalid-cwd', 0, '');
  const raw = await new Promise<{
    code: number | null;
    killed: boolean;
    overflow: boolean;
    output: string;
  }>((resolve) => {
    try {
      exec(
        cmd,
        {
          // Pin the working directory so proof runs where the citations live.
          cwd: projectDir,
          timeout: timeoutMs,
          // Bounded capture: stdout plus stderr beyond this is dropped.
          maxBuffer: PROOF_MAX_BUFFER,
          encoding: 'utf8',
          // Portable shell: POSIX uses sh explicitly, Windows uses the system
          // command processor. Pinning /bin/sh unconditionally broke Windows.
          shell:
            process.platform === 'win32'
              ? (process.env.ComSpec ?? 'cmd.exe')
              : '/bin/sh',
          // Explicit kill signal so a timeout is distinguishable from a crash.
          killSignal: 'SIGTERM',
          env: {
            ...process.env,
            // Non-interactive hygiene: no color, no prompts, no pager waits.
            CI: '1',
            NO_COLOR: '1',
            GIT_TERMINAL_PROMPT: '0',
            PIP_NO_INPUT: '1',
          },
        },
        (err, stdout, stderr) => {
          // exec reports a numeric exit code on `code`. A spawn failure such as
          // ENOENT reports a string code instead, which means "never ran".
          const e = err as
            | (NodeJS.ErrnoException & {
                killed?: boolean;
                signal?: NodeJS.Signals | null;
              })
            | null;
          const rawCode = e === null ? 0 : (e as { code?: unknown }).code;
          // Node kills a child whose output exceeds maxBuffer and reports this
          // code. That is an output-limit event, not a timeout, and it must not
          // be reported as one: a verbose but passing suite would look hung.
          const overflow =
            e !== null &&
            (e as { code?: unknown }).code ===
              'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          // A timeout kill shows up as killed true, or as a termination signal
          // with no exit code. Both mean the command never finished on its own.
          const killedByTimeout =
            e !== null &&
            !overflow &&
            ((e as { killed?: boolean }).killed === true ||
              (e as { signal?: unknown }).signal === 'SIGTERM' ||
              (e as { signal?: unknown }).signal === 'SIGKILL');
          resolve({
            code: typeof rawCode === 'number' ? rawCode : e === null ? 0 : null,
            killed: killedByTimeout,
            overflow,
            output: String(stdout ?? '') + String(stderr ?? ''),
          });
        },
      );
    } catch {
      // Malformed options or a synchronous spawn failure: never ran.
      resolve({
        code: null,
        killed: false,
        overflow: false,
        output: '',
      });
    }
  });
  const durationMs = Math.max(0, clock.nowMs() - started);
  const outputHash = createHash('sha256')
    .update(raw.output)
    .digest('hex')
    .slice(0, 16);
  // Output overflow first: Node kills the child, and calling that a timeout
  // would blame the wrong cause for a verbose suite.
  if (raw.overflow) return unrunable('output-limit', durationMs, outputHash);
  // Timeout next: a killed child usually has no exit code to report.
  if (raw.killed) return unrunable('timeout', durationMs, outputHash, true);
  if (raw.code === null)
    return unrunable('spawn-error', durationMs, outputHash);
  if (raw.code === 0) {
    return {
      ok: true,
      exitCode: 0,
      timedOut: false,
      reason: 'ran',
      durationMs,
      outputHash,
    };
  }
  return {
    ok: false,
    exitCode: raw.code,
    timedOut: false,
    reason: 'exit-' + String(raw.code),
    durationMs,
    outputHash,
  };
}
