// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
/**
 * Agent-callable goal tools.
 * Why this module exists: the model needs to drive the goal itself mid-session
 * (set, block, complete, resume, evidence) without waiting for the user to type
 * a slash command. This mirrors the smart-compact `compact_context` tool pattern:
 * `ctx.tool.transform` with a JSON Schema input.
 * Each execute path calls the pure transition helpers in goal.js directly with
 * already-validated data — never by rebuilding a slash string, so a title
 * like 'block foo' can never misroute into another subcommand. Messages match
 * handleGoalCommand exactly (parity-tested), and every mutation runs under the
 * file lease so parallel tool calls cannot clobber each other. Tool results
 * are friendly strings, never throws.
 */
import type { Clock, GoalState } from './state.js';
import {
  LEASE_TTL_MS,
  acquireScopedLock,
  goalIdentity,
  loadGoalState,
  loadGoalStateWithFallback,
  releaseLease,
  releaseScopedLock,
  resolveLegacyStatePath,
  resolveStatePath,
  saveGoalState,
  tryClaimLease,
} from './state.js';
import {
  BlockInputSchema,
  CompleteInputSchema,
  EvidenceInputSchema,
  GoalInputSchema,
  ResumeInputSchema,
  blockGoal,
  completeGoal,
  isSafeGoalTitle,
  resumeGoal,
  setObjective,
} from './goal.js';
import {
  emptyEvidence,
  loadEvidence,
  saveEvidence,
  validateEvidenceShape,
} from './evidence.js';
import type { EvidenceTestProof } from './evidence.js';
import {
  describeVerificationFailure,
  tryCompleteWithEvidence,
} from './verifier.js';
import { PROOF_TOTAL_TIMEOUT_MS } from './proof.js';

/** Host version stamped on tool-created state, matching the slash lane. */
const TOOL_HOST_VERSION = '2.0.29';

/** Minimal structural shape of one tool definition for editor.add. */
interface GoalToolDef {
  /** Tool name as the model sees it. */
  name: string;
  /** One-line description guiding the model when to call it. */
  description: string;
  /** JSON Schema input, always closed with additionalProperties false. */
  input: unknown;
  /** Execute handler: input plus host context, text result, never throws. */
  execute: (input: unknown, context: unknown) => Promise<{ content: string }>;
}

/** Minimal structural shape of the host tool editor. */
interface GoalToolEditor {
  /** Register one tool definition. */
  add: (def: GoalToolDef) => void;
}

/**
 * Extract the lane session id from a tool-call context.
 * Why this helper exists: the host passes `sessionID` on the tool context,
 * the same field name the slash lane reads from its invocation. It becomes
 * part of the lease owner for audit, so concurrent lanes are distinguishable
 * in a held-lease state. Missing or non-string falls back to 'unknown'.
 * @param context unknown host tool-call context
 */
function toolSessionId(context: unknown): string {
  // Defensive read: a misbehaving host gets 'unknown', never a TypeError.
  if (context !== null && typeof context === 'object') {
    const id = (context as { sessionID?: unknown }).sessionID;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return 'unknown';
}

/**
 * Message for a corrupt state file, identical to the slash lane.
 * Why shared text matters: agents and users get one recovery story.
 */
function corruptMessage(statePath: string): string {
  return (
    'Goal state is corrupt at ' +
    statePath +
    '. Back up the file then clear it.'
  );
}

/** Module counter so two calls in one session never share a lease owner id. */
let toolOwnerSeq = 0;

/** Message when another turn holds the lease; no mutation happened. */
const BUSY_MESSAGE = 'Goal is busy with another turn. Retry shortly.';

/**
 * Message when the goal identity changed during a long completion pass.
 * Why shared text: the slash lane reports the same string, so callers see one
 * recovery story no matter which surface started the completion.
 */
const STATE_CHANGED_MESSAGE =
  'Goal state changed while completing. Run /goal status and retry.';

/**
 * Guard handed back by `claimForTool`.
 * Why a release closure: two different guards are possible (scoped lock for a
 * first write, file lease otherwise) and only the guard this call actually took
 * may be released. Unlinking a shared lock path unconditionally would delete a
 * different writer's lock.
 */
interface ToolClaim {
  claimed: boolean;
  release: () => Promise<void>;
}

/**
 * Claim the file lease for a tool mutation, or the scoped lock on a first write.
 * Why lease first: two parallel tool calls (or a tool plus the idle loop) must
 * serialize their read-modify-write. A missing state file cannot be leased, so
 * that path takes the dedicated scoped lock instead; with no file at all the
 * first set still takes the lock so two first sets cannot interleave.
 * @returns the claim plus the closure that releases exactly what was taken
 */
async function claimForTool(
  statePath: string,
  legacyPath: string,
  current: GoalState | null,
  owner: string,
  clock: Clock,
  ttlMs: number = LEASE_TTL_MS,
): Promise<ToolClaim> {
  const takeLock = async (): Promise<ToolClaim> => {
    const ok = await acquireScopedLock(statePath, owner, ttlMs, clock);
    return {
      claimed: ok,
      release: async () => {
        await releaseScopedLock(statePath);
      },
    };
  };
  const noopRelease = async (): Promise<void> => {
    // Nothing was acquired: releasing would touch another writer's guard.
  };
  // No state file at all: serialize the very first write with the lock.
  if (current === null) return takeLock();
  // Scoped file missing but legacy content may exist: lock the migration window.
  if (statePath !== legacyPath) {
    let scopedMissing = false;
    try {
      scopedMissing = (await loadGoalState(statePath)) === null;
    } catch {
      // Corrupt scoped file falls through to the lease, which fails closed.
      scopedMissing = false;
    }
    if (scopedMissing) return takeLock();
  }
  try {
    const res = await tryClaimLease(statePath, owner, ttlMs, clock);
    if (!res.claimed) return { claimed: false, release: noopRelease };
    return {
      claimed: true,
      release: async () => {
        try {
          await releaseLease(statePath, owner, clock);
        } catch {
          // Release failure is safe: the TTL reclaims a stale lease.
        }
      },
    };
  } catch {
    // Lock I/O failure fails closed: never mutate without a guard.
    return { claimed: false, release: noopRelease };
  }
}

/**
 * Unique lease owner for one tool invocation.
 * Why not the bare session id: the lease treats a repeated owner as the same
 * writer and lets it re-claim, so two concurrent calls in one session could both
 * enter a read-modify-write. A per-call suffix makes them distinct.
 * @param sessionID lane id from the host tool context
 */
function toolOwner(sessionID: string): string {
  toolOwnerSeq += 1;
  return 'tool:' + sessionID + ':' + String(toolOwnerSeq);
}

/**
 * Map a lane id to a storage session: host-less markers stay on legacy.
 * Why this helper exists: toolSessionId returns 'unknown' when the host omits
 * the session, and the slash lane historically passed 'slash' as the lane.
 * Neither is a real session, so both map to legacy (undefined) to keep old
 * callers green. Real session ids pass through to per-session files.
 * @param sessionID lane id from toolSessionId or slash wiring
 */
function storageSessionFor(sessionID: string): string | undefined {
  const t = typeof sessionID === 'string' ? sessionID.trim() : '';
  if (t === '' || t === 'unknown' || t === 'slash') return undefined;
  return t;
}

/**
 * Load current state with legacy fallback, mapping corruption to the message.
 * Scoped missing plus legacy present returns legacy content; next save lands
 * scoped (migrate-on-write). Corrupt scoped fails closed without fallback.
 */
async function loadForTool(
  statePath: string,
  legacyPath: string,
): Promise<{ state: GoalState | null } | { error: string }> {
  try {
    if (statePath === legacyPath)
      return { state: await loadGoalState(statePath) };
    // Corrupt scoped throws inside and maps to the corrupt message below.
    return { state: await loadGoalStateWithFallback(statePath, legacyPath) };
  } catch {
    return { error: corruptMessage(statePath) };
  }
}

/**
 * Set the goal to a literal title.
 * Why direct helper call: the title is data, never re-parsed, so reserved
 * words and newlines cannot trigger another subcommand.
 */
async function toolSet(
  projectDir: string,
  clock: Clock,
  title: unknown,
  sessionID: string,
): Promise<string> {
  // Same validation as the slash lane: string, 1..2000, traversal-safe.
  if (
    typeof title !== 'string' ||
    title.trim().length < 1 ||
    title.length > 2000
  ) {
    return 'Invalid /goal usage. Try /goal <objective> or /goal status.';
  }
  if (!isSafeGoalTitle(title)) {
    return 'Invalid /goal usage. Objective must not be a path escape.';
  }
  const storage = storageSessionFor(sessionID);
  const statePath = resolveStatePath(projectDir, storage);
  const legacyPath = resolveLegacyStatePath(projectDir);
  const loaded = await loadForTool(statePath, legacyPath);
  if ('error' in loaded) return loaded.error;
  const owner = toolOwner(sessionID);
  const claim = await claimForTool(
    statePath,
    legacyPath,
    loaded.state,
    owner,
    clock,
  );
  if (!claim.claimed) return BUSY_MESSAGE;
  try {
    const next = setObjective(loaded.state, title, clock, TOOL_HOST_VERSION);
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    // Seed a fresh evidence sidecar, exactly as the slash set lane does
    // (index.ts). Without this reset the session sidecar accumulates criteria
    // from finished goals, and the verifier runs and validates every one of
    // them, so a stale failing command blocks completion with evidence-invalid
    // forever. Best-effort like the slash lane: a failed seed must not undo a
    // saved goal, and the gate still fails closed on missing proof.
    try {
      await saveEvidence(projectDir, emptyEvidence(clock.nowMs()), storage);
    } catch {
      // Non-fatal: the goal is set; stale criteria may still gate completion.
    }
    return 'Goal set to active: ' + next.objective;
  } finally {
    await claim.release();
  }
}

/**
 * Mark the active goal blocked with a literal reason.
 */
async function toolBlock(
  projectDir: string,
  clock: Clock,
  reason: unknown,
  sessionID: string,
): Promise<string> {
  if (
    typeof reason !== 'string' ||
    reason.trim().length < 1 ||
    reason.length > 2000
  ) {
    return 'Invalid usage. Provide a reason string.';
  }
  const storage = storageSessionFor(sessionID);
  const statePath = resolveStatePath(projectDir, storage);
  const legacyPath = resolveLegacyStatePath(projectDir);
  const loaded = await loadForTool(statePath, legacyPath);
  if ('error' in loaded) return loaded.error;
  if (loaded.state === null) {
    return 'No goal set. Use /goal <objective> first.';
  }
  const owner = toolOwner(sessionID);
  const claim = await claimForTool(
    statePath,
    legacyPath,
    loaded.state,
    owner,
    clock,
  );
  if (!claim.claimed) return BUSY_MESSAGE;
  try {
    // Reload inside the guard: the pre-claim snapshot may be stale, and acting
    // on it would overwrite a change made between load and claim.
    const fresh = await loadForTool(statePath, legacyPath);
    if ('error' in fresh) return fresh.error;
    if (fresh.state === null) {
      return 'No goal set. Use /goal <objective> first.';
    }
    let next: GoalState;
    try {
      next = blockGoal(fresh.state, reason, clock);
    } catch {
      return (
        'Only an active goal can be blocked. Current status: ' +
        fresh.state.status +
        '.'
      );
    }
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal marked blocked: ' + reason;
  } finally {
    await claim.release();
  }
}

/**
 * Record one evidence criterion for the active goal.
 * Why this function is exported: the slash lane calls it directly so both
 * lanes share one write path with identical validation — parity by construction.
 * Sole evidence writer: no other code path appends criteria.
 * Why shape-only here: file existence plus passing tests are verified at
 * complete time by the verifier, so a criterion citing work-in-progress
 * files is storable but cannot complete until the proof is real.
 * Order: active-goal check, then lease, then load-or-seed, then dup check,
 * then shape check, then append plus save. Every rejection writes nothing.
 * @param projectDir project root containing the .opencode dir
 * @param clock injected clock
 * @param input raw tool input with id, claim, files, tests
 * @param sessionID lane id for the lease owner
 * @param storageSessionId optional real session for storage scope (slash lane
 * passes its invocation sessionID here; defaults to sessionID)
 */
export async function recordEvidence(
  projectDir: string,
  clock: Clock,
  input: unknown,
  sessionID: string,
  storageSessionId?: string | null,
): Promise<string> {
  const raw = input as {
    id?: unknown;
    claim?: unknown;
    files?: unknown;
    tests?: unknown;
  } | null;
  const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
  const claim = typeof raw?.claim === 'string' ? raw.claim.trim() : '';
  // Strict arrays with trimmed storage: any bad entry rejects the whole call
  // instead of silently dropping, so caller bugs cannot hide as success and
  // stored files match the slash lane exactly (verifier checks exact paths).
  const filesInput = Array.isArray(raw?.files) ? raw.files : null;
  let files: string[] | null = null;
  if (filesInput !== null) {
    const out: string[] = [];
    let bad = false;
    for (const f of filesInput) {
      if (typeof f !== 'string' || f.trim().length === 0) {
        bad = true;
        break;
      }
      out.push(f.trim());
    }
    files = bad ? [] : out;
  }
  const testsInput = Array.isArray(raw?.tests) ? raw.tests : null;
  let tests: EvidenceTestProof[] | null = null;
  if (testsInput !== null) {
    const out: EvidenceTestProof[] = [];
    let bad = false;
    for (const t of testsInput) {
      if (
        typeof t !== 'object' ||
        t === null ||
        typeof (t as { command?: unknown }).command !== 'string' ||
        ((t as { command?: unknown }).command as string).trim().length === 0 ||
        !Number.isInteger((t as { exitCode?: unknown }).exitCode)
      ) {
        bad = true;
        break;
      }
      // Carry the optional env through: dropping it here would make the schema
      // accept a field the stored sidecar silently loses, and the proof would
      // then run without the toolchain it asked for.
      const rawEnv = (t as { env?: unknown }).env;
      let env: Record<string, string> | undefined;
      if (rawEnv !== undefined) {
        if (
          rawEnv === null ||
          typeof rawEnv !== 'object' ||
          Array.isArray(rawEnv)
        ) {
          bad = true;
          break;
        }
        const entries = Object.entries(rawEnv as Record<string, unknown>);
        if (entries.some(([, v]) => typeof v !== 'string')) {
          bad = true;
          break;
        }
        env = Object.fromEntries(entries) as Record<string, string>;
      }
      out.push({
        command: ((t as { command: string }).command as string).trim(),
        exitCode: (t as { exitCode: number }).exitCode as number,
        ...(env === undefined ? {} : { env }),
      });
    }
    tests = bad ? [] : out;
  }
  // Shape check first: malformed input never touches state or lease.
  // files plus tests need at least one entry each: the stored sidecar must
  // always pass validateEvidenceShape, which rejects empty arrays.
  // File existence plus passing tests stay verifier-side at complete time.
  if (
    id.length === 0 ||
    id.length > 200 ||
    claim.length === 0 ||
    claim.length > 2000 ||
    files === null ||
    files.length === 0 ||
    tests === null ||
    tests.length === 0
  ) {
    return 'Invalid /goal evidence usage. Provide id=<id> claim=<claim> files=<a,b> tests=<cmd:exitCode>.';
  }
  const storage =
    typeof storageSessionId === 'string' && storageSessionId.trim() !== ''
      ? storageSessionFor(storageSessionId)
      : storageSessionFor(sessionID);
  const statePath = resolveStatePath(projectDir, storage);
  const legacyPath = resolveLegacyStatePath(projectDir);
  const loaded = await loadForTool(statePath, legacyPath);
  if ('error' in loaded) return loaded.error;
  if (loaded.state === null) {
    return 'No goal set. Use /goal <objective> first.';
  }
  if (loaded.state.status !== 'active') {
    return (
      'Only an active goal can record evidence. Current status: ' +
      loaded.state.status +
      '.'
    );
  }
  const owner = toolOwner(sessionID);
  const claimRes = await claimForTool(
    statePath,
    legacyPath,
    loaded.state,
    owner,
    clock,
  );
  if (!claimRes.claimed) return BUSY_MESSAGE;
  try {
    // Reload inside the guard: evidence may only be recorded for a goal that is
    // still active now, not for the one seen before the claim.
    const fresh = await loadForTool(statePath, legacyPath);
    if ('error' in fresh) return fresh.error;
    if (fresh.state === null) {
      return 'No goal set. Use /goal <objective> first.';
    }
    if (fresh.state.status !== 'active') {
      return (
        'Only an active goal can record evidence. Current status: ' +
        fresh.state.status +
        '.'
      );
    }
    // Null sidecar (e.g. tool-lane set never seeded one) starts empty.
    // Scoped evidence: slash plus tool lanes never share citations.
    const current =
      (await loadEvidence(projectDir, storage)) ?? emptyEvidence(0);
    if (current.criteria.some((c) => c.id === id)) {
      return 'Evidence id already recorded: ' + id + '.';
    }
    const candidate = {
      version: current.version,
      updatedAtMs: clock.nowMs(),
      criteria: [
        ...current.criteria,
        {
          id,
          claim,
          files,
          tests: tests.map((t) => ({
            command: t.command.trim(),
            exitCode: t.exitCode,
            ...(t.env === undefined ? {} : { env: t.env }),
          })),
        },
      ],
    };
    // Full-file shape check reuses the verifier's own gate shape.
    const shape = validateEvidenceShape(candidate);
    if (!shape.ok) {
      return 'Invalid evidence shape: ' + shape.reason + '.';
    }
    try {
      await saveEvidence(projectDir, candidate, storage);
    } catch (err) {
      return 'Failed to save evidence: ' + (err as Error).message;
    }
    return 'Criterion recorded for ' + id + '.';
  } finally {
    await claimRes.release();
  }
}

/**
 * Mark the active goal complete through the evidence gate.
 * Why gate order matches the slash lane: status errors surface before proof
 * checks, so blocked or finished goals report status instead of demanding
 * evidence.
 */
async function toolComplete(
  projectDir: string,
  clock: Clock,
  sessionID: string,
): Promise<string> {
  const storage = storageSessionFor(sessionID);
  const statePath = resolveStatePath(projectDir, storage);
  const legacyPath = resolveLegacyStatePath(projectDir);
  const loaded = await loadForTool(statePath, legacyPath);
  if ('error' in loaded) return loaded.error;
  if (loaded.state === null) {
    return 'No goal set. Use /goal <objective> first.';
  }
  const owner = toolOwner(sessionID);
  // Longer lease: completion now observes real test commands, so the guard
  // must outlive the verification pass instead of expiring mid-run.
  const claim = await claimForTool(
    statePath,
    legacyPath,
    loaded.state,
    owner,
    clock,
    PROOF_TOTAL_TIMEOUT_MS + 60000,
  );
  if (!claim.claimed) return BUSY_MESSAGE;
  try {
    try {
      const ev = await loadEvidence(projectDir, storage);
      const check = await tryCompleteWithEvidence({
        projectDir,
        evidence: ev,
        clock,
      });
      if (!check.ok) {
        return describeVerificationFailure(check.reason, check.failures);
      }
    } catch {
      // Same builder as the blocked path, so a verifier throw reads like any
      // other refusal instead of its own special-case phrasing.
      return describeVerificationFailure('verifier-error', []);
    }
    // Reload AFTER proof, immediately before the save: the only snapshot that
    // is safe to write after a pass that can run for minutes. Same guard and
    // message as the slash lane, so both surfaces recover identically.
    const fresh = await loadForTool(statePath, legacyPath);
    if ('error' in fresh) return fresh.error;
    if (fresh.state === null) {
      return 'No goal set. Use /goal <objective> first.';
    }
    // Whole-generation identity, not just the objective: any transition during
    // the pass invalidates this completion and must not be overwritten.
    if (goalIdentity(fresh.state) !== goalIdentity(loaded.state)) {
      return STATE_CHANGED_MESSAGE;
    }
    let next: GoalState;
    try {
      next = completeGoal(fresh.state, clock);
    } catch {
      return (
        'Only an active goal can complete. Current status: ' +
        fresh.state.status +
        '.'
      );
    }
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal marked complete.';
  } finally {
    await claim.release();
  }
}

/**
 * Resume a parked goal back to active.
 */
async function toolResume(
  projectDir: string,
  clock: Clock,
  sessionID: string,
): Promise<string> {
  const storage = storageSessionFor(sessionID);
  const statePath = resolveStatePath(projectDir, storage);
  const legacyPath = resolveLegacyStatePath(projectDir);
  const loaded = await loadForTool(statePath, legacyPath);
  if ('error' in loaded) return loaded.error;
  if (loaded.state === null) {
    return 'No goal set. Use /goal <objective> first.';
  }
  const owner = toolOwner(sessionID);
  const claim = await claimForTool(
    statePath,
    legacyPath,
    loaded.state,
    owner,
    clock,
  );
  if (!claim.claimed) return BUSY_MESSAGE;
  try {
    // Reload inside the guard: resuming the snapshot read before the claim
    // would resurrect state that a concurrent transition already changed.
    const fresh = await loadForTool(statePath, legacyPath);
    if ('error' in fresh) return fresh.error;
    if (fresh.state === null) {
      return 'No goal set. Use /goal <objective> first.';
    }
    let resumed: GoalState;
    try {
      resumed = resumeGoal(fresh.state, clock);
    } catch {
      return (
        'Only a parked goal can resume. Current status: ' +
        fresh.state.status +
        '.'
      );
    }
    try {
      await saveGoalState(statePath, resumed);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal resumed: ' + resumed.objective;
  } finally {
    await claim.release();
  }
}

/**
 * The five agent-callable goal tool definitions.
 * Why five separate tools: clearer prompts and least privilege beat one
 * multi-action tool. Schemas live in goal.ts beside GoalInputSchema.
 */
function goalToolDefs(projectDir: string, clock: Clock): GoalToolDef[] {
  return [
    {
      name: 'goal_set',
      description:
        'Set the session goal and start working toward it. Replaces any active goal.',
      input: GoalInputSchema,
      execute: async (input: unknown, context: unknown) => {
        try {
          const title = (input as { title?: unknown } | null)?.title;
          return {
            content: await toolSet(
              projectDir,
              clock,
              title,
              toolSessionId(context),
            ),
          };
        } catch {
          // Generic text only here: every expected failure above already
          // returned its specific preserved message.
          return { content: 'Goal tool failed without changing state.' };
        }
      },
    },
    {
      name: 'goal_block',
      description:
        'Mark the active goal blocked with a reason. Use when stuck and unable to proceed.',
      input: BlockInputSchema,
      execute: async (input: unknown, context: unknown) => {
        try {
          const reason = (input as { reason?: unknown } | null)?.reason;
          return {
            content: await toolBlock(
              projectDir,
              clock,
              reason,
              toolSessionId(context),
            ),
          };
        } catch {
          return { content: 'Goal tool failed without changing state.' };
        }
      },
    },
    {
      name: 'goal_complete',
      description:
        'Mark the active goal complete. Requires evidence with file citations plus passing tests, otherwise it stays blocked.',
      input: CompleteInputSchema,
      execute: async (_input: unknown, context: unknown) => {
        try {
          return {
            content: await toolComplete(
              projectDir,
              clock,
              toolSessionId(context),
            ),
          };
        } catch {
          return { content: 'Goal tool failed without changing state.' };
        }
      },
    },
    {
      name: 'goal_resume',
      description:
        'Resume a parked goal (interrupted or blocked) back to active after an explicit request.',
      input: ResumeInputSchema,
      execute: async (_input: unknown, context: unknown) => {
        try {
          return {
            content: await toolResume(
              projectDir,
              clock,
              toolSessionId(context),
            ),
          };
        } catch {
          return { content: 'Goal tool failed without changing state.' };
        }
      },
    },
    {
      name: 'goal_evidence',
      description:
        'Record one evidence criterion for the active goal. Sole evidence writer. Slash parity /goal evidence.',
      input: EvidenceInputSchema,
      execute: async (input: unknown, context: unknown) => {
        try {
          return {
            content: await recordEvidence(
              projectDir,
              clock,
              input,
              toolSessionId(context),
            ),
          };
        } catch {
          return { content: 'Goal tool failed without changing state.' };
        }
      },
    },
  ];
}

/**
 * Register the four goal tools on the host tool catalog.
 * Why this function exists: setup() calls it beside the slash registration so
 * both lanes are armed in one place. Registration is best-effort and
 * fail-closed: a host without the tool domain keeps the slash lane working.
 * @param ctx unknown V2 plugin context from setup
 * @param projectDir project root containing the .opencode dir
 * @param clock injected clock
 */
export async function registerGoalTools(
  ctx: unknown,
  projectDir: string,
  clock: Clock,
): Promise<{ registered: boolean; reason: string }> {
  try {
    // Opts guards first: bad input gets a reason string, never a TypeError.
    if (typeof projectDir !== 'string' || projectDir.trim().length === 0) {
      return { registered: false, reason: 'invalid-opts' };
    }
    if (
      clock === null ||
      typeof clock !== 'object' ||
      typeof (clock as Clock).nowMs !== 'function'
    ) {
      return { registered: false, reason: 'invalid-opts' };
    }
    // Probe first so unknown hosts get a reason string, never an exception.
    // Shape mirrors the slash command.transform probe in setup.
    const tool = (ctx as { tool?: { transform?: unknown } }).tool;
    if (
      tool === null ||
      typeof tool !== 'object' ||
      typeof (tool as { transform?: unknown }).transform !== 'function'
    ) {
      return { registered: false, reason: 'tool-hook-unavailable' };
    }
    const defs = goalToolDefs(projectDir, clock);
    await (
      tool as {
        transform: (fn: (editor: GoalToolEditor) => void) => Promise<unknown>;
      }
    ).transform((editor) => {
      for (const def of defs) {
        editor.add(def);
      }
    });
    return { registered: true, reason: 'ok' };
  } catch {
    return { registered: false, reason: 'register-failed' };
  }
}
