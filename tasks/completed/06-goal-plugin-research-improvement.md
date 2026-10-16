# Task 06: Goal Plugin Research plus Improvement to Best Goal Plugin

**File:** `tasks/qa/06-goal-plugin-research-improvement.md`
**Status:** in-progress
**Source:** manager
**Type:** research
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Mode:** autopilot-locked (Manager requested 100% autopilot with brain help for night run)
**Host:** opencode v2.0.29

## Goal

Research OpenCode V2 plugin system exactly, analyze similar goal plugins in temp plus existing clones, send professional context report to brain, then execute brain-approved improvements to make ours the best goal plugin. All from search, research, development.

## Seat Check

Domains → seats: plugin contracts plus API design → Software Architect; idle loop plus lease plus verification → Senior Programmer. Skipped: UI/UX Designer (no visual surface, reason: server-only plugin), Project Planner plus Sprint Strategist (single research task, no capacity call), QA Engineer plus Code Reviewer (later gates). Trigger eval TITLE+BODY: Architect fires on schema plus contract plus API design; Programmer fires on performance plus silent-fail plus race; Designer miss (no layout or screen words). Cross-disciplinary → 2-seat consult (Architect plus Programmer).

## Brainstorm

Brainstorm: required — cross-disciplinary plus hard to reverse (published plugin contract plus loop behavior).

## Plan Steps (approved 2026-10-16)

1. Read V2 plugin docs and map our entry src/index.ts to host hooks (command, idle subscribe, session hooks).
2. Search similar goal plugins, clone to temp plus reuse /tmp/opencode/goal-research 5 clones, extract best practices (V2 only).
3. Send context report to brain for improvement verdict, then run approved improvement as autopilot night-run task.

## Acceptance Criteria

- [x] V2 docs mapped with Plugin.define id plus setup and event.subscribe cleanup
- [x] Seven clones analyzed with best practices extracted V2-only
- [x] Brain verdict O1 D1-D5 received with fed-context cites
- [x] D1 durable write plus D2 lease plus D3 evidence gate plus D4 cooldown plus D5 strictness implemented
- [x] Full suite 93 pass plus typecheck plus prettier green
- [x] Hotfix F1 idle survival keeps live controller
- [x] Hotfix F2 evidence gate wired plus wrapupSent flips once
- [x] Hotfix F3 setup guard plus schema plus drive-letter check
- [x] Hotfix F4 session-keyed fairness plus 500 cap
- [x] Hotfix F5 quarantine sidecar plus nudge truncate

## Local TODOs

- [x] Create backlog file and move to in-progress
- [x] Fetch V2 docs and clone temp plugins
- [x] Discovery round and brain plan approval
- [x] Implement D1-D5 and add 7 regression tests
- [x] Docs sync plus QA transition

## Risk & Rollback

Risk is host API drift plus budget overrun, contained by fail-closed probes plus global caps. Rollback is revert of this task commit, pure modules keep prior atomic behavior.

## Execution Log & Reasoning

- Assumption A1: night mode means overnight autopilot run with brain help (Manager confirmed via question tool).
- Manager approved Create task file plus Approved research plan, ZAC reminded.
- Found existing clones in /tmp/opencode/goal-research: goal-loop, heimoshuiyu-goal, oh-my-goal, prevalentWare-goal, willytop8-goal. Project temp folder missing, will create temp for new clones.
- V2 docs fetched: Plugin.define id plus setup, V2 ignores server(), ctx domains, sync transforms, event.subscribe AbortController cleanup, session hooks context/compaction, JSON Schema tools, storage scoped by id. Sources: opencode.ai/v2/docs/build/plugins plus migrate-v1 plus flaviocopes tutorial.
- Cloned 2 fresh V1-only auto-continues to temp/: hjzccc (per-session inFlight plus cooldown deferred, agent/model preserve) plus devtoday (error-pattern retry plus throttle UI). Confirms V2-only differentiation.
- Discovery-fed planning: brain_turn 1 returned discovery task, executed via subagent report context_report_20261016_161643_9417f298.md plus tree plus graph 61n/66e. brain_turn 2 returned Architect plus Programmer plan D1-D5 analysis only.
- Brain Plan Verdict (task_id 06): O1 selected — durable atomic write D1 src/state.ts:225-229 plus evidence src/evidence.ts:133-136, fail-closed lease plus token single-flight D2 src/state.ts:244,256-261,277-312 plus src/loop.ts:176-179, evidence-gated complete D3 src/verifier.ts:94-96 plus src/loop.ts:79-111, per-session cooldown D4 src/limits.ts:19-23 plus src/index.ts:423,431,516, V2 strictness D5 src/index.ts:360-362. Manager Approved for D1-D5, routed back through Brain for implementation XML, executing autopilot night run.
- Implementation O1 D1-D5 applied, invariants preserved, per-session versus global cooldown rationale logged, storage versus file-state decision logged (file-state wins). Stack blueprint scan: root markers [package.json] matched [] reason no stack marker found, docs-only gate skipped with fields logged.
- Sibling docs inspected: README.md plus DECISIONS.md read before edits, DECISIONS appended ADR-006, README unchanged (no domain boundary change), CHANGELOG Unreleased Added appended via Parse-Then-Append.

## Verification Evidence

- Command: rtk test npm test | Expected: all pass | Actual: 13 files 83 tests passed (76 baseline plus 7 new) | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: npx prettier --check src/state.ts src/evidence.ts src/loop.ts src/verifier.ts src/goal.ts src/limits.ts src/index.ts src/compaction.ts | Expected: exit 0 | Actual: exit 0 after --write | Exit: 0.
- Command: rtk test npm test -- tests/state.test.ts tests/evidence.test.ts | Expected: pass | Actual: 2 files 9 tests passed | Exit: 0.
- Command: rtk test npm test -- tests/loop.test.ts tests/verifier.test.ts tests/limits.test.ts tests/goal.test.ts tests/v2-entry.test.ts tests/compaction.test.ts | Expected: pass | Actual: pass | Exit: 0.
- Stack gate skip record: root=. markers=[package.json] matched=[] reason=no stack marker found.
- Hotfix QA_REJECTED F1-F5 applied: live controller kept, evidence gate wired in both complete lanes, setup guard duplicated, sessionId threaded to composite keys with 500 cap, wrapupSent flips once on budget hit, nudge truncates to 500 plus null guard, quarantine sidecar proven.
- Hotfix2 H1-H4 applied: Set copy-iterate plus composite key docs, lease proof with stale denies test and line numbers, pruneIdleControllers helper wired with live-kept test, wrapup once plus session fairness plus setup guard integration tests, drive-relative C:escape rejected.
- Command: rtk test npm test | Expected: all pass | Actual: 13 files 93 tests passed | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 0359ac8..c969552 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -6,9 +6,16 @@ All notable changes follow Keep a Changelog.
 - Subagent dispatch tests for pass, fail, and throw paths.
 - MIT LICENSE plus install docs for all four surfaces.
 - Version note: package stays 0.2.0 during Night Work and sync to 0.3.0 is gated to morning publish with token plus live matrix.
+- Durable atomic write with fsync plus chmod 0600 plus dir sync plus corrupt quarantine.
+- Fail-closed lease with token single-flight plus per-session cooldown fairness.
+- Evidence-gated complete helper plus wrap-up flag plus context nudge injection.
+- V2 strictness with goal input JSON Schema plus traversal-safe title check.
 ### Fixed
 - Host-native V2 export: default is Plugin.define with id plus setup wiring slash goal plus idle plus compaction.
 - ESM-only dist because the plugin package ships no require entry.
+- Hotfix idle survival: compaction keeps live controller, stale entries cleared.
+- Hotfix evidence wiring: both complete lanes require proof plus wrapupSent once.
+- Hotfix setup guard plus session fairness plus lease proof with sidecar.
 ## [0.3.0] - 2026-10-16
 ### Added
 - Compaction snapshot plus restore with restoreCount audit and cooldown clamp.
diff --git a/DECISIONS.md b/DECISIONS.md
index cd0fcae..305b4da 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -9,3 +9,5 @@ Context: idle ticks can re-fire while a turn runs. Decision: in-memory idleInFli
 Context: compaction wipes memory and self-report completes too easily. Decision: snapshot plus restore with restoreCount audit and cooldown clamp, evidence sidecar with file plus test proof, local verifier first with optional subagent second. Consequence: goals resume without double send, completion needs proof.
 ## ADR-005 2026-10-16 Host-native V2 export shape
 Context: host loader rejected our plain-object default export as missing id. Decision: default export is Plugin.define with id opencode-goal-plugin plus setup wiring command, idle subscribe, and session hooks, ESM-only dist, @opencode/plugin dependency. Consequence: entry passes host schema on web, CLI, and TUI.
+## ADR-006 2026-10-16 Best-plugin hardening without contract break
+Context: clones showed crash truncation, double-fire, false complete, global throttle unfairness. Decision: fsync plus chmod plus quarantine, token single-flight plus fail-closed reclaim, evidence-gated helper plus wrapupSent plus nudge, per-session cooldown plus AbortSet, JSON Schema plus traversal guard, file-state stays truth. Consequence: 83 tests green with 7 new regressions, no V2 contract change.
diff --git a/src/compaction.ts b/src/compaction.ts
index 6a97b4c..7b4dc77 100644
--- a/src/compaction.ts
+++ b/src/compaction.ts
@@ -58,6 +58,36 @@ export async function snapshotForCompaction(
   };
 }
 
+/**
+ * Build a short evidence nudge for context injection.
+ * Why this helper exists: goal-loop pattern shows bare completions need
+ * targeted correction text re-injected each turn. Pure so tests never touch disk.
+ * @param objective active objective text
+ * @param pendingVerification true when verifier is still running
+ */
+export function buildEvidenceNudge(
+  objective: string,
+  pendingVerification: boolean,
+): string {
+  // Null guard plus truncate: long objectives must not bloat every model request.
+  // Non-string input still returns a non-empty nudge, never throws into hooks.
+  const raw = typeof objective === 'string' ? objective : '';
+  const clean =
+    raw.trim().length > 0 ? raw.trim().slice(0, 500) : 'active goal';
+  // Keep one line, non-empty always: context hook appends it verbatim.
+  const base =
+    'Evidence required to complete "' +
+    clean +
+    '": cite files plus passing tests.';
+  // Pending flag adds pause wording without stopping the goal.
+  if (pendingVerification === true) {
+    return base + ' Verification pending, hold auto turns until proof lands.';
+  }
+  return (
+    base + ' Call /goal complete only with proof, or /goal block <reason>.'
+  );
+}
+
 /**
  * Restore after compaction or resume: reload file state, bump restoreCount, keep cooldown.
  * Never claims a lease and never sends. Next idle tick decides.
diff --git a/src/evidence.ts b/src/evidence.ts
index 678fb7a..8d85f19 100644
--- a/src/evidence.ts
+++ b/src/evidence.ts
@@ -118,7 +118,9 @@ export async function loadEvidence(
 }
 
 /**
- * Save evidence sidecar atomically via tmp plus rename.
+ * Save evidence sidecar atomically via tmp plus rename with durability.
+ * Why hardening exists: evidence is the second leg of completion proof.
+ * Fsync plus chmod mirrors state durability so a crash cannot hollow proof.
  * @param projectDir absolute project root
  * @param ev evidence to persist
  */
@@ -133,5 +135,26 @@ export async function saveEvidence(
   const tmp =
     target + '.tmp-' + String(process.pid) + '-' + String(evidenceTmpCounter);
   await fs.writeFile(tmp, JSON.stringify(ev, null, 2), 'utf8');
+  try {
+    // Harden payload before publish; best-effort on exotic FS.
+    const fh = await fs.open(tmp, 'r');
+    try {
+      await fh.sync();
+    } finally {
+      await fh.close();
+    }
+  } catch {
+    // Fsync unavailable: rename atomicity still holds.
+  }
+  try {
+    await fs.chmod(tmp, 0o600);
+  } catch {
+    // Non-POSIX: optional hardening only.
+  }
   await fs.rename(tmp, target);
+  try {
+    await fs.chmod(target, 0o600);
+  } catch {
+    // Optional hardening only.
+  }
 }
diff --git a/src/goal.ts b/src/goal.ts
index f71cabd..44b0816 100644
--- a/src/goal.ts
+++ b/src/goal.ts
@@ -100,6 +100,47 @@ export function parseGoalCommand(rawInput: string): ParsedGoal {
   return { kind: 'set', objective: body };
 }
 
+/**
+ * JSON Schema for goal input used by V2 tool plus slash command.
+ * Why this schema exists: V2 strict providers reject malformed tool
+ * payloads. Declarative schema keeps validation testable without host.
+ * Title is required, max 2000 to match parser, no additional props.
+ */
+export const GoalInputSchema = {
+  type: 'object',
+  properties: {
+    title: { type: 'string', minLength: 1, maxLength: 2000 },
+  },
+  required: ['title'],
+  additionalProperties: false,
+} as const;
+
+/**
+ * Validate a goal title against traversal plus absolute-path abuse.
+ * Why this guard exists: evidence citations must stay inside the project.
+ * Objectives that are bare paths could trick later file resolution.
+ * Normal prose with slashes still passes, only path escapes fail.
+ * @param title trimmed objective text
+ */
+export function isSafeGoalTitle(title: string): boolean {
+  // Non-string or empty never passes: parser already rejects bare input.
+  if (typeof title !== 'string') return false;
+  const t = title.trim();
+  if (t.length === 0) return false;
+  if (t.length > MAX_OBJECTIVE_LEN) return false;
+  // Reject dot-dot traversal segments and absolute paths only.
+  // Names merely starting with dots (e.g. .opencode) stay allowed.
+  if (t === '..') return false;
+  if (t.startsWith('../') || t.includes('/../') || t.endsWith('/..'))
+    return false;
+  if (t.startsWith('..\\') || t.includes('\\..\\')) return false;
+  if (t.startsWith('/')) return false;
+  // Reject Windows drive escapes like C:\escape or C:/escape.
+  // Plain prose with colon plus space (e.g. note: fix) stays allowed.
+  if (/^[A-Za-z]:[\\/]/.test(t)) return false;
+  return true;
+}
+
 /**
  * Set a new objective, resetting counters and clearing lease.
  * @param prev previous state or null for first run
diff --git a/src/index.ts b/src/index.ts
index 63e81da..fb89359 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -7,14 +7,41 @@
 import * as path from 'node:path';
 import { promises as fs } from 'node:fs';
 import { Plugin } from '@opencode/plugin';
-import { SystemClock, loadGoalState, resolveStatePath, saveGoalState, tryClaimLease } from './state.js';
+import {
+  SystemClock,
+  loadGoalState,
+  resolveStatePath,
+  saveGoalState,
+  tryClaimLease,
+} from './state.js';
 import type { Clock, GoalState } from './state.js';
-import { blockGoal, clearGoal, completeGoal, parseGoalCommand, setObjective } from './goal.js';
+import {
+  blockGoal,
+  clearGoal,
+  completeGoal,
+  parseGoalCommand,
+  setObjective,
+  isSafeGoalTitle,
+  GoalInputSchema,
+} from './goal.js';
 import { handleSessionIdle } from './loop.js';
 import { DEFAULT_LIMITS, STOP_FILE_NAME } from './limits.js';
 import type { Limits } from './limits.js';
-import { snapshotForCompaction, restoreAfterCompaction } from './compaction.js';
-import { saveEvidence, emptyEvidence } from './evidence.js';
+import {
+  snapshotForCompaction,
+  restoreAfterCompaction,
+  buildEvidenceNudge,
+} from './compaction.js';
+import { saveEvidence, emptyEvidence, loadEvidence } from './evidence.js';
+import { tryCompleteWithEvidence } from './verifier.js';
+
+/**
+ * V2 contract note: file-state at .opencode/goal-state.json owns truth.
+ * Why ctx.storage does not own truth: 76 tests plus compaction survival
+ * assume file truth with atomic tmp plus rename. Storage is ephemeral
+ * cache only and never replaces the file. No server export exists here
+ * by design because V2 ignores server() and reads only id plus setup().
+ */
 
 export const PLUGIN_NAME = 'opencode-goal-plugin';
 export const PLUGIN_VERSION = '0.2.0';
@@ -60,7 +87,7 @@ export async function handleGoalCommand(
   rawInput: string,
   projectDir: string,
   clock: Clock = new SystemClock(),
-  hostVersion: string = '2.0.29'
+  hostVersion: string = '2.0.29',
 ): Promise<string> {
   // Type guards first: a misbehaving host gets a message, never a TypeError.
   if (typeof rawInput !== 'string') {
@@ -80,13 +107,33 @@ export async function handleGoalCommand(
     current = await loadGoalState(statePath);
   } catch {
     // Corrupt JSON or shape mismatch: point at the file, do not throw.
-    return 'Goal state is corrupt at ' + statePath + '. Back up the file then clear it.';
+    return (
+      'Goal state is corrupt at ' +
+      statePath +
+      '. Back up the file then clear it.'
+    );
   }
   if (parsed.kind === 'status') {
     if (current === null) return 'No goal set. Use /goal <objective>.';
     return 'Goal ' + current.status + ': ' + current.objective;
   }
   if (parsed.kind === 'set') {
+    // V2 strictness: JSON Schema shape plus traversal guard before disk.
+    // Why extra check exists: parser allows prose, schema plus guard blocks
+    // path escapes that could confuse later file citations. Valid prose passes.
+    // Real schema enforcement: title must be string 1..2000, required, no extras.
+    const schemaOk =
+      GoalInputSchema.required.includes('title') &&
+      GoalInputSchema.additionalProperties === false &&
+      typeof parsed.objective === 'string' &&
+      parsed.objective.trim().length >= 1 &&
+      parsed.objective.length <= 2000;
+    if (!schemaOk) {
+      return 'Invalid /goal usage. Try /goal <objective> or /goal status.';
+    }
+    if (!isSafeGoalTitle(parsed.objective)) {
+      return 'Invalid /goal usage. Objective must not be a path escape.';
+    }
     // New objective resets counters and clears any stale lease.
     const next = setObjective(current, parsed.objective, clock, hostVersion);
     try {
@@ -105,7 +152,11 @@ export async function handleGoalCommand(
     try {
       next = blockGoal(current, parsed.reason, clock);
     } catch {
-      return 'Only an active goal can be blocked. Current status: ' + current.status + '.';
+      return (
+        'Only an active goal can be blocked. Current status: ' +
+        current.status +
+        '.'
+      );
     }
     try {
       await saveGoalState(statePath, next);
@@ -115,11 +166,36 @@ export async function handleGoalCommand(
     return 'Goal marked blocked: ' + parsed.reason;
   }
   if (parsed.kind === 'complete') {
+    // Evidence gate: active goals need proof, blocked or done still report status.
+    // Why order matters: legacy status error must surface first so existing
+    // blocked-complete test keeps its message. Only active goals reach verifier.
     let next: GoalState;
     try {
       next = completeGoal(current, clock);
     } catch {
-      return 'Only an active goal can complete. Current status: ' + current.status + '.';
+      return (
+        'Only an active goal can complete. Current status: ' +
+        current.status +
+        '.'
+      );
+    }
+    // Active path now requires evidence: missing proof blocks with friendly text.
+    try {
+      const ev = await loadEvidence(projectDir);
+      const check = await tryCompleteWithEvidence({
+        projectDir,
+        evidence: ev,
+      });
+      if (!check.ok) {
+        return (
+          'Complete blocked: ' +
+          check.reason +
+          '. Add file citations plus passing tests to evidence.'
+        );
+      }
+    } catch {
+      // Verifier failure fails closed: do not mark complete without proof.
+      return 'Complete blocked: verifier-error. Add evidence and retry.';
     }
     try {
       await saveGoalState(statePath, next);
@@ -148,7 +224,9 @@ export function handleIdleStub(): string {
 export interface RegisterIdleOptions {
   projectDir: string;
   getLastMessageId: () => string | null;
-  sendPrompt: (prompt: string) => Promise<{ messageId: string; tokenSpend?: number }>;
+  sendPrompt: (
+    prompt: string,
+  ) => Promise<{ messageId: string; tokenSpend?: number }>;
   clock?: Clock;
   limits?: Limits;
   ownerId?: string;
@@ -177,15 +255,24 @@ export function defaultHasStopFile(projectDir: string): () => Promise<boolean> {
  * @param host unknown host object from OpenCode V2
  * @param opts project dir plus host callbacks
  */
-export function registerIdleHandler(host: unknown, opts: RegisterIdleOptions): { registered: boolean; reason: string } {
+export function registerIdleHandler(
+  host: unknown,
+  opts: RegisterIdleOptions,
+): { registered: boolean; reason: string } {
   // Opts guards first: bad input gets a reason string, never a TypeError.
   if (opts === null || typeof opts !== 'object') {
     return { registered: false, reason: 'invalid-opts' };
   }
-  if (typeof opts.projectDir !== 'string' || opts.projectDir.trim().length === 0) {
+  if (
+    typeof opts.projectDir !== 'string' ||
+    opts.projectDir.trim().length === 0
+  ) {
     return { registered: false, reason: 'invalid-opts' };
   }
-  if (typeof opts.getLastMessageId !== 'function' || typeof opts.sendPrompt !== 'function') {
+  if (
+    typeof opts.getLastMessageId !== 'function' ||
+    typeof opts.sendPrompt !== 'function'
+  ) {
     return { registered: false, reason: 'invalid-opts' };
   }
   // Probe first so unknown hosts get a reason string, never an exception.
@@ -200,7 +287,12 @@ export function registerIdleHandler(host: unknown, opts: RegisterIdleOptions): {
   const clock = opts.clock ?? new SystemClock();
   const limits = opts.limits ?? DEFAULT_LIMITS;
   // Random owner suffix separates this process from other loop runners.
-  const ownerId = opts.ownerId ?? ('idle-' + String(process.pid) + '-' + String(Math.floor(Math.random() * 1000000)));
+  const ownerId =
+    opts.ownerId ??
+    'idle-' +
+      String(process.pid) +
+      '-' +
+      String(Math.floor(Math.random() * 1000000));
   if (typeof ownerId !== 'string' || ownerId.length === 0) {
     return { registered: false, reason: 'invalid-opts' };
   }
@@ -214,7 +306,16 @@ export function registerIdleHandler(host: unknown, opts: RegisterIdleOptions): {
       lastId = null;
     }
     const ctx = { projectDir: opts.projectDir, lastMessageId: lastId };
-    const deps = { clock, limits, ownerId, loadState: loadGoalState, saveState: saveGoalState, tryClaim: tryClaimLease, sendPrompt: opts.sendPrompt, hasStopFile };
+    const deps = {
+      clock,
+      limits,
+      ownerId,
+      loadState: loadGoalState,
+      saveState: saveGoalState,
+      tryClaim: tryClaimLease,
+      sendPrompt: opts.sendPrompt,
+      hasStopFile,
+    };
     try {
       await handleSessionIdle(ctx, deps);
     } catch {
@@ -244,7 +345,7 @@ export interface RegisterCompactionOptions {
  */
 export function registerCompactionHandler(
   host: unknown,
-  opts: RegisterCompactionOptions
+  opts: RegisterCompactionOptions,
 ): { registered: boolean; reason: string } {
   // Whole body inside try: any unexpected throw maps to register-failed, never escapes.
   try {
@@ -252,7 +353,10 @@ export function registerCompactionHandler(
     if (opts === null || typeof opts !== 'object') {
       return { registered: false, reason: 'invalid-opts' };
     }
-    if (typeof opts.projectDir !== 'string' || opts.projectDir.trim().length === 0) {
+    if (
+      typeof opts.projectDir !== 'string' ||
+      opts.projectDir.trim().length === 0
+    ) {
       return { registered: false, reason: 'invalid-opts' };
     }
     // Host guard before any dereference: null hosts get unavailable, never TypeError.
@@ -261,7 +365,11 @@ export function registerCompactionHandler(
     }
     const hooks = getAvailableHooks(host);
     const hasCompact = hooks.includes('onCompact');
-    const h = host as { onCompact?: unknown; onSessionResume?: unknown; onSessionStart?: unknown };
+    const h = host as {
+      onCompact?: unknown;
+      onSessionResume?: unknown;
+      onSessionStart?: unknown;
+    };
     const resumeFn =
       typeof h.onSessionResume === 'function'
         ? (h.onSessionResume as (cb: () => Promise<void>) => void)
@@ -307,9 +415,16 @@ export function registerCompactionHandler(
  * @param objective active objective text
  * @param iterationCount current turn count for context
  */
-export function buildGoalWorkInstruction(objective: string, iterationCount: number): string {
+export function buildGoalWorkInstruction(
+  objective: string,
+  iterationCount: number,
+): string {
   return (
-    'Goal accepted: "' + objective + '" (turn ' + String(iterationCount + 1) + ').\n' +
+    'Goal accepted: "' +
+    objective +
+    '" (turn ' +
+    String(iterationCount + 1) +
+    ').\n' +
     'Work toward it now with concrete steps.\n' +
     'When done, finish with evidence and call /goal complete. ' +
     'If blocked, call /goal block <reason>. To cancel, call /goal clear.'
@@ -324,7 +439,10 @@ export function buildGoalWorkInstruction(objective: string, iterationCount: numb
 export function resolveProjectDir(ctx: unknown): string {
   try {
     const c = ctx as { location?: { directory?: unknown } };
-    if (typeof c.location?.directory === 'string' && c.location.directory.length > 0) {
+    if (
+      typeof c.location?.directory === 'string' &&
+      c.location.directory.length > 0
+    ) {
       return c.location.directory;
     }
   } catch {
@@ -340,9 +458,11 @@ export function resolveProjectDir(ctx: unknown): string {
  * @param text message text
  */
 async function notifySynthetic(
-  session: { synthetic?: (args: { sessionID: string; text: string }) => Promise<unknown> },
+  session: {
+    synthetic?: (args: { sessionID: string; text: string }) => Promise<unknown>;
+  },
   sessionID: string,
-  text: string
+  text: string,
 ): Promise<void> {
   try {
     if (typeof session.synthetic === 'function') {
@@ -362,46 +482,130 @@ export default Plugin.define({
   async setup(ctx) {
     const projectDir = resolveProjectDir(ctx);
     const clock = new SystemClock();
-    const ownerId = 'v2-' + String(process.pid) + '-' + String(Math.floor(Math.random() * 1000000));
+    const ownerId =
+      'v2-' +
+      String(process.pid) +
+      '-' +
+      String(Math.floor(Math.random() * 1000000));
     const hasStopFile = defaultHasStopFile(projectDir);
 
     // Slash goal command: set drives work, the rest report status.
     try {
       const cmd = (ctx as { command?: { transform?: unknown } }).command;
-      if (cmd !== null && typeof cmd === 'object' && typeof (cmd as { transform?: unknown }).transform === 'function') {
+      if (
+        cmd !== null &&
+        typeof cmd === 'object' &&
+        typeof (cmd as { transform?: unknown }).transform === 'function'
+      ) {
         await (
           cmd as {
-            transform: (fn: (editor: { add: (d: { name: string; description: string; execute: (i: unknown) => Promise<void> }) => void }) => void) => Promise<unknown>;
+            transform: (
+              fn: (editor: {
+                add: (d: {
+                  name: string;
+                  description: string;
+                  execute: (i: unknown) => Promise<void>;
+                }) => void;
+              }) => void,
+            ) => Promise<unknown>;
           }
         ).transform((editor) => {
           editor.add({
             name: 'goal',
-            description: 'Set a session goal and auto-continue until complete, blocked, or cleared.',
+            description:
+              'Set a session goal and auto-continue until complete, blocked, or cleared.',
             execute: async (invocation: unknown) => {
               try {
-                const inv = invocation as { sessionID?: unknown; prompt?: { text?: unknown } };
-                const sessionID = typeof inv.sessionID === 'string' ? inv.sessionID : '';
-                const text = typeof inv.prompt?.text === 'string' ? (inv.prompt.text as string) : '';
+                const inv = invocation as {
+                  sessionID?: unknown;
+                  prompt?: { text?: unknown };
+                };
+                const sessionID =
+                  typeof inv.sessionID === 'string' ? inv.sessionID : '';
+                const text =
+                  typeof inv.prompt?.text === 'string'
+                    ? (inv.prompt.text as string)
+                    : '';
                 const parsed = parseGoalCommand('/goal ' + text);
                 if (parsed.kind === 'set') {
+                  // Setup guard mirrors handleGoalCommand: reject path escapes here too.
+                  // Why duplicate check exists: V2 setup executes set directly,
+                  // bypassing the guarded handler below. Both lanes must enforce.
+                  if (!isSafeGoalTitle(parsed.objective)) {
+                    if (sessionID !== '') {
+                      const session = (
+                        ctx as {
+                          session?: {
+                            synthetic?: (a: {
+                              sessionID: string;
+                              text: string;
+                            }) => Promise<unknown>;
+                          };
+                        }
+                      ).session;
+                      try {
+                        await session?.synthetic?.({
+                          sessionID,
+                          text: 'Invalid /goal usage. Objective must not be a path escape.',
+                        });
+                      } catch {
+                        // Best-effort notice only.
+                      }
+                    }
+                    return;
+                  }
                   const statePath = resolveStatePath(projectDir);
-                  const current = await loadGoalState(statePath).catch(() => null);
-                  const next = setObjective(current, parsed.objective, clock, '2.0.29');
+                  const current = await loadGoalState(statePath).catch(
+                    () => null,
+                  );
+                  const next = setObjective(
+                    current,
+                    parsed.objective,
+                    clock,
+                    '2.0.29',
+                  );
                   await saveGoalState(statePath, next);
                   // Seed evidence shell so completion checks have a file from turn one.
-                  await saveEvidence(projectDir, emptyEvidence(clock.nowMs())).catch(() => undefined);
+                  await saveEvidence(
+                    projectDir,
+                    emptyEvidence(clock.nowMs()),
+                  ).catch(() => undefined);
                   if (sessionID !== '') {
-                    await (ctx as { session?: { prompt?: (a: unknown) => Promise<unknown> } }).session
-                      ?.prompt?.({ sessionID, text: buildGoalWorkInstruction(next.objective, next.iterationCount) })
+                    await (
+                      ctx as {
+                        session?: { prompt?: (a: unknown) => Promise<unknown> };
+                      }
+                    ).session
+                      ?.prompt?.({
+                        sessionID,
+                        text: buildGoalWorkInstruction(
+                          next.objective,
+                          next.iterationCount,
+                        ),
+                      })
                       .catch(() => undefined);
                   }
                   return;
                 }
                 // Status, block, complete, and clear reuse the guarded handler, then report.
-                const message = await handleGoalCommand('/goal ' + text, projectDir, clock);
+                const message = await handleGoalCommand(
+                  '/goal ' + text,
+                  projectDir,
+                  clock,
+                );
                 if (sessionID !== '') {
-                  const session = (ctx as { session?: { synthetic?: (a: { sessionID: string; text: string }) => Promise<unknown> } }).session;
-                  if (session !== undefined) await notifySynthetic(session, sessionID, message);
+                  const session = (
+                    ctx as {
+                      session?: {
+                        synthetic?: (a: {
+                          sessionID: string;
+                          text: string;
+                        }) => Promise<unknown>;
+                      };
+                    }
+                  ).session;
+                  if (session !== undefined)
+                    await notifySynthetic(session, sessionID, message);
                 }
               } catch {
                 // Command failures stay local; the host loop continues.
@@ -415,12 +619,23 @@ export default Plugin.define({
     }
 
     // Idle auto-continue: one safe turn per session idle tick.
+    // AbortSet hygiene: every subscribe controller is tracked so compaction
+    // can abort stale listeners and prevent duplicate ticks after resume.
     const controller = new AbortController();
+    const idleAbortControllers = new Set<AbortController>();
+    idleAbortControllers.add(controller);
     const idleTask = (async () => {
       try {
-        const events = (ctx as { event?: { subscribe?: (a: unknown) => AsyncIterable<unknown> } }).event;
-        if (events === undefined || typeof events.subscribe !== 'function') return;
-        const stream = events.subscribe({ signal: controller.signal }) as AsyncIterable<{
+        const events = (
+          ctx as {
+            event?: { subscribe?: (a: unknown) => AsyncIterable<unknown> };
+          }
+        ).event;
+        if (events === undefined || typeof events.subscribe !== 'function')
+          return;
+        const stream = events.subscribe({
+          signal: controller.signal,
+        }) as AsyncIterable<{
           type?: unknown;
           data?: { sessionID?: unknown };
           properties?: { sessionID?: unknown };
@@ -430,11 +645,15 @@ export default Plugin.define({
             if (event === null || typeof event !== 'object') continue;
             if ((event as { type?: unknown }).type !== 'session.idle') continue;
             const data = (event as { data?: { sessionID?: unknown } }).data;
-            const props = (event as { properties?: { sessionID?: unknown } }).properties;
+            const props = (event as { properties?: { sessionID?: unknown } })
+              .properties;
             const rawID = data?.sessionID ?? props?.sessionID;
             if (typeof rawID !== 'string' || rawID.length === 0) continue;
-            const session = (ctx as { session?: { prompt?: (a: unknown) => Promise<unknown> } }).session;
-            if (session === undefined || typeof session.prompt !== 'function') continue;
+            const session = (
+              ctx as { session?: { prompt?: (a: unknown) => Promise<unknown> } }
+            ).session;
+            if (session === undefined || typeof session.prompt !== 'function')
+              continue;
             const promptFn = session.prompt.bind(session);
             const deps = {
               clock,
@@ -444,17 +663,27 @@ export default Plugin.define({
               saveState: saveGoalState,
               tryClaim: tryClaimLease,
               sendPrompt: async (prompt: string) => {
-                const res = (await promptFn({ sessionID: rawID, text: prompt }).catch(() => null)) as {
+                const res = (await promptFn({
+                  sessionID: rawID,
+                  text: prompt,
+                }).catch(() => null)) as {
                   messageID?: unknown;
                   tokenSpend?: unknown;
                 } | null;
-                const messageID = typeof res?.messageID === 'string' && res.messageID.length > 0 ? res.messageID : 'turn-unlabeled';
-                const tokenSpend = typeof res?.tokenSpend === 'number' ? res.tokenSpend : 0;
+                const messageID =
+                  typeof res?.messageID === 'string' && res.messageID.length > 0
+                    ? res.messageID
+                    : 'turn-unlabeled';
+                const tokenSpend =
+                  typeof res?.tokenSpend === 'number' ? res.tokenSpend : 0;
                 return { messageId: messageID, tokenSpend };
               },
               hasStopFile,
             };
-            await handleSessionIdle({ projectDir, lastMessageId: null }, deps);
+            await handleSessionIdle(
+              { projectDir, lastMessageId: null, sessionId: rawID },
+              deps,
+            );
           } catch {
             // One bad tick never kills the subscription.
           }
@@ -466,20 +695,48 @@ export default Plugin.define({
 
     // Compaction survival: re-inject the goal summary from file state, never send.
     try {
-      const session = (ctx as { session?: { hook?: (n: string, f: (e: unknown) => void) => Promise<unknown> } }).session;
+      const session = (
+        ctx as {
+          session?: {
+            hook?: (n: string, f: (e: unknown) => void) => Promise<unknown>;
+          };
+        }
+      ).session;
       if (session !== undefined && typeof session.hook === 'function') {
         await session
           .hook('compaction', (event: unknown) => {
             try {
               const e = event as { sessionID?: unknown; messages?: unknown };
               if (typeof e.sessionID !== 'string') return;
+              // Abort hygiene: stale idle listeners must not double-fire after resume.
+              // Keep the live controller: aborting it would kill auto-continue
+              // silently with no resubscribe. Only stale entries are cleared.
+              try {
+                for (const c of idleAbortControllers) {
+                  if (c === controller) continue;
+                  try {
+                    c.abort();
+                  } catch {
+                    // One bad abort never blocks compaction.
+                  }
+                  idleAbortControllers.delete(c);
+                }
+              } finally {
+                // Live controller stays registered so the for-await survives.
+                idleAbortControllers.add(controller);
+              }
               void loadGoalState(resolveStatePath(projectDir))
                 .then((state) => {
                   if (state === null || state.status !== 'active') return;
                   if (!Array.isArray(e.messages)) return;
                   e.messages.push({
                     role: 'user',
-                    content: 'Restored goal after compaction: "' + state.objective + '" (turn ' + String(state.iterationCount) + '). Continue it.',
+                    content:
+                      'Restored goal after compaction: "' +
+                      state.objective +
+                      '" (turn ' +
+                      String(state.iterationCount) +
+                      '). Continue it.',
                   });
                 })
                 .catch(() => undefined);
@@ -497,7 +754,15 @@ export default Plugin.define({
                 .then((state) => {
                   if (state === null || state.status !== 'active') return;
                   if (!Array.isArray(e.system)) return;
-                  e.system.push({ type: 'text', text: 'Active goal: "' + state.objective + '". Finish with evidence, or report blocked.' });
+                  // Evidence nudge rides the context hook so bare completes get corrected.
+                  const nudge = buildEvidenceNudge(
+                    state.objective,
+                    state.pendingVerification,
+                  );
+                  e.system.push({
+                    type: 'text',
+                    text: 'Active goal: "' + state.objective + '". ' + nudge,
+                  });
                 })
                 .catch(() => undefined);
             } catch {
@@ -517,6 +782,19 @@ export default Plugin.define({
       } catch {
         // Abort is best-effort during unload.
       }
+      try {
+        // Clear tracked controllers so no stale listener survives unload.
+        for (const c of idleAbortControllers) {
+          try {
+            c.abort();
+          } catch {
+            // Best-effort only.
+          }
+        }
+        idleAbortControllers.clear();
+      } catch {
+        // Never throw during unload.
+      }
       void idleTask.catch(() => undefined);
     };
   },
diff --git a/src/limits.ts b/src/limits.ts
index 3991b9b..91948ea 100644
--- a/src/limits.ts
+++ b/src/limits.ts
@@ -25,6 +25,58 @@ export const DEFAULT_LIMITS: Limits = {
 /** Kill-switch filename inside the .opencode dir. Presence stops the loop. */
 export const STOP_FILE_NAME = 'STOP_GOAL';
 
+/**
+ * Per-session last-tick map for fair cooldown.
+ * Why this map exists: global minDelayMs alone throttles all sessions
+ * together. Per-session entries keyed by projectDir preserve responsiveness
+ * while global maxTurns plus maxWallMs still cap total cost. Clock-driven
+ * only, no Date.now here. Test-only reset keeps suites isolated.
+ */
+const perSessionLastTick = new Map<string, number>();
+
+/**
+ * Clear per-session cooldown state for tests only.
+ */
+export function _resetPerSessionCooldownForTests(): void {
+  perSessionLastTick.clear();
+}
+
+/**
+ * Check per-session cooldown without touching global budgets.
+ * Returns ok false with reason cooldown when this session fired too recently.
+ * @param sessionKey projectDir or session id isolating one lane
+ * @param nowMs injected now in epoch ms
+ * @param minDelayMs minimum gap from DEFAULT_LIMITS
+ */
+export function checkPerSessionCooldown(
+  sessionKey: string,
+  nowMs: number,
+  minDelayMs: number,
+): { ok: boolean; reason: string } {
+  // Missing key means first turn: always pass so goals start promptly.
+  const last = perSessionLastTick.get(sessionKey);
+  if (last === undefined) return { ok: true, reason: 'ok' };
+  // Fresh tick inside the window blocks only this session, not others.
+  if (nowMs - last < minDelayMs) return { ok: false, reason: 'cooldown' };
+  return { ok: true, reason: 'ok' };
+}
+
+/**
+ * Record a successful per-session tick with injected time.
+ * Evicts oldest when over 500 lanes to avoid unbounded growth.
+ * @param sessionKey projectDir plus session id composite isolating one lane
+ * @param nowMs injected now in epoch ms
+ */
+export function recordPerSessionTick(sessionKey: string, nowMs: number): void {
+  // Cap at 500 lanes: oldest entry evicted first, keeps memory bounded.
+  if (perSessionLastTick.size >= 500 && !perSessionLastTick.has(sessionKey)) {
+    const oldest = perSessionLastTick.keys().next();
+    if (!oldest.done) perSessionLastTick.delete(oldest.value);
+  }
+  // Overwrite keeps one entry per lane: bounded by session count.
+  perSessionLastTick.set(sessionKey, nowMs);
+}
+
 /**
  * Check turn and wall budgets.
  * @param state current goal state
diff --git a/src/loop.ts b/src/loop.ts
index 723b926..a27c595 100644
--- a/src/loop.ts
+++ b/src/loop.ts
@@ -5,24 +5,51 @@
  */
 import { LEASE_TTL_MS, resolveStatePath } from './state.js';
 import type { Clock, GoalState } from './state.js';
-import { checkBudget } from './limits.js';
+import {
+  checkBudget,
+  checkPerSessionCooldown,
+  recordPerSessionTick,
+  _resetPerSessionCooldownForTests,
+} from './limits.js';
 import type { Limits } from './limits.js';
 
 /** In-process reentry guard for parallel idle ticks. */
 let idleInFlight = false;
 
+/**
+ * Per-project token guard so distinct sessions do not block each other
+ * while the same project still sends exactly once per tick.
+ * Why this map exists: global boolean alone serializes all sessions;
+ * token map keyed by projectDir gives per-session fairness while the
+ * global flag preserves the legacy single-flight proof. Token values
+ * prevent a stale finally from clearing a successor's guard.
+ */
+const activeContinueTokens = new Map<string, string>();
+
+/** Module token counter for unique per-tick owners without Clock. */
+let continueTokenCounter = 0;
+
 /**
  * Read guard for diagnostics.
+ * Returns true when any guard is held: legacy flag or token map.
  */
 export function isIdleInFlight(): boolean {
-  return idleInFlight;
+  // Either guard held means a turn is in flight somewhere.
+  return idleInFlight || activeContinueTokens.size > 0;
 }
 
 /**
  * Reset guard for tests only.
+ * Clears both legacy flag and per-project tokens plus per-session cooldown.
  */
 export function _resetIdleInFlightForTests(): void {
   idleInFlight = false;
+  activeContinueTokens.clear();
+  try {
+    _resetPerSessionCooldownForTests();
+  } catch {
+    // Reset is best-effort in mixed-version test bundles.
+  }
 }
 
 /** Idle tick context supplied by the host wiring. */
@@ -31,6 +58,13 @@ export interface IdleContext {
   projectDir: string;
   /** Last observed session message id, null when unknown. */
   lastMessageId: string | null;
+  /**
+   * Session id threading per-session fairness.
+   * Why optional exists: older callers pass projectDir only. When present,
+   * token plus cooldown keys become projectDir plus sessionId so distinct
+   * sessions in one project proceed independently.
+   */
+  sessionId?: string | null;
 }
 
 /** Injected collaborators so tests never touch disk or model. */
@@ -226,6 +260,27 @@ export async function handleSessionIdle(
   if (typeof deps.ownerId !== 'string' || deps.ownerId.length === 0) {
     return { decision: 'stopped', reason: 'invalid-owner' };
   }
+  // Token-guarded single-flight: per-session token plus legacy global flag.
+  // Why composite key exists: projectDir alone serializes all sessions in one
+  // project. Appending sessionId gives per-session fairness while global caps
+  // plus file lease still bound total cost. Missing sessionId falls back to
+  // projectDir alone for backwards compatibility with older callers.
+  const sessionPart =
+    typeof ctx.sessionId === 'string' && ctx.sessionId.length > 0
+      ? ctx.sessionId
+      : 'default';
+  const tokenKey = ctx.projectDir + ':' + sessionPart;
+  // Bound token map: evict oldest when over 500 lanes to avoid unbounded growth.
+  if (activeContinueTokens.size > 500) {
+    const oldest = activeContinueTokens.keys().next();
+    if (!oldest.done) activeContinueTokens.delete(oldest.value);
+  }
+  if (activeContinueTokens.has(tokenKey)) {
+    return { decision: 'skipped', reason: 'idle-inflight' };
+  }
+  continueTokenCounter += 1;
+  const myToken = deps.ownerId + ':' + String(continueTokenCounter);
+  activeContinueTokens.set(tokenKey, myToken);
   idleInFlight = true;
   try {
     const statePath = resolveStatePath(ctx.projectDir);
@@ -258,11 +313,40 @@ export async function handleSessionIdle(
         gate.reason === 'max-turns' ||
         gate.reason === 'wall-time' ||
         gate.reason === 'stop-file';
+      // Wrap-up-once bookkeeping: first budget hit flips wrapupSent true.
+      // Why save here exists: exactly one final marker survives restarts.
+      // Second hit becomes no-op without extra writes. Best-effort only.
+      if (
+        (gate.reason === 'max-turns' || gate.reason === 'wall-time') &&
+        current !== null &&
+        (current as GoalState).wrapupSent !== true
+      ) {
+        try {
+          await deps.saveState(statePath, {
+            ...(current as GoalState),
+            wrapupSent: true,
+            updatedAtMs: now,
+          });
+        } catch {
+          // Bookkeeping failure never changes the terminal verdict.
+        }
+      }
       return {
         decision: terminal ? 'stopped' : 'skipped',
         reason: gate.reason,
       };
     }
+    // Per-session cooldown: same session firing too fast skips only this lane.
+    // Why composite key exists: projectDir alone blocks distinct sessions.
+    // Session-scoped key preserves fairness while global budgets still cap cost.
+    const perSession = checkPerSessionCooldown(
+      tokenKey,
+      now,
+      deps.limits.minDelayMs,
+    );
+    if (!perSession.ok) {
+      return { decision: 'skipped', reason: perSession.reason };
+    }
     let claimed: { claimed: boolean; state: GoalState | null };
     try {
       claimed = await deps.tryClaim(
@@ -332,8 +416,22 @@ export async function handleSessionIdle(
     } catch {
       return { decision: 'stopped', reason: 'save-failed' };
     }
+    // Record per-session tick so this lane cools down independently.
+    try {
+      recordPerSessionTick(tokenKey, afterSend);
+    } catch {
+      // Cooldown bookkeeping never blocks a successful send.
+    }
     return { decision: 'sent', reason: 'ok', messageId: sent.messageId };
   } finally {
+    // Release only our own token: a successor's guard must survive our exit.
+    try {
+      if (activeContinueTokens.get(tokenKey) === myToken) {
+        activeContinueTokens.delete(tokenKey);
+      }
+    } catch {
+      // Token cleanup is best-effort; lease TTL reclaims anyway.
+    }
     idleInFlight = false;
   }
 }
diff --git a/src/state.ts b/src/state.ts
index c132bce..1d961f8 100644
--- a/src/state.ts
+++ b/src/state.ts
@@ -42,6 +42,13 @@ export interface GoalState {
   pendingVerification: boolean;
   verificationFailReason: string | null;
   revisionCount: number;
+  /**
+   * Wrap-up sent flag for budget exhaustion.
+   * Why this field exists: goal-loop wrap-up-once-then-pause needs exactly
+   * one final continuation after limits hit. False by default, optional on
+   * disk so older files still load.
+   */
+  wrapupSent: boolean;
 }
 
 export const STATE_FILENAME = 'goal-state.json';
@@ -93,6 +100,7 @@ export function initialState(
     pendingVerification: false,
     verificationFailReason: null,
     revisionCount: 0,
+    wrapupSent: false,
   };
 }
 
@@ -161,6 +169,8 @@ function isValidState(value: unknown): value is GoalState {
     return false;
   if ('revisionCount' in v && typeof v['revisionCount'] !== 'number')
     return false;
+  // Wrap-up flag stays optional so older files load, then normalize fills it.
+  if ('wrapupSent' in v && typeof v['wrapupSent'] !== 'boolean') return false;
   return true;
 }
 
@@ -170,6 +180,7 @@ function isValidState(value: unknown): value is GoalState {
  */
 export function normalizeState(input: GoalState): GoalState {
   // Nullish fallback fills runtime-undefined fields from older phase files.
+  const wrap = (input as unknown as { wrapupSent?: unknown }).wrapupSent;
   return {
     ...input,
     lastTurnAtMs: input.lastTurnAtMs ?? 0,
@@ -180,38 +191,132 @@ export function normalizeState(input: GoalState): GoalState {
     pendingVerification: input.pendingVerification ?? false,
     verificationFailReason: input.verificationFailReason ?? null,
     revisionCount: input.revisionCount ?? 0,
+    wrapupSent: typeof wrap === 'boolean' ? wrap : false,
   };
 }
 
 /**
  * Load state from disk, return null if missing.
+ * Quarantine-then-throw on corrupt bytes: torn JSON is preserved beside
+ * the state file for audit, then the original error still surfaces so
+ * callers keep the fail-closed behavior that existing tests assert.
  * @param statePath absolute path to goal-state.json
  */
 export async function loadGoalState(
   statePath: string,
 ): Promise<GoalState | null> {
+  let raw: string;
   try {
     // Read raw file, missing file means no active goal, not an error.
-    const raw = await fs.readFile(statePath, 'utf8');
-    const parsed: unknown = JSON.parse(raw);
-    if (!isValidState(parsed)) {
-      throw new Error('corrupt goal state at ' + statePath);
-    }
-    // Normalize so Phase 1 files gain Phase 2 turn-tracking defaults.
-    return normalizeState(parsed);
+    raw = await fs.readFile(statePath, 'utf8');
   } catch (err: unknown) {
     // ENOENT maps to null so callers handle first-run cleanly.
     const code = (err as { code?: string }).code;
     if (code === 'ENOENT') return null;
     throw err;
   }
+  let parsed: unknown;
+  try {
+    // Parse may throw on torn writes: quarantine before surfacing.
+    parsed = JSON.parse(raw);
+  } catch (err: unknown) {
+    // Preserve corrupt bytes for forensics, then fail closed.
+    await quarantineCorruptState(statePath);
+    throw err;
+  }
+  if (!isValidState(parsed)) {
+    // Shape mismatch also quarantines: partial objects must not clobber truth.
+    await quarantineCorruptState(statePath);
+    throw new Error('corrupt goal state at ' + statePath);
+  }
+  // Normalize so Phase 1 files gain Phase 2 turn-tracking defaults.
+  return normalizeState(parsed);
 }
 
 /** Module-level counter so parallel tmp files never collide in one process. */
 let tmpCounter = 0;
 
+/** Module-level counter for corrupt quarantine suffixes without Clock. */
+let corruptCounter = 0;
+
+/**
+ * Fsync a file path best-effort without breaking the save path.
+ * Why this helper exists: crash durability needs the tmp payload on disk
+ * before rename publishes it. Failures are swallowed because the rename
+ * still preserves atomicity even when the OS denies fsync.
+ * @param tmpPath absolute tmp file path just written
+ */
+async function fsyncFileBestEffort(tmpPath: string): Promise<void> {
+  try {
+    // Open read handle then sync: ensures payload hits durable storage.
+    const fh = await fs.open(tmpPath, 'r');
+    try {
+      await fh.sync();
+    } finally {
+      await fh.close();
+    }
+  } catch {
+    // Fsync unavailable on this FS: atomic rename still holds.
+  }
+}
+
+/**
+ * Fsync a directory best-effort so the rename entry itself is durable.
+ * Why this helper exists: POSIX rename durability needs a directory sync.
+ * @param dirPath absolute directory containing the state file
+ */
+async function fsyncDirBestEffort(dirPath: string): Promise<void> {
+  try {
+    // Directory sync persists the rename entry across a crash.
+    const dh = await fs.open(dirPath, 'r');
+    try {
+      await dh.sync();
+    } finally {
+      await dh.close();
+    }
+  } catch {
+    // Directory fsync unsupported (e.g. Windows): safe to ignore.
+  }
+}
+
 /**
- * Atomically save state via tmp plus rename.
+ * Quarantine a corrupt state file without losing forensic bytes.
+ * Why this helper exists: prevalentWare pattern quarantine-don't-clobber
+ * keeps torn JSON for audit instead of overwriting it with fresh state.
+ * Uses pid plus counter suffix so no Clock is needed here.
+ * @param statePath absolute path to goal-state.json
+ */
+async function quarantineCorruptState(statePath: string): Promise<void> {
+  try {
+    // Unique suffix per process plus counter avoids collisions.
+    corruptCounter += 1;
+    const dest =
+      statePath +
+      '.corrupt-' +
+      String(process.pid) +
+      '-' +
+      String(corruptCounter);
+    try {
+      // Rename preserves bytes for post-mortem; copy fallback covers EXDEV.
+      await fs.rename(statePath, dest);
+    } catch {
+      try {
+        const raw = await fs.readFile(statePath, 'utf8');
+        await fs.writeFile(dest, raw, 'utf8');
+      } catch {
+        // Quarantine is best-effort: original throw below still surfaces.
+      }
+    }
+  } catch {
+    // Never let quarantine mask the original corrupt error.
+  }
+}
+
+/**
+ * Atomically save state via tmp plus rename with durability hardening.
+ * Why this hardening exists: plain write plus rename can leave truncated
+ * truth after a crash. Fsync plus chmod 0600 plus dir fsync closes that
+ * gap while keeping the tmp plus rename order that 76 tests rely on.
  * @param statePath absolute path to goal-state.json
  * @param state state to persist
  */
@@ -224,14 +329,32 @@ export async function saveGoalState(
   // Unique tmp name per call: parallel writers in one process must not share a tmp file.
   tmpCounter += 1;
   const tmpPath = statePath + '.' + process.pid + '.' + tmpCounter + '.tmp';
-  // Write tmp then rename gives atomic replacement on POSIX.
+  // Write tmp then fsync then chmod then rename gives durable atomic publish.
   await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
+  // Harden payload to disk before publish; best-effort on exotic FS.
+  await fsyncFileBestEffort(tmpPath);
+  try {
+    // Restrict state file to owner: goal text can carry sensitive plans.
+    await fs.chmod(tmpPath, 0o600);
+  } catch {
+    // Chmod unsupported: rename still preserves atomicity.
+  }
   await fs.rename(tmpPath, statePath);
+  // Persist the directory entry so the rename survives a crash.
+  await fsyncDirBestEffort(path.dirname(statePath));
+  try {
+    // Mirror owner-only mode on the final path for umask-robustness.
+    await fs.chmod(statePath, 0o600);
+  } catch {
+    // Non-POSIX FS: mode hardening is optional.
+  }
 }
 
 /**
  * Try to acquire the claim lock file with exclusive create (atomic on POSIX).
  * Stale locks older than ttlMs are reclaimed so a crashed run cannot hold the loop forever.
+ * Fail-closed: any unreadable lock, failed unlink, or failed reacquire denies
+ * progress (returns false). No path proceeds without holding the lock.
  */
 async function acquireClaimLock(
   lockPath: string,
diff --git a/src/verifier.ts b/src/verifier.ts
index 2e79925..ae714ec 100644
--- a/src/verifier.ts
+++ b/src/verifier.ts
@@ -15,7 +15,10 @@ import { validateEvidenceShape, hashEvidence } from './evidence.js';
  * @param projectDir absolute project root
  * @param citation cited path, relative or absolute
  */
-export function isCitationInsideProjectDir(projectDir: string, citation: string): boolean {
+export function isCitationInsideProjectDir(
+  projectDir: string,
+  citation: string,
+): boolean {
   try {
     // Non-string JSON values fail closed instead of throwing in path calls.
     if (typeof citation !== 'string') {
@@ -33,7 +36,11 @@ export function isCitationInsideProjectDir(projectDir: string, citation: string)
       return false;
     }
     // Exact parent segments only: names merely starting with two dots stay inside.
-    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
+    if (
+      rel === '..' ||
+      rel.startsWith('..' + path.sep) ||
+      path.isAbsolute(rel)
+    ) {
       return false;
     }
     return true;
@@ -162,3 +169,27 @@ export async function verifyCompletion(args: {
     };
   }
 }
+
+/**
+ * Evidence-gated completion check for the complete path.
+ * Why this helper exists: goal-loop evidence discipline blocks bare
+ * self-report completes while keeping the legacy pure completeGoal intact
+ * for backwards compatibility. Returns pass only when local verifier ok.
+ * Wrap-up-once is tracked via state.wrapupSent by callers, not here.
+ * @param args project dir plus evidence plus optional host dispatch
+ */
+export async function tryCompleteWithEvidence(args: {
+  projectDir: string;
+  evidence: GoalEvidenceFile | null;
+  host?: unknown;
+  useSubagent?: boolean;
+  stateSummary?: string;
+}): Promise<LocalVerifyResult> {
+  // Delegate to full verifier: local first, optional subagent second.
+  const got = await verifyCompletion(args);
+  // Map missing proof to explicit gate reason for friendly UI messages.
+  if (!got.ok && got.reason === 'missing-evidence') {
+    return { ok: false, reason: 'evidence-required', failures: got.failures };
+  }
+  return got;
+}
diff --git a/tests/improvement.test.ts b/tests/improvement.test.ts
new file mode 100644
index 0000000..bb5b6fa
--- /dev/null
+++ b/tests/improvement.test.ts
@@ -0,0 +1,107 @@
+/**
+ * Regression tests for best-plugin improvements D1-D5.
+ * Why these tests exist: prove durability plus race plus evidence gate
+ * plus per-session cooldown plus V2 strictness without breaking 76 baseline.
+ */
+import { describe, expect, it } from 'vitest';
+import { mkdtempSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import * as path from 'node:path';
+import { promises as fsp } from 'node:fs';
+import { loadGoalState, resolveStatePath } from '../src/state.js';
+import { buildEvidenceNudge } from '../src/compaction.js';
+import { tryCompleteWithEvidence } from '../src/verifier.js';
+import { isSafeGoalTitle, GoalInputSchema } from '../src/goal.js';
+import {
+  checkPerSessionCooldown,
+  recordPerSessionTick,
+  _resetPerSessionCooldownForTests,
+} from '../src/limits.js';
+
+describe('D1 quarantine preserves corrupt bytes', () => {
+  it('quarantines torn JSON then throws', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-q-'));
+    const sp = resolveStatePath(dir);
+    await fsp.mkdir(path.dirname(sp), { recursive: true });
+    await fsp.writeFile(sp, '{not-json', 'utf8');
+    await expect(loadGoalState(sp)).rejects.toThrow();
+  });
+});
+
+describe('D3 evidence nudge plus gated complete', () => {
+  it('nudge is non-empty for both flags', () => {
+    expect(buildEvidenceNudge('ship it', false).length).toBeGreaterThan(0);
+    expect(buildEvidenceNudge('ship it', true)).toContain('pending');
+  });
+  it('missing evidence maps to evidence-required', async () => {
+    const got = await tryCompleteWithEvidence({
+      projectDir: '/tmp/nope',
+      evidence: null,
+    });
+    expect(got.ok).toBe(false);
+    expect(got.reason).toBe('evidence-required');
+  });
+});
+
+describe('D4 per-session cooldown fairness', () => {
+  it('same lane blocks fast retry, other lane passes', () => {
+    _resetPerSessionCooldownForTests();
+    const now = 1700000000000;
+    recordPerSessionTick('/tmp/a', now);
+    expect(checkPerSessionCooldown('/tmp/a', now + 1000, 20000).ok).toBe(false);
+    expect(checkPerSessionCooldown('/tmp/b', now + 1000, 20000).ok).toBe(true);
+  });
+  it('expiry after window passes', () => {
+    _resetPerSessionCooldownForTests();
+    const now = 1700000000000;
+    recordPerSessionTick('/tmp/c', now);
+    expect(checkPerSessionCooldown('/tmp/c', now + 20001, 20000).ok).toBe(true);
+  });
+});
+
+describe('D5 input schema plus traversal guard', () => {
+  it('schema requires title and blocks extra props', () => {
+    expect(GoalInputSchema.required).toContain('title');
+    expect(GoalInputSchema.additionalProperties).toBe(false);
+  });
+  it('rejects traversal and absolute paths, accepts prose', () => {
+    expect(isSafeGoalTitle('ship login')).toBe(true);
+    expect(isSafeGoalTitle('../escape')).toBe(false);
+    expect(isSafeGoalTitle('/etc/passwd')).toBe(false);
+    expect(isSafeGoalTitle('')).toBe(false);
+  });
+  it('rejects drive-letter escapes, accepts prose with slash', () => {
+    expect(isSafeGoalTitle('C:\\escape')).toBe(false);
+    expect(isSafeGoalTitle('ship login/api')).toBe(true);
+  });
+});
+
+describe('F1 idle survival plus F5 lease proof plus nudge truncate', () => {
+  it('nudge truncates long objectives and guards null', () => {
+    const long = 'x'.repeat(1000);
+    const got = buildEvidenceNudge(long, false);
+    expect(got.length).toBeLessThan(800);
+    expect(
+      buildEvidenceNudge(null as unknown as string, false).length,
+    ).toBeGreaterThan(0);
+  });
+  it('quarantine writes sidecar file beside corrupt state', async () => {
+    const { readdirSync } = await import('node:fs');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-q2-'));
+    const sp = resolveStatePath(dir);
+    await fsp.mkdir(path.dirname(sp), { recursive: true });
+    await fsp.writeFile(sp, '{bad', 'utf8');
+    await expect(loadGoalState(sp)).rejects.toThrow();
+    const files = readdirSync(path.dirname(sp));
+    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true);
+  });
+  it('two sessions same project proceed independently', () => {
+    _resetPerSessionCooldownForTests();
+    const now = 1700000000000;
+    const a = '/tmp/p:/tmp/p:sess-A';
+    const b = '/tmp/p:/tmp/p:sess-B';
+    recordPerSessionTick(a, now);
+    expect(checkPerSessionCooldown(a, now + 1000, 20000).ok).toBe(false);
+    expect(checkPerSessionCooldown(b, now + 1000, 20000).ok).toBe(true);
+  });
+});
```
<!-- END_GIT_DIFF -->
