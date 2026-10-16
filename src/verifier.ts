/**
 * Completion verifier Phase 3.
 * Why this module exists: completion needs checked proof, never agent self-report.
 * Local checks run first; an optional host subagent runs second. Any error keeps the goal active.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GoalEvidenceFile } from './evidence.js';
import { validateEvidenceShape, hashEvidence } from './evidence.js';

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
 * Run local evidence checks: shape plus file existence plus passing test proof.
 * @param projectDir absolute project root for resolving relative citations
 * @param evidence parsed evidence file or null
 */
export async function verifyLocal(
  projectDir: string,
  evidence: GoalEvidenceFile | null,
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
    // Each criterion needs at least one passing test proof.
    const passing = c.tests.some(
      (t) =>
        typeof t.command === 'string' &&
        t.command.length > 0 &&
        t.exitCode === 0,
    );
    if (!passing) failures.push('missing-passing-test:' + c.id);
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
}): Promise<LocalVerifyResult> {
  try {
    const local = await verifyLocal(args.projectDir, args.evidence);
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
 * Wrap-up-once is tracked via state.wrapupSent by callers, not here.
 * @param args project dir plus evidence plus optional host dispatch
 */
export async function tryCompleteWithEvidence(args: {
  projectDir: string;
  evidence: GoalEvidenceFile | null;
  host?: unknown;
  useSubagent?: boolean;
  stateSummary?: string;
}): Promise<LocalVerifyResult> {
  // Delegate to full verifier: local first, optional subagent second.
  const got = await verifyCompletion(args);
  // Map missing proof to explicit gate reason for friendly UI messages.
  if (!got.ok && got.reason === 'missing-evidence') {
    return { ok: false, reason: 'evidence-required', failures: got.failures };
  }
  return got;
}
