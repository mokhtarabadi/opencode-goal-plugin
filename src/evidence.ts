// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
/**
 * Completion evidence sidecar Phase 3.
 * Why this module exists: completion needs cited proof, never self-report alone.
 * Evidence lives beside state in the .opencode dir and is hashed for audit.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sanitizeSessionId } from './state.js';

/** Version of the evidence sidecar format. */
export const EVIDENCE_VERSION = 1 as const;
/** Filename stored under projectDir/.opencode/. */
export const EVIDENCE_FILE_NAME = 'goal-evidence.json';

/** Module counter so parallel tmp files never collide in one process. */
let evidenceTmpCounter = 0;

/** Single test or command proof attached to a criterion. */
export interface EvidenceTestProof {
  command: string;
  exitCode: number;
  output?: string;
  /**
   * Optional environment overrides for this command.
   * Why it exists: a project may need a specific toolchain (a JDK, an SDK path)
   * that the host process does not carry, and a proof command that fails only
   * because of the environment looks exactly like a real failure. Keys are
   * merged over the process environment, so the agent can pin what the command
   * actually needs instead of wrapping it in a shell prefix.
   */
  env?: Record<string, string>;
}

/** One completion criterion with file citations plus test proof. */
export interface EvidenceCriterion {
  id: string;
  claim: string;
  files: string[];
  tests: EvidenceTestProof[];
  /**
   * Previous versions of this criterion, oldest first, capped by
   * MAX_CRITERION_HISTORY. Why it exists: a legitimately-moved citation (a
   * Kanban file promoted from qa to completed, a renamed source) must be
   * correctable without goal_set discarding every other criterion, while the
   * old citation stays readable so goalposts cannot move unseen. The verifier
   * checks current criteria only and never reads this array.
   */
  history?: EvidenceSuperseded[];
}

/** One replaced version of a criterion, kept for audit. */
export interface EvidenceSuperseded {
  claim: string;
  files: string[];
  tests: EvidenceTestProof[];
  /** UTC epoch ms from the injected Clock when this version was replaced. */
  replacedAtMs: number;
}

/** Maximum kept versions per criterion, so a replace loop cannot bloat the sidecar. */
export const MAX_CRITERION_HISTORY = 10;

/** Sidecar file proving goal completion criteria. */
export interface GoalEvidenceFile {
  version: typeof EVIDENCE_VERSION;
  updatedAtMs: number;
  criteria: EvidenceCriterion[];
}

/**
 * Resolve legacy (pre-isolation) evidence sidecar path for a project directory.
 * @param projectDir absolute project root
 * @returns absolute legacy evidence file path
 */
export function resolveLegacyEvidencePath(projectDir: string): string {
  return path.join(projectDir, '.opencode', EVIDENCE_FILE_NAME);
}

/**
 * Resolve evidence sidecar path for a project directory, scoped per session.
 * Old callers pass projectDir only and keep the legacy path.
 * @param projectDir absolute project root
 * @param sessionId optional session lane id; empty or missing means legacy
 * @returns absolute evidence file path
 */
export function resolveEvidencePath(
  projectDir: string,
  sessionId?: string | null,
): string {
  const t = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (t.length === 0) return resolveLegacyEvidencePath(projectDir);
  return path.join(
    projectDir,
    '.opencode',
    'goals',
    sanitizeSessionId(t) + '.evidence.json',
  );
}

/**
 * Build an empty evidence file with injected time.
 * @param nowMs UTC epoch millis from injected Clock
 */
export function emptyEvidence(nowMs: number): GoalEvidenceFile {
  return { version: EVIDENCE_VERSION, updatedAtMs: nowMs, criteria: [] };
}

/**
 * Validate evidence shape without touching disk.
 * @param ev unknown parsed JSON value
 */
export function validateEvidenceShape(ev: unknown): {
  ok: boolean;
  reason: string;
} {
  if (ev === null || typeof ev !== 'object')
    return { ok: false, reason: 'evidence-not-object' };
  const v = ev as Record<string, unknown>;
  if (v['version'] !== EVIDENCE_VERSION)
    return { ok: false, reason: 'evidence-bad-version' };
  if (!Array.isArray(v['criteria']))
    return { ok: false, reason: 'evidence-bad-criteria' };
  const list = v['criteria'] as unknown[];
  if (list.length === 0) return { ok: false, reason: 'evidence-empty' };
  for (const item of list) {
    if (item === null || typeof item !== 'object')
      return { ok: false, reason: 'criterion-not-object' };
    const c = item as Record<string, unknown>;
    if (typeof c['id'] !== 'string' || (c['id'] as string).length === 0)
      return { ok: false, reason: 'criterion-bad-id' };
    if (typeof c['claim'] !== 'string' || (c['claim'] as string).length === 0)
      return { ok: false, reason: 'criterion-bad-claim' };
    if (!Array.isArray(c['files']) || (c['files'] as unknown[]).length === 0)
      return { ok: false, reason: 'criterion-missing-files' };
    if (!Array.isArray(c['tests']) || (c['tests'] as unknown[]).length === 0)
      return { ok: false, reason: 'criterion-missing-tests' };
    // Optional amend history: replaced versions stay readable for audit but never
    // gate proof — the verifier ignores this array, so a stale path kept here
    // cannot fail completion. Shape-checked so a corrupt sidecar still fails loud.
    if (c['history'] !== undefined) {
      if (!Array.isArray(c['history']))
        return { ok: false, reason: 'criterion-bad-history' };
      for (const h of c['history'] as unknown[]) {
        if (h === null || typeof h !== 'object' || Array.isArray(h))
          return { ok: false, reason: 'history-not-object' };
        const e = h as Record<string, unknown>;
        if (
          typeof e['claim'] !== 'string' ||
          (e['claim'] as string).length === 0
        )
          return { ok: false, reason: 'history-bad-claim' };
        if (
          !Array.isArray(e['files']) ||
          !(e['files'] as unknown[]).every((f) => typeof f === 'string')
        )
          return { ok: false, reason: 'history-bad-files' };
        if (
          !Array.isArray(e['tests']) ||
          !(e['tests'] as unknown[]).every(
            (t) =>
              t !== null &&
              typeof t === 'object' &&
              !Array.isArray(t) &&
              typeof (t as Record<string, unknown>)['command'] === 'string' &&
              typeof (t as Record<string, unknown>)['exitCode'] === 'number',
          )
        )
          return { ok: false, reason: 'history-bad-tests' };
        if (typeof e['replacedAtMs'] !== 'number')
          return { ok: false, reason: 'history-bad-replacedAtMs' };
      }
    }
    // Optional env: when present it must be a flat string map, because a nested
    // value would be stringified by the shell and silently change the command.
    for (const t of c['tests'] as unknown[]) {
      if (t === null || typeof t !== 'object' || Array.isArray(t))
        return { ok: false, reason: 'test-not-object' };
      const env = (t as Record<string, unknown>)['env'];
      if (env === undefined) continue;
      if (env === null || typeof env !== 'object' || Array.isArray(env))
        return { ok: false, reason: 'test-env-not-object' };
      for (const value of Object.values(env as Record<string, unknown>)) {
        if (typeof value !== 'string')
          return { ok: false, reason: 'test-env-not-string' };
      }
    }
  }
  return { ok: true, reason: 'ok' };
}

/**
 * Deterministic hash for evidence audit logging.
 * @param ev validated evidence file
 */
export function hashEvidence(ev: GoalEvidenceFile): string {
  const raw = JSON.stringify({ version: ev.version, criteria: ev.criteria });
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * True when a path exists on disk, used to tell an absent scoped file from a
 * present-but-empty one. Any error other than success counts as absent, which
 * keeps a permission failure on the legacy path rather than a hard throw.
 * @param p absolute path
 */
async function existsAt(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load evidence sidecar, returning null when absent or invalid.
 * Scoped first with legacy fallback so old sidecars migrate on next write.
 * A scoped file that exists is authoritative even when it is empty or invalid:
 * both set lanes seed an empty file to discard criteria from finished goals,
 * and that file fails shape validation by design, so falling back on null would
 * resurrect exactly the criteria the set removed.
 * @param projectDir absolute project root
 * @param sessionId optional session lane id; empty or missing means legacy
 */
export async function loadEvidence(
  projectDir: string,
  sessionId?: string | null,
): Promise<GoalEvidenceFile | null> {
  const t = typeof sessionId === 'string' ? sessionId.trim() : '';
  const scoped = resolveEvidencePath(projectDir, sessionId);
  const legacy = resolveLegacyEvidencePath(projectDir);
  const readOne = async (p: string): Promise<GoalEvidenceFile | null> => {
    try {
      const raw = await fs.readFile(p, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const shape = validateEvidenceShape(parsed);
      if (!shape.ok) return null;
      return parsed as GoalEvidenceFile;
    } catch (e: unknown) {
      // ENOENT means no evidence yet; anything else also maps to null so callers stay total.
      const code = (e as { code?: string }).code;
      if (code === 'ENOENT') return null;
      return null;
    }
  };
  if (scoped === legacy || t.length === 0) return readOne(legacy);
  // Presence decides, not the parse result: a session that has its own file has
  // migrated and never reads the shared legacy bucket again.
  if (await existsAt(scoped)) return readOne(scoped);
  return readOne(legacy);
}

/**
 * Save evidence sidecar atomically via tmp plus rename with durability.
 * Why hardening exists: evidence is the second leg of completion proof.
 * Fsync plus chmod mirrors state durability so a crash cannot hollow proof.
 * Scoped saves never write back to the legacy path (migrate-on-write).
 * @param projectDir absolute project root
 * @param ev evidence to persist
 * @param sessionId optional session lane id; empty or missing means legacy
 */
export async function saveEvidence(
  projectDir: string,
  ev: GoalEvidenceFile,
  sessionId?: string | null,
): Promise<void> {
  const target = resolveEvidencePath(projectDir, sessionId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Unique tmp per call so parallel savers never share a tmp file.
  evidenceTmpCounter += 1;
  const tmp =
    target + '.tmp-' + String(process.pid) + '-' + String(evidenceTmpCounter);
  await fs.writeFile(tmp, JSON.stringify(ev, null, 2), 'utf8');
  try {
    // Harden payload before publish; best-effort on exotic FS.
    const fh = await fs.open(tmp, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // Fsync unavailable: rename atomicity still holds.
  }
  try {
    await fs.chmod(tmp, 0o600);
  } catch {
    // Non-POSIX: optional hardening only.
  }
  await fs.rename(tmp, target);
  try {
    await fs.chmod(target, 0o600);
  } catch {
    // Optional hardening only.
  }
}
