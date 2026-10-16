/**
 * Completion evidence sidecar Phase 3.
 * Why this module exists: completion needs cited proof, never self-report alone.
 * Evidence lives beside state in the .opencode dir and is hashed for audit.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
}

/** One completion criterion with file citations plus test proof. */
export interface EvidenceCriterion {
  id: string;
  claim: string;
  files: string[];
  tests: EvidenceTestProof[];
}

/** Sidecar file proving goal completion criteria. */
export interface GoalEvidenceFile {
  version: typeof EVIDENCE_VERSION;
  updatedAtMs: number;
  criteria: EvidenceCriterion[];
}

/**
 * Resolve evidence sidecar path for a project directory.
 * @param projectDir absolute project root
 * @returns absolute evidence file path
 */
export function resolveEvidencePath(projectDir: string): string {
  return path.join(projectDir, '.opencode', EVIDENCE_FILE_NAME);
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
 * Load evidence sidecar, returning null when absent or invalid.
 * @param projectDir absolute project root
 */
export async function loadEvidence(
  projectDir: string,
): Promise<GoalEvidenceFile | null> {
  try {
    const raw = await fs.readFile(resolveEvidencePath(projectDir), 'utf8');
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
}

/**
 * Save evidence sidecar atomically via tmp plus rename with durability.
 * Why hardening exists: evidence is the second leg of completion proof.
 * Fsync plus chmod mirrors state durability so a crash cannot hollow proof.
 * @param projectDir absolute project root
 * @param ev evidence to persist
 */
export async function saveEvidence(
  projectDir: string,
  ev: GoalEvidenceFile,
): Promise<void> {
  const target = resolveEvidencePath(projectDir);
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
