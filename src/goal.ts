// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
/**
 * Slash goal parsing and status transitions Phase 1.
 * Why this module exists: isolates user input handling from storage and host wiring.
 * All time comes from injected Clock, never from Date.now directly.
 */
import type { Clock, GoalState } from './state.js';
import { initialState } from './state.js';

/** Parsed slash goal command. */
export type ParsedGoal =
  | { kind: 'set'; objective: string }
  | { kind: 'status' }
  | { kind: 'clear' }
  | { kind: 'block'; reason: string }
  | { kind: 'complete' }
  | { kind: 'resume' }
  | {
      kind: 'evidence';
      id: string;
      claim: string;
      files: string[];
      tests: { command: string; exitCode: number }[];
    }
  | { kind: 'invalid'; raw: string };

export const MAX_OBJECTIVE_LEN = 2000;

/**
 * Parse raw slash input like /goal <text> or /goal status.
 * Boundary rule: /goal must stand alone (end or whitespace after), so
 * /goalie or /goals never parse as commands. Keywords match exactly or
 * not at all: extra words after status, clear, complete, or bare block
 * are invalid instead of silently becoming objectives.
 * @param rawInput full user input including /goal prefix
 */
export function parseGoalCommand(rawInput: string): ParsedGoal {
  // Non-string input from a misbehaving host is invalid, never a throw.
  if (typeof rawInput !== 'string') {
    return { kind: 'invalid', raw: String(rawInput) };
  }
  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();
  const prefix = '/goal';
  if (lower === prefix) {
    // Bare /goal with no body carries no instruction.
    return { kind: 'invalid', raw: rawInput };
  }
  if (!lower.startsWith(prefix)) {
    return { kind: 'invalid', raw: rawInput };
  }
  const after = trimmed.slice(prefix.length);
  if (after.length === 0) {
    return { kind: 'invalid', raw: rawInput };
  }
  if (!/^\s/.test(after)) {
    // /goalie, /goals, /goalx: prefix glued to other text is not our command.
    return { kind: 'invalid', raw: rawInput };
  }
  const body = after.trim();
  if (body.length === 0) {
    return { kind: 'invalid', raw: rawInput };
  }
  const bodyLower = body.toLowerCase();
  if (bodyLower === 'status') return { kind: 'status' };
  if (
    bodyLower.startsWith('status ') ||
    bodyLower.startsWith('status\t') ||
    bodyLower.startsWith('status\n')
  ) {
    // status takes no arguments; extra words are likely a mistyped objective.
    return { kind: 'invalid', raw: rawInput };
  }
  if (bodyLower === 'clear') return { kind: 'clear' };
  if (
    bodyLower.startsWith('clear ') ||
    bodyLower.startsWith('clear\t') ||
    bodyLower.startsWith('clear\n')
  ) {
    return { kind: 'invalid', raw: rawInput };
  }
  if (bodyLower === 'complete') return { kind: 'complete' };
  if (
    bodyLower.startsWith('complete ') ||
    bodyLower.startsWith('complete\t') ||
    bodyLower.startsWith('complete\n')
  ) {
    return { kind: 'invalid', raw: rawInput };
  }
  if (bodyLower === 'resume') return { kind: 'resume' };
  if (
    bodyLower.startsWith('resume ') ||
    bodyLower.startsWith('resume\t') ||
    bodyLower.startsWith('resume\n')
  ) {
    return { kind: 'invalid', raw: rawInput };
  }
  if (bodyLower === 'block') {
    // Bare block names no reason, so the blocked state would be unactionable.
    return { kind: 'invalid', raw: rawInput };
  }
  if (
    bodyLower.startsWith('block ') ||
    bodyLower.startsWith('block\t') ||
    bodyLower.startsWith('block\n')
  ) {
    const reason = body.slice(6).trim();
    if (reason.length === 0) return { kind: 'invalid', raw: rawInput };
    // Overlong reasons are rejected like overlong objectives.
    if (reason.length > MAX_OBJECTIVE_LEN)
      return { kind: 'invalid', raw: rawInput };
    return { kind: 'block', reason };
  }
  if (
    bodyLower.startsWith('evidence ') ||
    bodyLower.startsWith('evidence\t') ||
    bodyLower.startsWith('evidence\n')
  ) {
    // Block-style args: id plus claim required, files plus tests optional.
    // Claim may contain spaces, so args split on known key boundaries.
    return parseGoalEvidence(body.slice('evidence'.length).trim(), rawInput);
  }
  if (bodyLower === 'evidence') {
    // Bare evidence names no criterion, so the write would be unactionable.
    return { kind: 'invalid', raw: rawInput };
  }
  if (body.length > MAX_OBJECTIVE_LEN) {
    return { kind: 'invalid', raw: rawInput };
  }
  return { kind: 'set', objective: body };
}

/**
 * JSON Schema for goal input used by V2 tool plus slash command.
 * Why this schema exists: V2 strict providers reject malformed tool
 * payloads. Declarative schema keeps validation testable without host.
 * Title is required, max 2000 to match parser, no additional props.
 */
export const GoalInputSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 2000 },
  },
  required: ['title'],
  additionalProperties: false,
} as const;

/**
 * JSON Schema for the block tool input.
 * Why this schema exists: reason is required, max 2000 to match the parser,
 * closed against extra props so strict providers accept it.
 */
export const BlockInputSchema = {
  type: 'object',
  properties: {
    reason: { type: 'string', minLength: 1, maxLength: 2000 },
  },
  required: ['reason'],
  additionalProperties: false,
} as const;

/**
 * JSON Schema for the complete and resume tool inputs.
 * Why this schema exists: neither takes arguments — complete reads the
 * evidence sidecar, resume acts on the parked state. Closed and empty.
 */
export const CompleteInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

/**
 * JSON Schema for the resume tool input.
 * Why an independent literal: it must never alias CompleteInputSchema by
 * reference, so a future edit to one shape cannot silently mutate the other.
 * Same empty closed shape today, separate object identity always.
 */
export const ResumeInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

/**
 * JSON Schema for the evidence tool input.
 * Why this schema exists: goal_evidence is the sole writer of the evidence
 * sidecar, so its shape must match EvidenceCriterion exactly. id, claim,
 * files, plus tests are all required with at least one entry each, because
 * loadEvidence drops sidecars that fail validateEvidenceShape and that
 * shape rejects empty files plus tests. Existence plus passing checks still
 * stay in the verifier at complete time — the writer checks shape only.
 */
export const EvidenceInputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    claim: { type: 'string', minLength: 1, maxLength: 2000 },
    files: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    tests: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          command: { type: 'string', minLength: 1 },
          exitCode: { type: 'integer' },
          // Optional toolchain pin for this command only. Without this field in
          // the tool schema the host rejects it (additionalProperties is false),
          // which would make the runner's env support unreachable from a tool.
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['command', 'exitCode'],
        additionalProperties: false,
      },
    },
  },
  required: ['id', 'claim', 'files', 'tests'],
  additionalProperties: false,
} as const;

/** One evidence test proof as parsed from slash args. */
export interface ParsedEvidenceTest {
  /** Test command, non-empty. */
  command: string;
  /** Process exit code, integer. */
  exitCode: number;
}

/**
 * Extract one key=value arg from a block-style arg string.
 * Why boundary matching: claim values may contain spaces, so args split on
 * known key starts (id, claim, files, tests) rather than on whitespace.
 * Returns the trimmed value or null when the key is absent.
 * @param args raw arg string after the evidence keyword
 * @param key one of id, claim, files, tests
 */
function extractArg(args: string, key: string): string | null {
  // Key must start the string or follow whitespace, so a claim mentioning
  // "files=" mid-sentence cannot hijack the parse.
  const open = new RegExp('(?:^|\\s)' + key + '=').exec(args);
  if (!open) return null;
  const rest = args.slice(open.index + open[0].length);
  const next = /(?:\s)(?:id|claim|files|tests)=/.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/**
 * Parse block-style evidence args into a ParsedGoal evidence kind.
 * Format: id=<short-id> claim=<one-line claim> files=<a,b> tests=<cmd:code;...>.
 * files splits on comma, tests splits on semicolon with command and exit code
 * split on the LAST colon so commands containing colons survive.
 * Shape-only: non-empty id plus claim plus at least one file plus at least
 * one test. Existence plus passing checks stay in the verifier at complete
 * time. files plus tests are mandatory (not defaulted) because the stored
 * sidecar must always pass validateEvidenceShape, which rejects empties.
 * @param args raw arg string after the evidence keyword
 * @param rawInput original input for the invalid fallback
 */
export function parseGoalEvidence(args: string, rawInput: string): ParsedGoal {
  const id = extractArg(args, 'id');
  const claim = extractArg(args, 'claim');
  // id plus claim are required and length-capped like title plus reason.
  if (!id || !claim) return { kind: 'invalid', raw: rawInput };
  if (id.length > 200 || claim.length > MAX_OBJECTIVE_LEN) {
    return { kind: 'invalid', raw: rawInput };
  }
  const filesRaw = extractArg(args, 'files');
  // files plus tests are mandatory: the stored sidecar must always pass
  // validateEvidenceShape, which rejects empty arrays.
  if (filesRaw === null || filesRaw === '') {
    return { kind: 'invalid', raw: rawInput };
  }
  const files = filesRaw
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  if (files.length === 0) {
    return { kind: 'invalid', raw: rawInput };
  }
  const testsRaw = extractArg(args, 'tests');
  if (testsRaw === null || testsRaw === '') {
    return { kind: 'invalid', raw: rawInput };
  }
  const tests: ParsedEvidenceTest[] = [];
  for (const part of testsRaw.split(';')) {
    const item = part.trim();
    if (item.length === 0) return { kind: 'invalid', raw: rawInput };
    const colon = item.lastIndexOf(':');
    if (colon <= 0) return { kind: 'invalid', raw: rawInput };
    const command = item.slice(0, colon).trim();
    // Empty code must reject: Number('') coerces to 0, which would forge
    // a passing proof out of a trailing colon with no exit code.
    const codeRaw = item.slice(colon + 1).trim();
    if (codeRaw.length === 0) return { kind: 'invalid', raw: rawInput };
    const code = Number(codeRaw);
    if (command.length === 0 || !Number.isInteger(code)) {
      return { kind: 'invalid', raw: rawInput };
    }
    tests.push({ command, exitCode: code });
  }
  if (tests.length === 0) return { kind: 'invalid', raw: rawInput };
  return { kind: 'evidence', id, claim, files, tests };
}

/**
 * Validate a goal title against traversal plus absolute-path abuse.
 * Why this guard exists: evidence citations must stay inside the project.
 * Objectives that are bare paths could trick later file resolution.
 * Normal prose with slashes still passes, only path escapes fail.
 * @param title trimmed objective text
 */
export function isSafeGoalTitle(title: string): boolean {
  // Non-string or empty never passes: parser already rejects bare input.
  if (typeof title !== 'string') return false;
  const t = title.trim();
  if (t.length === 0) return false;
  if (t.length > MAX_OBJECTIVE_LEN) return false;
  // Reject dot-dot traversal segments and absolute paths only.
  // Names merely starting with dots (e.g. .opencode) stay allowed.
  if (t === '..') return false;
  if (t.startsWith('../') || t.includes('/../') || t.endsWith('/..'))
    return false;
  if (t.startsWith('..\\') || t.includes('\\..\\')) return false;
  if (t.startsWith('/')) return false;
  // Reject Windows drive escapes like C:\escape or C:/escape.
  // Plain prose with colon plus space (e.g. note: fix) stays allowed.
  if (/^[A-Za-z]:[\\/]/.test(t)) return false;
  // Reject drive-relative escapes like C:escape without slash.
  if (/^[A-Za-z]:[^/\\]/.test(t)) return false;
  return true;
}

/**
 * Set a new objective, resetting counters and clearing lease.
 * @param prev previous state or null for first run
 * @param objective new objective text
 * @param clock injected clock
 * @param hostVersion host version for audit
 */
export function setObjective(
  prev: GoalState | null,
  objective: string,
  clock: Clock,
  hostVersion: string,
): GoalState {
  // Fresh state keeps history simple for Phase 1, counters restart per objective.
  const fresh = initialState(objective, clock, hostVersion);
  if (prev !== null) {
    // Preserve creation time of first goal in this chain for wall-time budgets later.
    return { ...fresh, createdAtMs: prev.createdAtMs };
  }
  return fresh;
}

/**
 * Mark active goal as blocked with reason in lastSummary.
 * @param current current state must be active
 * @param reason block reason
 * @param clock injected clock
 */
export function blockGoal(
  current: GoalState,
  reason: string,
  clock: Clock,
): GoalState {
  if (current.status !== 'active') {
    throw new Error('only active goal can be blocked');
  }
  return {
    ...current,
    status: 'blocked',
    lastSummary: reason,
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs(),
  };
}

/**
 * Mark active goal as complete.
 * @param current current state must be active
 * @param clock injected clock
 */
export function completeGoal(current: GoalState, clock: Clock): GoalState {
  if (current.status !== 'active') {
    throw new Error('only active goal can complete');
  }
  return {
    ...current,
    status: 'complete',
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs(),
  };
}

/**
 * Mark any goal as cleared, requires explicit user action to resume via new set.
 * @param current current state
 * @param clock injected clock
 */
export function clearGoal(current: GoalState, clock: Clock): GoalState {
  return {
    ...current,
    status: 'cleared',
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs(),
  };
}

/**
 * Resume a parked goal back to active after an explicit user request.
 * Why this exists: a user abort parks the goal as interrupted, and the only
 * path back is an explicit /goal resume. Blocked goals can also be resumed.
 * Clears any stale retry so the watchdog does not fire against a fresh start.
 * @param current current state, must be interrupted or blocked
 * @param clock injected clock
 */
export function resumeGoal(current: GoalState, clock: Clock): GoalState {
  // Only a parked goal can resume; active and finished states are no-ops.
  if (current.status !== 'interrupted' && current.status !== 'blocked') {
    throw new Error('only a parked goal can resume');
  }
  return {
    ...current,
    status: 'active',
    pendingAttempt: null,
    recoveryEpoch: current.recoveryEpoch + 1,
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs(),
  };
}
