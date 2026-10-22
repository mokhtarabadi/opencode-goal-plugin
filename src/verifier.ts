// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
/**
 * Completion verifier Phase 3.
 * Why this module exists: completion needs checked proof, never agent self-report.
 * Local checks run first; an optional host subagent runs second. Any error keeps the goal active.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EvidenceCriterion, GoalEvidenceFile } from './evidence.js';
import { validateEvidenceShape, hashEvidence } from './evidence.js';
import { SystemClock } from './state.js';
import type { Clock } from './state.js';
import {
  PROOF_MAX_COMMANDS,
  PROOF_TIMEOUT_MS,
  PROOF_TOTAL_TIMEOUT_MS,
  runProofCommand,
} from './proof.js';

/**
 * Return true only when a citation resolves to a file inside projectDir.
 * Rejects empty, dot, absolute escapes, and dot-dot traversal, plus any
 * non-string input, so evidence cannot cite outside the verified project.
 * @param projectDir absolute project root
 * @param citation cited path, relative or absolute
 */
export function isCitationInsideProjectDir(
  projectDir: string,
  citation: string,
): boolean {
  try {
    // Non-string JSON values fail closed instead of throwing in path calls.
    if (typeof citation !== 'string') {
      return false;
    }
    if (citation.trim() === '') {
      return false;
    }
    // Resolve both sides: a citation escaping via dot-dot lands outside base.
    const base = path.resolve(projectDir);
    const target = path.resolve(base, citation);
    const rel = path.relative(base, target);
    // Empty or dot relative means the project dir itself, not a file: reject.
    if (rel === '' || rel === '.') {
      return false;
    }
    // Exact parent segments only: names merely starting with two dots stay inside.
    if (
      rel === '..' ||
      rel.startsWith('..' + path.sep) ||
      path.isAbsolute(rel)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Local verification outcome. Verifier errors keep goal active. */
export interface LocalVerifyResult {
  ok: boolean;
  reason: string;
  failures: string[];
}

/**
 * Options for local verification.
 * Why optional: existing callers pass only projectDir plus evidence and keep
 * the historical declare-only behavior. The completion path opts into
 * observation so online agents cannot close a goal on a typed exit code.
 */
export interface VerifyLocalOptions {
  /**
   * When true, execute each criterion's recorded command and require an
   * observed exit 0 instead of trusting the declared exitCode.
   */
  runTests?: boolean;
  /** Injected clock for measured durations; defaults to SystemClock. */
  clock?: Clock;
  /** Per-command timeout override, mainly for tests. */
  timeoutMs?: number;
}

/**
 * Observe every recorded test command for one criterion.
 * Why every command: running only the preferred one lets a caller bolt a
 * trivial passing command onto a failing suite, which would make observation
 * decorative. All non-empty commands must pass, so a hidden failure surfaces.
 * Budget: each command gets the smaller of the per-command timeout and the
 * remaining share of the pass deadline; an exhausted pass fails closed.
 * @param projectDir absolute project root, the command working directory
 * @param criterion one evidence criterion
 * @param opts verification options carrying clock and timeout overrides
 * @param executed shared counter enforcing the per-verification cap
 * @param deadlineMs absolute epoch ms when this pass must stop starting work
 * @returns null when every command observed ok, else a stable failure string
 */
async function observeCriterionTests(
  projectDir: string,
  criterion: EvidenceCriterion,
  opts: VerifyLocalOptions,
  executed: { count: number },
  deadlineMs: number,
): Promise<string | null> {
  // Only non-empty command strings are runnable; a blank one proves nothing.
  const candidates = criterion.tests.filter(
    (t) => typeof t.command === 'string' && t.command.trim().length > 0,
  );
  if (candidates.length === 0) return 'missing-passing-test:' + criterion.id;
  const clock = opts.clock ?? new SystemClock();
  for (const candidate of candidates) {
    if (executed.count >= PROOF_MAX_COMMANDS) return 'test-cap:' + criterion.id;
    // Remaining budget shrinks the per-command window so the pass stays bounded.
    const remaining = deadlineMs - clock.nowMs();
    if (remaining <= 0) return 'test-budget:' + criterion.id;
    const perCommand = Math.min(opts.timeoutMs ?? PROOF_TIMEOUT_MS, remaining);
    executed.count += 1;
    const proof = await runProofCommand(
      projectDir,
      candidate.command,
      clock,
      perCommand,
    );
    // Observed success is the only pass: the declared exit code is ignored here.
    if (proof.ok) continue;
    if (proof.timedOut) return 'test-timeout:' + criterion.id;
    if (proof.exitCode !== null)
      return 'test-failed:' + criterion.id + ':exit=' + String(proof.exitCode);
    return 'test-not-run:' + criterion.id + ':' + proof.reason;
  }
  return null;
}

/** Minimal host probe for optional subagent dispatch. TO-VERIFY on host v2.0.29. */
export type SubagentRunner = (input: {
  stateSummary: string;
  evidence: GoalEvidenceFile;
}) => Promise<{ pass: boolean; reason: string }>;

/**
 * Probe host for a subagent runner without throwing.
 * @param host unknown host object passed to registration
 */
export function getSubagentRunner(host: unknown): SubagentRunner | null {
  if (host === null || typeof host !== 'object') return null;
  const h = host as Record<string, unknown>;
  // Known runner names across host generations; first function wins.
  for (const key of ['spawnSubagent', 'runSubagent', 'createTask']) {
    if (typeof h[key] === 'function') return h[key] as SubagentRunner;
  }
  return null;
}

/**
 * Run local evidence checks: shape plus file existence plus test proof.
 * Test proof is either declared (default, historical behavior) or observed by
 * executing the recorded command when `opts.runTests` is true.
 * @param projectDir absolute project root for resolving relative citations
 * @param evidence parsed evidence file or null
 * @param opts observation mode plus clock and timeout overrides
 */
export async function verifyLocal(
  projectDir: string,
  evidence: GoalEvidenceFile | null,
  opts?: VerifyLocalOptions,
): Promise<LocalVerifyResult> {
  if (evidence === null)
    return {
      ok: false,
      reason: 'missing-evidence',
      failures: ['no evidence file'],
    };
  const shape = validateEvidenceShape(evidence);
  if (!shape.ok)
    return { ok: false, reason: shape.reason, failures: [shape.reason] };
  const failures: string[] = [];
  // Shared command budget across all criteria for this verification pass.
  const executed = { count: 0 };
  // One deadline per pass so a padded sidecar cannot run for hours.
  const deadlineMs =
    (opts?.clock ?? new SystemClock()).nowMs() + PROOF_TOTAL_TIMEOUT_MS;
  for (const c of evidence.criteria) {
    for (const f of c.files) {
      // Traversal guard first: outside citations fail without filesystem reads.
      if (!isCitationInsideProjectDir(projectDir, f)) {
        failures.push('traversal-escape:' + c.id + ':' + String(f));
        continue;
      }
      try {
        // Require a real file: directories and missing paths both fail proof.
        const p = path.isAbsolute(f) ? f : path.join(projectDir, f);
        const st = await fs.stat(p);
        if (!st.isFile()) {
          failures.push('not-a-file:' + c.id + ':' + String(f));
        }
      } catch {
        failures.push('missing-file:' + c.id + ':' + String(f));
      }
    }
    if (opts?.runTests === true) {
      // Observed mode: a declared exit code cannot stand in for a real run.
      const reason = await observeCriterionTests(
        projectDir,
        c,
        opts,
        executed,
        deadlineMs,
      );
      if (reason !== null) failures.push(reason);
    } else {
      // Declared mode: each criterion needs at least one declared passing test.
      const passing = c.tests.some(
        (t) =>
          typeof t.command === 'string' &&
          t.command.length > 0 &&
          t.exitCode === 0,
      );
      if (!passing) failures.push('missing-passing-test:' + c.id);
    }
  }
  if (failures.length > 0)
    return { ok: false, reason: 'evidence-invalid', failures };
  return { ok: true, reason: 'ok:' + hashEvidence(evidence), failures: [] };
}

/**
 * Full completion check: local first, optional subagent second.
 * Any throw maps to not-ok so the goal stays active.
 * @param args project dir plus evidence plus optional host dispatch
 */
export async function verifyCompletion(args: {
  projectDir: string;
  evidence: GoalEvidenceFile | null;
  host?: unknown;
  useSubagent?: boolean;
  stateSummary?: string;
  /** When true, local verification executes recorded commands. */
  runTests?: boolean;
  /** Injected clock for measured proof durations. */
  clock?: Clock;
  /** Per-command timeout override. */
  timeoutMs?: number;
}): Promise<LocalVerifyResult> {
  try {
    const local = await verifyLocal(args.projectDir, args.evidence, {
      runTests: args.runTests === true,
      clock: args.clock,
      timeoutMs: args.timeoutMs,
    });
    if (!local.ok) return local;
    if (args.useSubagent !== true) return local;
    const runner = getSubagentRunner(args.host ?? null);
    if (runner === null) return local;
    if (args.evidence === null) return local;
    const out = await runner({
      stateSummary: args.stateSummary ?? '',
      evidence: args.evidence,
    });
    if (out.pass === true)
      return {
        ok: true,
        reason: 'subagent-pass:' + local.reason,
        failures: [],
      };
    return {
      ok: false,
      reason: 'subagent-fail:' + String(out.reason),
      failures: ['subagent rejected'],
    };
  } catch {
    return {
      ok: false,
      reason: 'verifier-error',
      failures: ['verifier threw'],
    };
  }
}

/**
 * Evidence-gated completion check for the complete path.
 * Why this helper exists: goal-loop evidence discipline blocks bare
 * self-report completes while keeping the legacy pure completeGoal intact
 * for backwards compatibility. Returns pass only when local verifier ok.
 * Observation is ON by default here: both complete lanes go through this
 * helper, and the gate must read a real exit code rather than a typed one.
 * Pass `runTests: false` only for a caller that explicitly wants declare-only.
 * Wrap-up-once is tracked via state.wrapupSent by callers, not here.
 * @param args project dir plus evidence plus optional host dispatch
 */
export async function tryCompleteWithEvidence(args: {
  projectDir: string;
  evidence: GoalEvidenceFile | null;
  host?: unknown;
  useSubagent?: boolean;
  stateSummary?: string;
  /** Defaults to true; false restores declare-only verification. */
  runTests?: boolean;
  /** Injected clock for measured proof durations. */
  clock?: Clock;
  /** Per-command timeout override. */
  timeoutMs?: number;
}): Promise<LocalVerifyResult> {
  // Delegate to full verifier: local first (observed by default), subagent second.
  const got = await verifyCompletion({
    ...args,
    runTests: args.runTests !== false,
  });
  // Map missing proof to explicit gate reason for friendly UI messages.
  if (!got.ok && got.reason === 'missing-evidence') {
    return { ok: false, reason: 'evidence-required', failures: got.failures };
  }
  return got;
}
