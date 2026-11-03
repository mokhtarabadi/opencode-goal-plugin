// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
/**
 * Completion verifier Phase 3.
 * Why this module exists: completion needs checked proof, never agent self-report.
 * Local checks run first; an optional host subagent runs second. Any error keeps the goal active.
 */
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
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
  /**
   * Which project path satisfied each accepted file citation, in evidence order.
   * Why this field exists: a citation that moved inside the project (a Kanban
   * lane promotion, a rename) still proves the criterion, but the operator must
   * be told which path actually answered it instead of guessing.
   */
  citations?: ResolvedCitation[];
}

/** One accepted file citation plus the project path that satisfied it. */
export interface ResolvedCitation {
  /** Criterion the citation belongs to. */
  criterionId: string;
  /** Path exactly as recorded in the evidence sidecar. */
  cited: string;
  /** Project-relative path (forward slashes) that satisfied the citation. */
  resolved: string;
  /** True when `resolved` differs from the recorded path (the file moved). */
  moved: boolean;
}

/**
 * Directory names a basename citation search never descends into.
 * Why this list: build output and dependency trees are large, generated, and
 * never the file a criterion cites, so skipping them keeps the search cheap on
 * a big repository without weakening the guard (the search stays inside the
 * project root either way).
 */
const BASENAME_SKIP_DIRS = new Set([
  '.git',
  '.opencode',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.venv',
  'venv',
  'target',
  '__pycache__',
]);

/**
 * Maximum directory entries one basename search examines before it gives up.
 * Why a cap at all: completion must stay bounded on a huge repository, so a
 * pathological tree cannot stall the proof pass. 50 000 entries comfortably
 * covers a large source tree once dependency, virtualenv and build directories
 * are skipped, and a deleted file still yields zero matches inside the cap,
 * which is the fail-closed answer this feature must preserve.
 */
export const BASENAME_SCAN_LIMIT = 50000;

/** Maximum directory depth one basename search descends. */
const BASENAME_MAX_DEPTH = 12;

/** Maximum matches collected before a search stops: enough to prove ambiguity. */
const BASENAME_MATCH_LIMIT = 32;

/** How many candidate paths an ambiguity failure names before summarizing. */
export const AMBIGUOUS_CANDIDATE_LIMIT = 5;

/**
 * Render one absolute path as a project-relative, forward-slash path.
 * Why normalize: failure strings and citations travel between platforms, so a
 * Windows backslash must not make the same file look like a different one.
 * @param base absolute project root
 * @param absolute absolute path inside the project
 */
function toProjectRelative(base: string, absolute: string): string {
  return path.relative(base, absolute).split(path.sep).join('/');
}

/**
 * Find every file under the project whose basename matches exactly.
 * Why basename only: a citation is a path, but the file's identity survives a
 * move; the exact path is tried first and this search only runs after it missed.
 * Deterministic order (sorted entries, depth first) so an ambiguity report is
 * stable, and bounded by an entry cap plus a depth cap so a huge tree cannot
 * stall completion. Symlinks are skipped so a cycle cannot loop forever.
 * @param projectDir absolute project root
 * @param basename file name to match, e.g. `16-foo.md`
 */
async function findFilesByBasename(
  projectDir: string,
  basename: string,
): Promise<string[]> {
  const base = path.resolve(projectDir);
  const matches: string[] = [];
  let seen = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > BASENAME_MAX_DEPTH || seen > BASENAME_SCAN_LIMIT) return;
    if (matches.length >= BASENAME_MATCH_LIMIT) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable directory: it simply contributes no match.
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      seen += 1;
      if (seen > BASENAME_SCAN_LIMIT) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (BASENAME_SKIP_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name), depth + 1);
        if (matches.length >= BASENAME_MATCH_LIMIT) return;
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name !== basename) continue;
      matches.push(toProjectRelative(base, path.join(dir, entry.name)));
      if (matches.length >= BASENAME_MATCH_LIMIT) return;
    }
  };
  await walk(base, 0);
  return matches;
}

/**
 * Resolve one citation to a real file without ever leaving the project.
 * Why this order: an exact path is unambiguous, so it always wins and never
 * costs a tree walk. Only a miss triggers the basename search, and that search
 * accepts a hit only when it is unique — guessing between two same-named files
 * would prove the wrong file, so ambiguity is reported as a failure that names
 * the candidates. No match at all keeps the historical `missing-file`.
 * @param projectDir absolute project root
 * @param criterionId criterion the citation belongs to
 * @param cited path exactly as recorded in the evidence sidecar
 */
async function resolveCitation(
  projectDir: string,
  criterionId: string,
  cited: string,
): Promise<{ citation: ResolvedCitation | null; failure: string | null }> {
  const base = path.resolve(projectDir);
  const target = path.isAbsolute(cited) ? cited : path.join(projectDir, cited);
  try {
    // Require a real file: directories and missing paths both fail proof.
    const st = await fs.stat(target);
    if (!st.isFile()) {
      return {
        citation: null,
        failure: 'not-a-file:' + criterionId + ':' + cited,
      };
    }
    return {
      citation: {
        criterionId,
        cited,
        resolved: toProjectRelative(base, target),
        moved: false,
      },
      failure: null,
    };
  } catch {
    // Missing exact path: try identity by basename before failing below.
  }
  const basename = path.basename(cited);
  if (basename === '' || basename === '.' || basename === '..') {
    return {
      citation: null,
      failure: 'missing-file:' + criterionId + ':' + cited,
    };
  }
  const matches = await findFilesByBasename(projectDir, basename);
  if (matches.length === 0) {
    return {
      citation: null,
      failure: 'missing-file:' + criterionId + ':' + cited,
    };
  }
  if (matches.length === 1) {
    return {
      citation: {
        criterionId,
        cited,
        resolved: matches[0],
        moved: true,
      },
      failure: null,
    };
  }
  const named = matches.slice(0, AMBIGUOUS_CANDIDATE_LIMIT).join(',');
  const more =
    matches.length > AMBIGUOUS_CANDIDATE_LIMIT
      ? '(+' + String(matches.length - AMBIGUOUS_CANDIDATE_LIMIT) + ' more)'
      : '';
  return {
    citation: null,
    failure:
      'ambiguous-citation:' + criterionId + ':' + cited + ':' + named + more,
  };
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
      candidate.env,
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
  const citations: ResolvedCitation[] = [];
  // Spot-moved citations so the success path can name the path that proved them.
  const movedCitations: string[] = [];
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
      // Exact path first, then a unique basename hit; ambiguity and no match
      // both stay failures so a deleted file can never pass as a move.
      const resolved = await resolveCitation(projectDir, c.id, String(f));
      if (resolved.failure !== null) {
        failures.push(resolved.failure);
        continue;
      }
      if (resolved.citation !== null) {
        citations.push(resolved.citation);
        if (resolved.citation.moved) {
          movedCitations.push(
            resolved.citation.cited + '->' + resolved.citation.resolved,
          );
        }
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
    return { ok: false, reason: 'evidence-invalid', failures, citations };
  // Name every moved citation on the success path: the proof is accepted, but
  // the operator still learns which path answered a citation that had moved.
  const movedNote =
    movedCitations.length === 0
      ? ''
      : ' moved-citations:' + movedCitations.join(', ');
  return {
    ok: true,
    reason: 'ok:' + hashEvidence(evidence) + movedNote,
    failures: [],
    citations,
  };
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
        citations: local.citations,
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

/** How many concrete failures a blocked message quotes before it summarizes. */
export const BLOCKED_FAILURE_LIMIT = 5;

/**
 * Build the operator/agent-facing message for a blocked completion.
 *
 * Why this exists: the verifier already produces precise reasons
 * (`test-failed:<id>:exit=1`, `missing-file:<id>:<path>`, `test-budget:<id>`),
 * but both completion lanes printed one canned sentence telling the agent to
 * "add file citations plus passing tests" even when the citations were fine and
 * a recorded command simply exited non-zero. The failures were built and then
 * discarded, so the only actionable diagnosis never reached the caller.
 * Quoting them (bounded, so a padded sidecar cannot flood the reply) makes the
 * block self-explaining.
 * @param reason stable verifier reason, e.g. `evidence-invalid`
 * @param failures concrete failures produced by the verifier
 * @returns one message with the reason plus each failure
 */
export function describeVerificationFailure(
  reason: string,
  failures: string[],
): string {
  const clean = (failures ?? [])
    .filter((f) => typeof f === 'string' && f.trim().length > 0)
    .map((f) => f.trim());
  if (clean.length === 0) {
    return 'Complete blocked: ' + reason + '. Add evidence and retry.';
  }
  const shown = clean.slice(0, BLOCKED_FAILURE_LIMIT).join('; ');
  const more =
    clean.length > BLOCKED_FAILURE_LIMIT
      ? ' (+' + String(clean.length - BLOCKED_FAILURE_LIMIT) + ' more)'
      : '';
  return 'Complete blocked: ' + reason + ' — ' + shown + more + '.';
}
