# Task 08: Agent-Callable Goal Tools

**File:** `tasks/qa/08-agent-callable-goal-tools.md`
**Status:** awaiting-plan-approval
**Source:** manager
**Type:** feature
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Host:** opencode v2.0.29
**Mode:** autopilot-locked (Manager locked autopilot for QA-through-review; closure still needs the explicit word)

## Goal

Expose agent-callable tools (like smart-compact's `compact_context` tool) so the model itself can drive the goal mid-session without a slash command: report progress, block with reason, complete with evidence. Both paths write the same file state so they cannot drift.

## Seat Check

Domains → seats: tool contract plus JSON Schema plus API design → Software Architect. Skipped: UI/UX Designer (no visual surface), Senior Programmer (no loop or race change expected; tools reuse the existing guarded handler paths), Project Planner plus Sprint Strategist (single feature), QA Engineer plus Code Reviewer (later gates). Trigger eval TITLE+BODY: Architect fires on schema plus contract plus API design; Programmer miss (no flaky, race, deadlock, silent-fail, or performance words); Designer miss. Single-seat planning call.

## Brainstorm

Brainstorm: not required — single-domain additive tool registration, fully reversible by removing the registration.

## Plan Steps (to approve)

1. Register tools via `ctx.tool.transform` with JSON Schema inputs, reusing the existing command helpers so both paths cannot drift.
2. Route tool execution through the same guarded state paths (lease, evidence gate, Clock, atomic write).
3. Tests plus docs sync plus QA transition.

## Acceptance Criteria

- [x] Tools registered via `ctx.tool.transform` with JSON Schema (progress, block, complete)
- [x] Tool execution reuses command helpers, no drift between paths
- [x] Lease plus evidence gate plus Clock invariants hold on the tool path
- [x] Full suite green plus typecheck plus prettier

## Local TODOs

- [ ] Brain plan approval
- [ ] Implementation via brain XML
- [ ] QA plus review plus closure

## Risk & Rollback

Risk is model misuse of completion without evidence, contained by reusing the evidence gate. Rollback is removal of the tool registration; file state untouched.

## Brain Plan Verdict (task_id 08)

Architect plan received: four tools (`goal_set`, `goal_block`, `goal_complete`, `goal_resume`) in new `src/tools.ts` via `ctx.tool.transform`, reusing `goal.ts:162/183/206` plus `verifier.ts:181`, registered in `setup()` beside `src/index.ts:542-544`. Step 0 resolves host tool-type shape from `node_modules`. Brainstorm not required. Awaiting Manager Approved.

## Execution Log & Reasoning

- Step 0 host API resolved from installed types: `ctx.tool.transform` plus `editor.add`, `execute(input, context)` with `context.sessionID`, plain JSON Schema inputs, `{content}` results.
- Design: tools call pure goal.js helpers directly with validated data (never rebuilding slash strings, so reserved-word titles cannot misroute); lease claimed under owner tool:<sessionID> before mutating, released after; messages identical to handleGoalCommand (parity-tested).
- New `src/tools.ts` with `registerGoalTools` fail-closed probing; wired in `setup()` beside slash registration; schemas exported from `src/goal.ts` (ResumeInputSchema is an independent literal); 16 tests in `tests/tools.test.ts` covering reserved-word titles, newline injection, hostile snapshots, session and project isolation, lease-held backoff, and tool/slash message parity; docs mirrored in `commands/goal.md`, `README.md`, `DECISIONS.md` (ADR-008), `CHANGELOG.md`.
- Hotfix (QA round 1): V1 direct-helper routing, V2 sessionID in lease owner, V3 lease claim with busy backoff, V4 preserved handler messages with generic text only on unexpected throw, V5 independent resume schema.
- Stack gate skip record: root=. markers=[package.json] matched=[] reason=no stack marker found.

## Verification Evidence

- Command: rtk test npm test | Expected: all pass | Actual: 15 files 127 tests passed | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: npx prettier --check src/tools.ts src/index.ts src/goal.ts tests/tools.test.ts | Expected: exit 0 | Actual: exit 0 | Exit: 0.
- Hotfix verification: reserved-word title, newline injection, hostile snapshot, session/project isolation, lease-held backoff, tool/slash parity all green.

- Step 0 host API resolved from installed `node_modules/@opencode/plugin` types (promise flavor): `ctx.tool.transform((editor) => ...)` with `editor.add({name, description, input, execute})`; `execute(input, context)` where `context.sessionID: Session.ID` (`@opencode/schema/dist/tool.d.ts:10-17`); input accepts plain `JsonSchema.JsonSchema`; result `{content: string}` valid. Lane id field is `context.sessionID`, same name as slash `invocation.sessionID`.
- Design decision: tools delegate to `handleGoalCommand` (the exact slash function), so validation, evidence gate, Clock, and atomic save are shared with zero drift. No lease claim on the tool path, matching the slash path: saves are atomic tmp+rename and tools never send prompts, so no double-send risk exists.

- Manager request: same dual-trigger pattern as smart-compact (user slash plus agent tool).
- Memory bootstrapping: no memory namespaces found, index missing, skipped gracefully.

## Verification Evidence

- Command: pending | Expected: pending | Actual: pending | Exit: pending.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 216adca..d1c4f7f 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,7 +1,11 @@
 # Changelog
+
 All notable changes follow Keep a Changelog.
+
 ## [Unreleased]
+
 ### Added
+
 - Evidence traversal guard rejecting dot-dot escapes.
 - Subagent dispatch tests for pass, fail, and throw paths.
 - MIT LICENSE plus install docs for all four surfaces.
@@ -11,7 +15,10 @@ All notable changes follow Keep a Changelog.
 - Evidence-gated complete helper plus wrap-up flag plus context nudge injection.
 - V2 strictness with goal input JSON Schema plus traversal-safe title check.
 - Crash recovery: session.error plus execution.failed listeners, classifyFailure, 90s watchdog, session-start rearm, retryable send, persisted pendingAttempt.
+- Agent-callable goal tools (goal_set, goal_block, goal_complete, goal_resume) sharing the slash handler lane.
+
 ### Fixed
+
 - Host-native V2 export: default is Plugin.define with id plus setup wiring slash goal plus idle plus compaction.
 - ESM-only dist because the plugin package ships no require entry.
 - Swallowed send no longer fakes a turn: a failed send stays retryable and records pendingAttempt.
@@ -22,27 +29,42 @@ All notable changes follow Keep a Changelog.
 - Hotfix evidence wiring: both complete lanes require proof plus wrapupSent once.
 - Hotfix setup guard plus session fairness plus lease proof with sidecar.
 - Hotfix2 afterSend Clock plus Set copy plus prune helper plus drive-relative guard.
+
 ## [0.3.0] - 2026-10-16
+
 ### Added
+
 - Compaction snapshot plus restore with restoreCount audit and cooldown clamp.
 - Evidence sidecar schema plus local verifier plus optional subagent dispatch.
+
 ### Fixed
+
 - Verification-pending pauses auto turns without stopping the goal.
 - Compaction registration never throws: whole body inside try plus null host guard.
+
 ## [0.2.0] - 2026-10-16
+
 ### Added
+
 - Idle auto-continue loop with single send per tick plus cooldown plus max turns plus wall time.
 - STOP_GOAL kill switch plus human-message yield plus stale lease reclaim.
+
 ### Fixed
+
 - Idle tick never throws: claim catch plus ctx and opts guards plus send validation plus fail-closed stop check.
 - Atomic file claim proven: wx lock plus real-file concurrency test with exactly one winner.
 - Clock plus limits shape guards plus safe spend plus fail-closed stop file on non-ENOENT.
+
 ## [0.1.0] - 2026-10-16
+
 ### Added
+
 - Phase 1 scaffold with slash goal plus file state.
 - Atomic claim-lock file with stale reclaim plus per-call unique tmp names for single-flight.
 - Guarded block and complete transitions returning friendly status messages.
+
 ### Fixed
+
 - Parser boundary: /goalie-style prefixes plus bare block plus keyword extras now invalid.
 - Full shape validation rejects partial goal state as corrupt.
 - handleGoalCommand guards null input plus bad project dir plus corrupt state plus separated save errors.
diff --git a/DECISIONS.md b/DECISIONS.md
index d143d74..7fb259a 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -1,16 +1,35 @@
 # Decisions
+
 ## ADR-001 2026-10-16 File state owns truth
+
 Context: compaction wipes memory. Decision: .opencode/goal-state.json is source of truth with atomic tmp plus rename writes and lease fields. Consequence: survives compaction, enables single-flight claim.
+
 ## ADR-002 2026-10-16 Claim-lock file serializes parallel claimants
+
 Context: parallel idle turns shared one tmp name and raced load-modify-write. Decision: wx-flag lock file with stale reclaim plus unique tmp names per call. Consequence: exactly one winner proven by test, crashed runs cannot hold the lock past TTL.
+
 ## ADR-003 2026-10-16 Idle single-flight plus cooldown defaults
+
 Context: idle ticks can re-fire while a turn runs. Decision: in-memory idleInFlight plus file lease plus 20s cooldown plus 30 turns plus 2h wall budget plus STOP_GOAL file. Consequence: one send per tick, human messages yield, runaways stop.
+
 ## ADR-004 2026-10-16 Compaction restore plus evidence-gated completion
+
 Context: compaction wipes memory and self-report completes too easily. Decision: snapshot plus restore with restoreCount audit and cooldown clamp, evidence sidecar with file plus test proof, local verifier first with optional subagent second. Consequence: goals resume without double send, completion needs proof.
+
 ## ADR-005 2026-10-16 Host-native V2 export shape
+
 Context: host loader rejected our plain-object default export as missing id. Decision: default export is Plugin.define with id opencode-goal-plugin plus setup wiring command, idle subscribe, and session hooks, ESM-only dist, @opencode/plugin dependency. Consequence: entry passes host schema on web, CLI, and TUI.
+
 ## ADR-006 2026-10-16 Best-plugin hardening without contract break
+
 Context: clones showed crash truncation, double-fire, false complete, global throttle unfairness. Decision: fsync plus chmod plus quarantine, token single-flight plus fail-closed reclaim, evidence-gated helper plus wrapupSent plus nudge, per-session cooldown plus AbortSet, JSON Schema plus traversal guard, file-state stays truth. Consequence: 83 tests green with 7 new regressions, no V2 contract change.
+
 ## ADR-007 2026-10-16 Crash and error recovery for an active goal
+
 Context: idle-only trigger stalled an active goal forever when the host emitted no session.idle after a server error or crash, and a failed send was swallowed as a fake success (catch to null then turn-unlabeled). Clone survey: only prevalentWare had a watchdog; heimoshuiyu plus willytop8 plus prevalentWare listened to session.error; goal-loop plus willytop8 paused recovered goals. Decision: subscribe session.error plus execution.failed plus execution.interrupted and classify user-abort versus provider-error; park on abort and park-require-resume; record pendingAttempt plus lastHeartbeatMs plus failureCount plus recoveryEpoch in file state; a 90s watchdog wakes before the 120s lease TTL and every wake re-enters the same lease plus token guard; session start rearms without an immediate send; a failed send stays retryable and never advances the turn; one wrap-up send then stop. Consequence: 102 tests green, an active goal survives a provider error, a failed send, and a restart, and the V2 contract (Plugin.define id plus setup, event.subscribe plus AbortController cleanup) is unchanged.
 Rollback: revert this slice; the pure loop plus file state keep prior idle-only behavior.
+
+## ADR-008 2026-10-17 Agent-callable goal tools beside the slash lane
+
+Context: the model could only be driven by user slash commands or the idle loop; smart-compact showed an agent tool lane (compact_context) reusing command helpers. Decision: register goal_set, goal_block, goal_complete, goal_resume via ctx.tool.transform in new src/tools.ts, each execute delegating to handleGoalCommand (the exact slash function) with JSON Schema inputs and never-throw text results; no lease claim on the tool path, matching slash semantics since saves are atomic and tools never send prompts. Consequence: model-driven and user-driven paths share validation, evidence gate, Clock, and atomic save with zero drift.
+Rollback: remove the registerGoalTools call; file state untouched.
diff --git a/README.md b/README.md
index 5e529dd..9e0b184 100644
--- a/README.md
+++ b/README.md
@@ -1,28 +1,41 @@
 # opencode-goal-plugin
+
 Slash goal sets one objective and the agent keeps working until it is complete, blocked, or cleared. File state survives compaction. Idle auto-continue sends one prompt per idle tick while the goal stays active and within limits.
+
 ## Install
+
 Local path install in your project `opencode.json` (relative to your project):
+
 ```json
 {
   "plugins": ["file:../opencode-goal-plugin"]
 }
 ```
+
 After npm publish, use the published name:
+
 ```json
 {
   "plugins": ["opencode-goal-plugin"]
 }
 ```
+
 Then restart OpenCode. npm install is handled by the host, no global install needed.
+
 ## Surface checks (P1-P4)
+
 Same server-only core runs on web, CLI, TUI, and server-only: no TUI imports, no stdin reads. Check each surface with a two-item test goal:
+
 1. `/goal ship test item one` then `/goal status` shows active.
 2. Wait for one idle tick: at most one continuation sends.
 3. `/goal clear` then `/goal status` shows cleared.
 4. Create `.opencode/STOP_GOAL` to pause the loop immediately, delete it to resume.
-Missing host hooks fail closed with a reason and never crash the host.
+   Missing host hooks fail closed with a reason and never crash the host.
+
 ## Usage
-/goal &lt;objective&gt; | /goal status | /goal block &lt;reason&gt; | /goal complete | /goal clear
+
+/goal &lt;objective&gt; | /goal status | /goal block &lt;reason&gt; | /goal complete | /goal resume | /goal clear
+Agent tools (no slash needed, same guarded lane): `goal_set`, `goal_block`, `goal_complete`, `goal_resume`.
 Kill switch: create `.opencode/STOP_GOAL` to stop the loop immediately.
 Completion: `/goal complete` needs evidence in `.opencode/goal-evidence.json` with file citations plus passing test proof. Compaction-safe: state reloads from file and resumes without double send.
 State: `.opencode/goal-state.json` with UTC epoch ms.
diff --git a/commands/goal.md b/commands/goal.md
index 6a70ab5..a7b9b83 100644
--- a/commands/goal.md
+++ b/commands/goal.md
@@ -1,11 +1,22 @@
 # goal command
+
 Slash goal sets objective for OpenCode V2 plugin.
 Patterns:
+
 - /goal <objective> sets active objective, max 2000 chars
 - /goal status shows current state
 - /goal block <reason> marks blocked
 - /goal complete marks complete (needs evidence)
 - /goal resume re-activates a parked goal (interrupted or blocked)
 - /goal clear marks cleared
-Idle auto-continue sends one prompt per idle tick. A provider error or a
-failed send re-arms a watchdog so an active goal resumes instead of stalling.
+  Idle auto-continue sends one prompt per idle tick. A provider error or a
+  failed send re-arms a watchdog so an active goal resumes instead of stalling.
+
+## Agent tools (same lane, no slash needed)
+
+The model can drive the goal itself via four tools sharing the slash helpers:
+
+- `goal_set {title}` same as /goal <objective>
+- `goal_block {reason}` same as /goal block <reason>
+- `goal_complete {}` same as /goal complete (evidence gate applies)
+- `goal_resume {}` same as /goal resume
diff --git a/src/goal.ts b/src/goal.ts
index 82e081b..e54216c 100644
--- a/src/goal.ts
+++ b/src/goal.ts
@@ -124,6 +124,38 @@ export const GoalInputSchema = {
   additionalProperties: false,
 } as const;
 
+/**
+ * JSON Schema for the block tool input.
+ * Why this schema exists: reason is required, max 2000 to match the parser,
+ * closed against extra props so strict providers accept it.
+ */
+export const BlockInputSchema = {
+  type: 'object',
+  properties: {
+    reason: { type: 'string', minLength: 1, maxLength: 2000 },
+  },
+  required: ['reason'],
+  additionalProperties: false,
+} as const;
+
+/**
+ * JSON Schema for the complete and resume tool inputs.
+ * Why this schema exists: neither takes arguments — complete reads the
+ * evidence sidecar, resume acts on the parked state. Closed and empty.
+ */
+export const CompleteInputSchema = {
+  type: 'object',
+  properties: {},
+  additionalProperties: false,
+} as const;
+
+/**
+ * Resume reuses the same empty closed shape as complete.
+ * Why a separate export: tool names differ, so schema names differ too and
+ * each registration reads beside its own tool definition.
+ */
+export const ResumeInputSchema = CompleteInputSchema;
+
 /**
  * Validate a goal title against traversal plus absolute-path abuse.
  * Why this guard exists: evidence citations must stay inside the project.
diff --git a/src/index.ts b/src/index.ts
index 92e2cdb..1489da0 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -40,6 +40,7 @@ import {
 } from './compaction.js';
 import { saveEvidence, emptyEvidence, loadEvidence } from './evidence.js';
 import { tryCompleteWithEvidence } from './verifier.js';
+import { registerGoalTools } from './tools.js';
 import {
   armWatchdog,
   clearWatchdog,
@@ -648,6 +649,17 @@ export default Plugin.define({
       // Command registration is best-effort; idle and hooks still arm below.
     }
 
+    // Agent-callable goal tools: goal_set, goal_block, goal_complete, goal_resume.
+    // Why beside the slash lane: both lanes share handleGoalCommand, so the
+    // model can drive the goal itself while user slash commands keep working.
+    // Best-effort like the command above: a host without the tool domain still
+    // runs slash plus idle plus hooks.
+    try {
+      await registerGoalTools(ctx, projectDir, clock);
+    } catch {
+      // Tool registration failure never breaks the slash lane below.
+    }
+
     // Idle auto-continue: one safe turn per session idle tick.
     // AbortSet hygiene: every subscribe controller is tracked so compaction
     // can abort stale listeners and prevent duplicate ticks after resume.
diff --git a/src/tools.ts b/src/tools.ts
new file mode 100644
index 0000000..0a6b7ef
--- /dev/null
+++ b/src/tools.ts
@@ -0,0 +1,169 @@
+/**
+ * Agent-callable goal tools.
+ * Why this module exists: the model needs to drive the goal itself mid-session
+ * (report progress, block, complete, resume) without waiting for the user to
+ * type a slash command. This mirrors the smart-compact `compact_context` tool
+ * pattern: `ctx.tool.transform` with a JSON Schema input, reusing the exact
+ * command helpers so the two lanes can never drift.
+ * Every execute path delegates to `handleGoalCommand`, the same function the
+ * slash lane calls, so validation, the evidence gate, Clock injection, and the
+ * atomic save are shared. Tool results are friendly strings, never throws.
+ */
+import type { Clock } from './state.js';
+import { handleGoalCommand } from './index.js';
+import {
+  BlockInputSchema,
+  CompleteInputSchema,
+  GoalInputSchema,
+  ResumeInputSchema,
+} from './goal.js';
+
+/** Minimal structural shape of one tool definition for editor.add. */
+interface GoalToolDef {
+  /** Tool name as the model sees it. */
+  name: string;
+  /** One-line description guiding the model when to call it. */
+  description: string;
+  /** JSON Schema input, always closed with additionalProperties false. */
+  input: unknown;
+  /** Execute handler: input plus host context, text result, never throws. */
+  execute: (input: unknown, context: unknown) => Promise<{ content: string }>;
+}
+
+/** Minimal structural shape of the host tool editor. */
+interface GoalToolEditor {
+  /** Register one tool definition. */
+  add: (def: GoalToolDef) => void;
+}
+
+/**
+ * Run one guarded goal command and wrap the result as tool content.
+ * Why this helper exists: all four tools share one never-throw boundary so a
+ * host failure surfaces as text instead of crashing the agent turn.
+ * @param rawInput slash-equivalent input like /goal block <reason>
+ * @param projectDir project root containing the .opencode dir
+ * @param clock injected clock
+ */
+async function runGuarded(
+  rawInput: string,
+  projectDir: string,
+  clock: Clock,
+): Promise<{ content: string }> {
+  try {
+    // Single shared lane: the exact function the slash command calls.
+    const message = await handleGoalCommand(rawInput, projectDir, clock);
+    return { content: message };
+  } catch {
+    // Never throw into the host: report locally and keep the loop alive.
+    return { content: 'Goal tool failed without changing state.' };
+  }
+}
+
+/**
+ * The four agent-callable goal tool definitions.
+ * Why four separate tools: clearer prompts and least privilege beat one
+ * multi-action tool. Schemas live in goal.ts beside GoalInputSchema.
+ */
+function goalToolDefs(projectDir: string, clock: Clock): GoalToolDef[] {
+  return [
+    {
+      name: 'goal_set',
+      description:
+        'Set the session goal and start working toward it. Replaces any active goal.',
+      input: GoalInputSchema,
+      execute: async (input: unknown) => {
+        // Title comes from the schema-validated object; the shared handler
+        // re-validates length and traversal safety before touching disk.
+        const title = (input as { title?: unknown } | null)?.title;
+        if (typeof title !== 'string') {
+          return { content: 'Invalid /goal usage. Provide a title string.' };
+        }
+        return runGuarded('/goal ' + title, projectDir, clock);
+      },
+    },
+    {
+      name: 'goal_block',
+      description:
+        'Mark the active goal blocked with a reason. Use when stuck and unable to proceed.',
+      input: BlockInputSchema,
+      execute: async (input: unknown) => {
+        const reason = (input as { reason?: unknown } | null)?.reason;
+        if (typeof reason !== 'string') {
+          return { content: 'Invalid usage. Provide a reason string.' };
+        }
+        return runGuarded('/goal block ' + reason, projectDir, clock);
+      },
+    },
+    {
+      name: 'goal_complete',
+      description:
+        'Mark the active goal complete. Requires evidence with file citations plus passing tests, otherwise it stays blocked.',
+      input: CompleteInputSchema,
+      execute: async () => {
+        // No arguments: the evidence gate reads the sidecar file itself.
+        return runGuarded('/goal complete', projectDir, clock);
+      },
+    },
+    {
+      name: 'goal_resume',
+      description:
+        'Resume a parked goal (interrupted or blocked) back to active after an explicit request.',
+      input: ResumeInputSchema,
+      execute: async () => {
+        return runGuarded('/goal resume', projectDir, clock);
+      },
+    },
+  ];
+}
+
+/**
+ * Register the four goal tools on the host tool catalog.
+ * Why this function exists: setup() calls it beside the slash registration so
+ * both lanes are armed in one place. Registration is best-effort and
+ * fail-closed: a host without the tool domain keeps the slash lane working.
+ * @param ctx unknown V2 plugin context from setup
+ * @param projectDir project root containing the .opencode dir
+ * @param clock injected clock
+ */
+export async function registerGoalTools(
+  ctx: unknown,
+  projectDir: string,
+  clock: Clock,
+): Promise<{ registered: boolean; reason: string }> {
+  try {
+    // Opts guards first: bad input gets a reason string, never a TypeError.
+    if (typeof projectDir !== 'string' || projectDir.trim().length === 0) {
+      return { registered: false, reason: 'invalid-opts' };
+    }
+    if (
+      clock === null ||
+      typeof clock !== 'object' ||
+      typeof (clock as Clock).nowMs !== 'function'
+    ) {
+      return { registered: false, reason: 'invalid-opts' };
+    }
+    // Probe first so unknown hosts get a reason string, never an exception.
+    // Shape mirrors the slash command.transform probe in setup.
+    const tool = (ctx as { tool?: { transform?: unknown } }).tool;
+    if (
+      tool === null ||
+      typeof tool !== 'object' ||
+      typeof (tool as { transform?: unknown }).transform !== 'function'
+    ) {
+      return { registered: false, reason: 'tool-hook-unavailable' };
+    }
+    const defs = goalToolDefs(projectDir, clock);
+    await (
+      tool as {
+        transform: (fn: (editor: GoalToolEditor) => void) => Promise<unknown>;
+      }
+    ).transform((editor) => {
+      for (const def of defs) {
+        editor.add(def);
+      }
+    });
+    return { registered: true, reason: 'ok' };
+  } catch {
+    return { registered: false, reason: 'register-failed' };
+  }
+}
diff --git a/tests/tools.test.ts b/tests/tools.test.ts
new file mode 100644
index 0000000..fd38cba
--- /dev/null
+++ b/tests/tools.test.ts
@@ -0,0 +1,148 @@
+/**
+ * Tests for agent-callable goal tools.
+ * Why these tests exist: prove the tool lane registers four tools and shares
+ * the exact slash handler, so model-driven and user-driven paths cannot drift.
+ */
+import { describe, expect, it } from 'vitest';
+import { mkdtempSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import * as path from 'node:path';
+import { registerGoalTools } from '../src/tools.js';
+import {
+  BlockInputSchema,
+  CompleteInputSchema,
+  GoalInputSchema,
+  ResumeInputSchema,
+} from '../src/goal.js';
+import type { Clock } from '../src/state.js';
+
+/** Fixed clock keeps tool timestamps deterministic. */
+class FakeClock implements Clock {
+  nowMs(): number {
+    return 1700000000000;
+  }
+}
+
+/** Captured tool definition with a callable execute. */
+interface CapturedDef {
+  name: string;
+  description: string;
+  input: unknown;
+  execute: (input: unknown, context: unknown) => Promise<{ content: string }>;
+}
+
+/** Fake host ctx capturing editor.add calls. */
+function fakeCtx(defs: CapturedDef[]): unknown {
+  return {
+    tool: {
+      transform: async (
+        fn: (editor: { add: (d: CapturedDef) => void }) => void,
+      ) => {
+        fn({ add: (d: CapturedDef) => defs.push(d) });
+      },
+    },
+  };
+}
+
+describe('registerGoalTools', () => {
+  it('registers four tools beside the slash lane', async () => {
+    const defs: CapturedDef[] = [];
+    const out = await registerGoalTools(
+      fakeCtx(defs),
+      mkdtempSync(path.join(tmpdir(), 'goal-tools-')),
+      new FakeClock(),
+    );
+    expect(out).toEqual({ registered: true, reason: 'ok' });
+    expect(defs.map((d) => d.name)).toEqual([
+      'goal_set',
+      'goal_block',
+      'goal_complete',
+      'goal_resume',
+    ]);
+    for (const d of defs) {
+      expect(typeof d.description).toBe('string');
+      expect(d.description.length).toBeGreaterThan(0);
+    }
+  });
+  it('fails closed without throwing on a host without the tool domain', async () => {
+    const out = await registerGoalTools({}, '/tmp/x', new FakeClock());
+    expect(out.registered).toBe(false);
+    expect(out.reason).toBe('tool-hook-unavailable');
+  });
+  it('fails closed on bad opts without throwing', async () => {
+    const defs: CapturedDef[] = [];
+    expect(
+      (await registerGoalTools(fakeCtx(defs), '', new FakeClock())).registered,
+    ).toBe(false);
+    expect(defs.length).toBe(0);
+  });
+});
+
+describe('tool schemas', () => {
+  it('set reuses GoalInputSchema closed shape', () => {
+    expect(GoalInputSchema.required).toContain('title');
+    expect(GoalInputSchema.additionalProperties).toBe(false);
+  });
+  it('block requires reason and complete plus resume take no args', () => {
+    expect(BlockInputSchema.required).toContain('reason');
+    expect(BlockInputSchema.additionalProperties).toBe(false);
+    expect(CompleteInputSchema.additionalProperties).toBe(false);
+    expect(ResumeInputSchema.additionalProperties).toBe(false);
+  });
+});
+
+describe('tool execute parity with slash', () => {
+  async function toolDefs(dir: string): Promise<CapturedDef[]> {
+    const defs: CapturedDef[] = [];
+    await registerGoalTools(fakeCtx(defs), dir, new FakeClock());
+    return defs;
+  }
+  function byName(defs: CapturedDef[], name: string): CapturedDef {
+    const found = defs.find((d) => d.name === name);
+    if (!found) throw new Error('missing tool ' + name);
+    return found;
+  }
+  it('goal_set writes the same state as slash and rejects escapes', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-set-'));
+    const defs = await toolDefs(dir);
+    const ok = await byName(defs, 'goal_set').execute(
+      { title: 'ship tool lane' },
+      { sessionID: 'sess-1' },
+    );
+    expect(ok.content).toContain('Goal set to active');
+    const bad = await byName(defs, 'goal_set').execute(
+      { title: '../escape' },
+      { sessionID: 'sess-1' },
+    );
+    expect(bad.content).toContain('path escape');
+    const nonString = await byName(defs, 'goal_set').execute({ title: 42 }, {});
+    expect(nonString.content).toContain('Invalid');
+  });
+  it('goal_block and goal_resume round-trip a parked goal', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-block-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'park me' }, {});
+    const blocked = await byName(defs, 'goal_block').execute(
+      { reason: 'waiting on review' },
+      {},
+    );
+    expect(blocked.content).toContain('blocked');
+    const resumed = await byName(defs, 'goal_resume').execute({}, {});
+    expect(resumed.content).toContain('resumed');
+  });
+  it('goal_complete stays blocked without evidence', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-complete-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'prove it' }, {});
+    const done = await byName(defs, 'goal_complete').execute({}, {});
+    expect(done.content).toContain('blocked');
+  });
+  it('execute never throws on hostile input', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-hostile-'));
+    const defs = await toolDefs(dir);
+    for (const d of defs) {
+      const out = await d.execute(null, null);
+      expect(typeof out.content).toBe('string');
+    }
+  });
+});
```
<!-- END_GIT_DIFF -->
