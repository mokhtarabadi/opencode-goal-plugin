/**
 * Agent-callable goal tools.
 * Why this module exists: the model needs to drive the goal itself mid-session
 * (set, block, complete, resume) without waiting for the user to type a slash
 * command. This mirrors the smart-compact `compact_context` tool pattern:
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
  loadGoalState,
  releaseLease,
  resolveStatePath,
  saveGoalState,
  tryClaimLease,
} from './state.js';
import {
  BlockInputSchema,
  CompleteInputSchema,
  GoalInputSchema,
  ResumeInputSchema,
  blockGoal,
  completeGoal,
  isSafeGoalTitle,
  resumeGoal,
  setObjective,
} from './goal.js';
import { loadEvidence } from './evidence.js';
import { tryCompleteWithEvidence } from './verifier.js';

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

/** Message when another turn holds the lease; no mutation happened. */
const BUSY_MESSAGE = 'Goal is busy with another turn. Retry shortly.';

/**
 * Claim the file lease for a tool mutation.
 * Why lease first: two parallel tool calls (or a tool plus the idle loop)
 * must serialize their read-modify-write. null state needs no lease — there
 * is no file to race on, matching first-set semantics.
 * @returns claimed owner id, or null when no claim was needed or possible
 */
async function claimForTool(
  statePath: string,
  current: GoalState | null,
  owner: string,
  clock: Clock,
): Promise<{ claimed: boolean }> {
  if (current === null) return { claimed: true };
  try {
    const res = await tryClaimLease(statePath, owner, LEASE_TTL_MS, clock);
    return { claimed: res.claimed };
  } catch {
    // Lock I/O failure fails closed: never mutate without the lease.
    return { claimed: false };
  }
}

/**
 * Release a tool-held lease, best-effort.
 * Why best-effort: transition helpers already clear the lease on save, so
 * this is normally a no-op; it only matters when a save threw mid-mutation.
 */
async function releaseToolLease(
  statePath: string,
  owner: string,
  clock: Clock,
): Promise<void> {
  try {
    await releaseLease(statePath, owner, clock);
  } catch {
    // Release failure is safe: the TTL reclaims a stale lease.
  }
}

/**
 * Load current state, mapping corruption to the shared message.
 */
async function loadForTool(
  statePath: string,
): Promise<{ state: GoalState | null } | { error: string }> {
  try {
    return { state: await loadGoalState(statePath) };
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
  const statePath = resolveStatePath(projectDir);
  const loaded = await loadForTool(statePath);
  if ('error' in loaded) return loaded.error;
  const owner = 'tool:' + sessionID;
  const claim = await claimForTool(statePath, loaded.state, owner, clock);
  if (!claim.claimed) return BUSY_MESSAGE;
  try {
    const next = setObjective(loaded.state, title, clock, TOOL_HOST_VERSION);
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal set to active: ' + next.objective;
  } finally {
    await releaseToolLease(statePath, owner, clock);
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
  const statePath = resolveStatePath(projectDir);
  const loaded = await loadForTool(statePath);
  if ('error' in loaded) return loaded.error;
  if (loaded.state === null) {
    return 'No goal set. Use /goal <objective> first.';
  }
  const owner = 'tool:' + sessionID;
  const claim = await claimForTool(statePath, loaded.state, owner, clock);
  if (!claim.claimed) return BUSY_MESSAGE;
  try {
    let next: GoalState;
    try {
      next = blockGoal(loaded.state, reason, clock);
    } catch {
      return (
        'Only an active goal can be blocked. Current status: ' +
        loaded.state.status +
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
    await releaseToolLease(statePath, owner, clock);
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
  const statePath = resolveStatePath(projectDir);
  const loaded = await loadForTool(statePath);
  if ('error' in loaded) return loaded.error;
  if (loaded.state === null) {
    return 'No goal set. Use /goal <objective> first.';
  }
  const owner = 'tool:' + sessionID;
  const claim = await claimForTool(statePath, loaded.state, owner, clock);
  if (!claim.claimed) return BUSY_MESSAGE;
  try {
    let next: GoalState;
    try {
      next = completeGoal(loaded.state, clock);
    } catch {
      return (
        'Only an active goal can complete. Current status: ' +
        loaded.state.status +
        '.'
      );
    }
    try {
      const ev = await loadEvidence(projectDir);
      const check = await tryCompleteWithEvidence({
        projectDir,
        evidence: ev,
      });
      if (!check.ok) {
        return (
          'Complete blocked: ' +
          check.reason +
          '. Add file citations plus passing tests to evidence.'
        );
      }
    } catch {
      return 'Complete blocked: verifier-error. Add evidence and retry.';
    }
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return 'Failed to save goal state: ' + (err as Error).message;
    }
    return 'Goal marked complete.';
  } finally {
    await releaseToolLease(statePath, owner, clock);
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
  const statePath = resolveStatePath(projectDir);
  const loaded = await loadForTool(statePath);
  if ('error' in loaded) return loaded.error;
  if (loaded.state === null) {
    return 'No goal set. Use /goal <objective> first.';
  }
  const owner = 'tool:' + sessionID;
  const claim = await claimForTool(statePath, loaded.state, owner, clock);
  if (!claim.claimed) return BUSY_MESSAGE;
  try {
    let resumed: GoalState;
    try {
      resumed = resumeGoal(loaded.state, clock);
    } catch {
      return (
        'Only a parked goal can resume. Current status: ' +
        loaded.state.status +
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
    await releaseToolLease(statePath, owner, clock);
  }
}

/**
 * The four agent-callable goal tool definitions.
 * Why four separate tools: clearer prompts and least privilege beat one
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
