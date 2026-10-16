# Task 02: Goal Plugin Phase 2 Idle Loop

**File:** `tasks/qa/02-goal-plugin-phase2.md`
**Status:** in-progress
**Source:** manager
**Type:** feature
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Mode:** Night Work locked (autopilot). Advance blanket approval: Do it dont stop.

## Goal

Add session idle auto-continue: while a goal is active and within limits, the plugin sends one continuation prompt per idle tick until complete, blocked, cleared, or limits stop it.

## Acceptance Criteria

- [x] A1 src/loop.ts plus src/limits.ts exist and compile
- [x] A2 GoalState has lastTurnAtMs plus lastContinuedMessageId with migration defaults
- [x] A3 shouldContinue enforces active plus stop-file plus human-message plus cooldown plus max-turns plus wall-time
- [x] A4 handleSessionIdle sends exactly one prompt per idle, skips correctly, stops correctly
- [x] A5 registerIdleHandler probes onIdle and fails closed when missing
- [x] A6 loop plus limits tests pass alongside existing 20 tests
- [x] A7 typecheck plus test plus build exit 0
- [x] A8 no Date.now in src except SystemClock

## Definition of Done

- [x] Checklist steps executed in order
- [x] Verification Evidence recorded with exit codes

## Edge Cases

E1 parallel double idle yields exactly one send. E2 stale lease allows reclaim. E3 first turn bypasses cooldown. E4 empty message id never triggers human skip. E5 STOP_GOAL forces stop. E6 Phase 1 files load via normalize defaults. E7 send failure clears lease and stops without increment.

## Micro-Task Checklist

- [x] Step 1 state.ts migration fields (merged, lock kept)
- [x] Step 2 src/limits.ts
- [x] Step 3 src/loop.ts
- [x] Step 4 src/index.ts idle wiring
- [x] Step 5 tests/loop.test.ts plus tests/limits.test.ts
- [x] Step 6 typecheck test build

## Local TODOs

- [ ] Implement behind Brain plan, tests first
- [ ] Typecheck plus full tests plus build plus smoke
- [ ] QA plus review via Brain, then Phase 3

## Risk & Rollback

Tight loop risk: cooldown plus single-flight lease plus max turns. Rollback is revert of Phase 2 commit; Phase 1 stays intact.

## Execution Log & Reasoning

- Validation: AGENTS.md read. No rule violations in XML. Memory index empty.
- Merge note A-P2-1: XML state.ts would regress hotfix hardening (shared tmp name, no claim lock). Merged instead: kept wx lock plus unique tmp plus strict base validation, added optional new fields plus normalizeState plus new initialState defaults. Existing 20 tests stay green.
- Fix note: normalizeState spread triggered TS2783 dead defaults; rewrote with nullish fallback. All green after.
- Hotfix QA_REJECTED F1-F6: tryClaim catch to claim-failed, null ctx and deps and opts guards, send result validation, fail-closed stop check, post-send cooldown timestamp. 9 edge tests added. 40 of 40 pass.
- Hotfix round 2 F1-F5: wx lock proven by real-file concurrency test (exactly one winner, stable over 3 runs), clock plus limits shape guards, safeSpend, stop fail-closed on non-ENOENT. 46 of 46 pass.
- Review: Code Reviewer technical approval PO_REVIEW_PENDING (S1-S4, I1 version drift fixed by syncing package and manifest to 0.2.0, I2-I3 deferred to publish prep). Closure batched at Night Work end per plan.
- Stack skill skip: standalone TypeScript plugin, no registry stack skill. Explicit npm verification runs.

## Verification Evidence

- Stack skill skip: root ~/Develop/Projects/opencode-goal-plugin, markers [package.json stack fields, src framework imports], matched [], reason standalone TypeScript plugin.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && npm run typecheck | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && rtk test npm test | Expected: all pass | Actual: 5 files 31 tests passed (20 existing plus 11 new) | Exit: 0.
- Hotfix command: cd ~/Develop/Projects/opencode-goal-plugin && npm run typecheck | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Hotfix round 2 command: cd ~/Develop/Projects/opencode-goal-plugin && rtk test npm test | Expected: all pass | Actual: 5 files 46 tests passed (40 existing plus 6 new) | Exit: 0.
- Hotfix round 2 command: file-claim concurrency focused runs x3 | Expected: stable one winner | Actual: 2 passed 4 skipped x3, stable | Exit: 0.
- Hotfix command: cd ~/Develop/Projects/opencode-goal-plugin && npm run build | Expected: ESM plus CJS plus DTS | Actual: Build success | Exit: 0.
- Hotfix command: grep -R "Date.now" src | Expected: single source | Actual: only SystemClock.nowMs plus one comment | Exit: 0.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/AGENTS.md b/AGENTS.md
index b260c03..cf7fdb6 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -1,4 +1,4 @@
 # AGENTS - opencode-goal-plugin
 Entry point. Read this first.
 Router: read opencode.json, then src/state.ts, src/goal.ts, src/index.ts, then commands/goal.md, then README.md, DECISIONS.md, CHANGELOG.md.
-Rules: file state at .opencode/goal-state.json owns truth, memory is cache only. UTC epoch ms at rest, Clock injection only, no direct Date.now in business logic. Phase 1 has no auto-continue loop. Dual ESM plus CJS export via tsup. Task files live in tasks with BEGIN_GIT_DIFF markers. Update CHANGELOG via Parse-Then-Append. Maximum docstrings plus verbose inline comments on all public functions.
+Rules: file state at .opencode/goal-state.json owns truth, memory is cache only. UTC epoch ms at rest, Clock injection only, no direct Date.now in business logic. Phase 2 adds idle auto-continue via src/loop.ts with single-flight plus cooldown plus budgets. Dual ESM plus CJS export via tsup. Task files live in tasks with BEGIN_GIT_DIFF markers. Update CHANGELOG via Parse-Then-Append. Maximum docstrings plus verbose inline comments on all public functions.
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 8a48c08..303f411 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,5 +1,13 @@
 # Changelog
 All notable changes follow Keep a Changelog.
+## [0.2.0] - 2026-10-16
+### Added
+- Idle auto-continue loop with single send per tick plus cooldown plus max turns plus wall time.
+- STOP_GOAL kill switch plus human-message yield plus stale lease reclaim.
+### Fixed
+- Idle tick never throws: claim catch plus ctx and opts guards plus send validation plus fail-closed stop check.
+- Atomic file claim proven: wx lock plus real-file concurrency test with exactly one winner.
+- Clock plus limits shape guards plus safe spend plus fail-closed stop file on non-ENOENT.
 ## [0.1.0] - 2026-10-16
 ### Added
 - Phase 1 scaffold with slash goal plus file state.
diff --git a/DECISIONS.md b/DECISIONS.md
index 7db332e..7a7edb8 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -3,3 +3,5 @@
 Context: compaction wipes memory. Decision: .opencode/goal-state.json is source of truth with atomic tmp plus rename writes and lease fields. Consequence: survives compaction, enables single-flight claim.
 ## ADR-002 2026-10-16 Claim-lock file serializes parallel claimants
 Context: parallel idle turns shared one tmp name and raced load-modify-write. Decision: wx-flag lock file with stale reclaim plus unique tmp names per call. Consequence: exactly one winner proven by test, crashed runs cannot hold the lock past TTL.
+## ADR-003 2026-10-16 Idle single-flight plus cooldown defaults
+Context: idle ticks can re-fire while a turn runs. Decision: in-memory idleInFlight plus file lease plus 20s cooldown plus 30 turns plus 2h wall budget plus STOP_GOAL file. Consequence: one send per tick, human messages yield, runaways stop.
diff --git a/README.md b/README.md
index 469dc48..b1d53af 100644
--- a/README.md
+++ b/README.md
@@ -1,5 +1,6 @@
-# opencode-goal-plugin Phase 1
-Slash goal sets objective. File state survives compaction. No auto-continue in Phase 1.
+# opencode-goal-plugin Phase 2
+Slash goal sets objective. File state survives compaction. Idle auto-continue sends one prompt per idle tick while the goal stays active and within limits.
 Usage: /goal <objective> | /goal status | /goal block <reason> | /goal complete | /goal clear
+Kill switch: create `.opencode/STOP_GOAL` to stop the loop immediately.
 State: .opencode/goal-state.json with UTC epoch ms.
 Build: npm run typecheck, npm test, npm run build.
diff --git a/src/index.ts b/src/index.ts
index 35d7786..c1c4dfa 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,14 +1,19 @@
 /**
- * Plugin entry for opencode-goal-plugin Phase 1.
+ * Plugin entry Phase 2.
  * Why this file exists: single public surface for ESM plus CJS hosts.
- * Phase 1 handles slash goal set and status only, no idle auto-continue.
+ * Slash goal keeps Phase 1 guarded behavior, idle auto-continue is the new opt-in wiring.
  */
-import { SystemClock, loadGoalState, resolveStatePath, saveGoalState } from './state.js';
+import * as path from 'node:path';
+import { promises as fs } from 'node:fs';
+import { SystemClock, loadGoalState, resolveStatePath, saveGoalState, tryClaimLease } from './state.js';
 import type { Clock, GoalState } from './state.js';
 import { blockGoal, clearGoal, completeGoal, parseGoalCommand, setObjective } from './goal.js';
+import { handleSessionIdle } from './loop.js';
+import { DEFAULT_LIMITS, STOP_FILE_NAME } from './limits.js';
+import type { Limits } from './limits.js';
 
 export const PLUGIN_NAME = 'opencode-goal-plugin';
-export const PLUGIN_VERSION = '0.1.0';
+export const PLUGIN_VERSION = '0.2.0';
 
 /** Minimal host shape, all fields optional so probing never throws. */
 export interface MinimalHost {
@@ -41,11 +46,9 @@ export function getAvailableHooks(host: unknown): string[] {
 
 /**
  * Handle a slash goal command against file state.
- * Every failure returns a friendly string: invalid input, bad directory,
- * corrupt state, wrong-status transitions, and save failures each report
- * their own cause instead of throwing or masking each other.
+ * Every failure returns a friendly string, never throws.
  * @param rawInput raw input like /goal ship feature
- * @param projectDir project root containing .opencode dir
+ * @param projectDir project root containing the .opencode dir
  * @param clock injected clock, defaults to SystemClock
  * @param hostVersion host version string for audit
  */
@@ -55,7 +58,7 @@ export async function handleGoalCommand(
   clock: Clock = new SystemClock(),
   hostVersion: string = '2.0.29'
 ): Promise<string> {
-  // Type guards first: a misbehaving host must get a message, never a TypeError.
+  // Type guards first: a misbehaving host gets a message, never a TypeError.
   if (typeof rawInput !== 'string') {
     return 'Invalid /goal usage. Try /goal <objective> or /goal status.';
   }
@@ -131,18 +134,106 @@ export async function handleGoalCommand(
 }
 
 /**
- * Phase 1 idle stub. Always returns not-implemented so no loop runs yet.
+ * Phase 1 stub kept for compatibility.
  */
 export function handleIdleStub(): string {
   return 'phase2-not-implemented';
 }
 
+/** Options for idle registration. */
+export interface RegisterIdleOptions {
+  projectDir: string;
+  getLastMessageId: () => string | null;
+  sendPrompt: (prompt: string) => Promise<{ messageId: string; tokenSpend?: number }>;
+  clock?: Clock;
+  limits?: Limits;
+  ownerId?: string;
+}
+
+/**
+ * Build a stop-file checker for one project dir.
+ * @param projectDir project root containing the .opencode dir
+ */
+export function defaultHasStopFile(projectDir: string): () => Promise<boolean> {
+  return async () => {
+    try {
+      await fs.access(path.join(projectDir, '.opencode', STOP_FILE_NAME));
+      return true;
+    } catch (e: unknown) {
+      // ENOENT means no kill switch. Any other error fails closed: the
+      // idle handler maps the throw to stop-check-failed instead of ignoring STOP_GOAL.
+      const code = (e as { code?: string }).code;
+      if (code === 'ENOENT') return false;
+      throw e;
+    }
+  };
+}
+
+/**
+ * Register the idle handler only when the host supports onIdle, fail closed otherwise.
+ * @param host unknown host object from OpenCode V2
+ * @param opts project dir plus host callbacks
+ */
+export function registerIdleHandler(host: unknown, opts: RegisterIdleOptions): { registered: boolean; reason: string } {
+  // Opts guards first: bad input gets a reason string, never a TypeError.
+  if (opts === null || typeof opts !== 'object') {
+    return { registered: false, reason: 'invalid-opts' };
+  }
+  if (typeof opts.projectDir !== 'string' || opts.projectDir.trim().length === 0) {
+    return { registered: false, reason: 'invalid-opts' };
+  }
+  if (typeof opts.getLastMessageId !== 'function' || typeof opts.sendPrompt !== 'function') {
+    return { registered: false, reason: 'invalid-opts' };
+  }
+  // Probe first so unknown hosts get a reason string, never an exception.
+  const hooks = getAvailableHooks(host);
+  if (!hooks.includes('onIdle')) {
+    return { registered: false, reason: 'idle-hook-unavailable' };
+  }
+  const h = host as { onIdle?: unknown };
+  if (typeof h.onIdle !== 'function') {
+    return { registered: false, reason: 'idle-hook-unavailable' };
+  }
+  const clock = opts.clock ?? new SystemClock();
+  const limits = opts.limits ?? DEFAULT_LIMITS;
+  // Random owner suffix separates this process from other loop runners.
+  const ownerId = opts.ownerId ?? ('idle-' + String(process.pid) + '-' + String(Math.floor(Math.random() * 1000000)));
+  if (typeof ownerId !== 'string' || ownerId.length === 0) {
+    return { registered: false, reason: 'invalid-opts' };
+  }
+  const hasStopFile = defaultHasStopFile(opts.projectDir);
+  const cb = async (): Promise<void> => {
+    // Safe callback: host callbacks must never throw into the host loop.
+    let lastId: string | null = null;
+    try {
+      lastId = opts.getLastMessageId() ?? null;
+    } catch {
+      lastId = null;
+    }
+    const ctx = { projectDir: opts.projectDir, lastMessageId: lastId };
+    const deps = { clock, limits, ownerId, loadState: loadGoalState, saveState: saveGoalState, tryClaim: tryClaimLease, sendPrompt: opts.sendPrompt, hasStopFile };
+    try {
+      await handleSessionIdle(ctx, deps);
+    } catch {
+      // handleSessionIdle already maps its own failures; this is a final net.
+    }
+  };
+  try {
+    (h.onIdle as (cb: () => Promise<void>) => void)(cb);
+    return { registered: true, reason: 'ok' };
+  } catch {
+    return { registered: false, reason: 'register-failed' };
+  }
+}
+
 const plugin = {
   name: PLUGIN_NAME,
   version: PLUGIN_VERSION,
   getAvailableHooks,
   handleGoalCommand,
-  handleIdleStub
+  handleIdleStub,
+  registerIdleHandler,
+  defaultHasStopFile
 };
 
 export default plugin;
diff --git a/src/limits.ts b/src/limits.ts
new file mode 100644
index 0000000..55f0ffa
--- /dev/null
+++ b/src/limits.ts
@@ -0,0 +1,44 @@
+/**
+ * Budget limits Phase 2.
+ * Why this module exists: bounds auto-continue so the idle loop cannot run forever.
+ * All values are plain numbers, no wall-time reads here.
+ */
+import type { GoalState } from './state.js';
+
+/** Tunable budget for one goal. */
+export interface Limits {
+  /** Minimum ms between auto turns, stops tight idle loops. */
+  minDelayMs: number;
+  /** Maximum auto turns per goal, then the loop stops. */
+  maxTurns: number;
+  /** Maximum wall ms per goal measured from createdAtMs. */
+  maxWallMs: number;
+}
+
+/** Defaults from the approved Phase 2 plan. */
+export const DEFAULT_LIMITS: Limits = {
+  minDelayMs: 20000,
+  maxTurns: 30,
+  maxWallMs: 7200000
+};
+
+/** Kill-switch filename inside the .opencode dir. Presence stops the loop. */
+export const STOP_FILE_NAME = 'STOP_GOAL';
+
+/**
+ * Check turn and wall budgets.
+ * @param state current goal state
+ * @param nowMs injected now in epoch ms
+ * @param limits active limits
+ */
+export function checkBudget(state: GoalState, nowMs: number, limits: Limits): { ok: boolean; reason: string } {
+  // Turn budget binds first: each sent continuation costs one turn.
+  if (state.iterationCount >= limits.maxTurns) {
+    return { ok: false, reason: 'max-turns' };
+  }
+  // Wall budget binds long sessions even when turns stay few.
+  if (nowMs - state.createdAtMs >= limits.maxWallMs) {
+    return { ok: false, reason: 'wall-time' };
+  }
+  return { ok: true, reason: 'ok' };
+}
diff --git a/src/loop.ts b/src/loop.ts
new file mode 100644
index 0000000..c4d122d
--- /dev/null
+++ b/src/loop.ts
@@ -0,0 +1,263 @@
+/**
+ * Idle auto-continue loop Phase 2.
+ * Why this module exists: decides exactly one safe continuation per idle tick.
+ * In-memory flag stops same-process reentry, file lease stops cross-process duplicates.
+ */
+import { LEASE_TTL_MS, resolveStatePath } from './state.js';
+import type { Clock, GoalState } from './state.js';
+import { checkBudget } from './limits.js';
+import type { Limits } from './limits.js';
+
+/** In-process reentry guard for parallel idle ticks. */
+let idleInFlight = false;
+
+/**
+ * Read guard for diagnostics.
+ */
+export function isIdleInFlight(): boolean {
+  return idleInFlight;
+}
+
+/**
+ * Reset guard for tests only.
+ */
+export function _resetIdleInFlightForTests(): void {
+  idleInFlight = false;
+}
+
+/** Idle tick context supplied by the host wiring. */
+export interface IdleContext {
+  /** Project root containing the .opencode dir. */
+  projectDir: string;
+  /** Last observed session message id, null when unknown. */
+  lastMessageId: string | null;
+}
+
+/** Injected collaborators so tests never touch disk or model. */
+export interface IdleDeps {
+  clock: Clock;
+  limits: Limits;
+  ownerId: string;
+  loadState: (p: string) => Promise<GoalState | null>;
+  saveState: (p: string, s: GoalState) => Promise<void>;
+  tryClaim: (p: string, owner: string, ttl: number, c: Clock) => Promise<{ claimed: boolean; state: GoalState | null }>;
+  sendPrompt: (prompt: string) => Promise<{ messageId: string; tokenSpend?: number }>;
+  hasStopFile: () => Promise<boolean>;
+}
+
+/** Idle tick outcome. */
+export interface IdleDecision {
+  decision: 'sent' | 'skipped' | 'stopped';
+  reason: string;
+  messageId?: string;
+}
+
+/**
+ * Coerce token spend to a safe number: non-numeric input counts as zero
+ * so a bad host result cannot poison the budget sum.
+ * @param v unknown spend value
+ */
+function safeSpend(v: unknown): number {
+  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
+}
+
+/**
+ * Pure gate for auto-continue.
+ * @param state current state or null when no goal file exists
+ * @param nowMs injected now in epoch ms
+ * @param lastMessageId last observed session message id
+ * @param limits active limits
+ * @param opts stopRequested is true when STOP_GOAL exists
+ */
+export function shouldContinue(
+  state: GoalState | null,
+  nowMs: number,
+  lastMessageId: string | null,
+  limits: Limits,
+  opts?: { stopRequested?: boolean }
+): { ok: boolean; reason: string } {
+  if (state === null) return { ok: false, reason: 'no-state' };
+  if (state.status !== 'active') return { ok: false, reason: 'stopped-' + state.status };
+  if (opts?.stopRequested === true) return { ok: false, reason: 'stop-file' };
+  // A message id that moved past our last continuation means the human spoke: yield.
+  if (state.lastContinuedMessageId !== '' && lastMessageId !== null && lastMessageId !== state.lastContinuedMessageId) {
+    return { ok: false, reason: 'human-message' };
+  }
+  const budget = checkBudget(state, nowMs, limits);
+  if (!budget.ok) return budget;
+  // First turn (lastTurnAtMs 0) always bypasses cooldown so goals start promptly.
+  if (state.lastTurnAtMs !== 0 && nowMs - state.lastTurnAtMs < limits.minDelayMs) {
+    return { ok: false, reason: 'cooldown' };
+  }
+  return { ok: true, reason: 'ok' };
+}
+
+/**
+ * Build one continuation prompt restating objective plus turn plus stop verbs.
+ * @param state active goal state
+ */
+export function buildContinuationPrompt(state: GoalState): string {
+  const summary = state.lastSummary !== '' ? state.lastSummary : 'none yet';
+  return (
+    'Continue goal: "' + state.objective + '"\n' +
+    'Status: ' + state.status + ' | Turn: ' + String(state.iterationCount + 1) + ' | Last: ' + summary + '\n' +
+    'Take exactly one concrete next step toward the objective.\n' +
+    'If done call /goal complete. If stuck call /goal block <reason>. To cancel call /goal clear.\n' +
+    'Do not repeat questions. Keep output concise.'
+  );
+}
+
+/**
+ * Apply a finished turn to state.
+ * @param state current state
+ * @param result message id plus optional spend plus elapsed plus summary
+ * @param clock injected clock
+ */
+export function recordTurnResult(
+  state: GoalState,
+  result: { messageId: string; tokenSpend?: number; elapsedMs?: number; summary?: string },
+  clock: Clock
+): GoalState {
+  const now = clock.nowMs();
+  return {
+    ...state,
+    iterationCount: state.iterationCount + 1,
+    lastTurnAtMs: now,
+    lastContinuedMessageId: result.messageId,
+    tokenSpend: state.tokenSpend + safeSpend(result.tokenSpend),
+    wallTimeMs: state.wallTimeMs + (result.elapsedMs ?? 0),
+    lastSummary: result.summary ?? state.lastSummary,
+    updatedAtMs: now
+  };
+}
+
+/**
+ * Handle one session idle tick: load plus gate plus claim plus send plus save.
+ * Lock release is best-effort: the file lease TTL reclaims crashed turns.
+ * @param ctx project dir plus last message id
+ * @param deps injected clock plus storage plus sender
+ */
+export async function handleSessionIdle(ctx: IdleContext, deps: IdleDeps): Promise<IdleDecision> {
+  // Same-process reentry exits first so parallel ticks send exactly once.
+  if (idleInFlight) {
+    return { decision: 'skipped', reason: 'idle-inflight' };
+  }
+  // Null guards: a host with an empty payload gets a reason, never a TypeError.
+  if (ctx === null || typeof ctx !== 'object') {
+    return { decision: 'stopped', reason: 'invalid-context' };
+  }
+  if (deps === null || typeof deps !== 'object') {
+    return { decision: 'stopped', reason: 'invalid-deps' };
+  }
+  if (typeof ctx.projectDir !== 'string' || ctx.projectDir.trim().length === 0) {
+    return { decision: 'stopped', reason: 'invalid-project-dir' };
+  }
+  if (typeof deps.loadState !== 'function' || typeof deps.saveState !== 'function') {
+    return { decision: 'stopped', reason: 'invalid-deps' };
+  }
+  if (typeof deps.tryClaim !== 'function' || typeof deps.sendPrompt !== 'function') {
+    return { decision: 'stopped', reason: 'invalid-deps' };
+  }
+  if (typeof deps.hasStopFile !== 'function') {
+    return { decision: 'stopped', reason: 'invalid-deps' };
+  }
+  // Clock check: a missing clock would throw TypeError on nowMs.
+  if (deps.clock === null || typeof deps.clock !== 'object' || typeof deps.clock.nowMs !== 'function') {
+    return { decision: 'stopped', reason: 'invalid-deps' };
+  }
+  if (deps.limits === null || typeof deps.limits !== 'object') {
+    return { decision: 'stopped', reason: 'invalid-limits' };
+  }
+  // Shape check: missing numeric fields would silently bypass budgets.
+  if (
+    typeof deps.limits.minDelayMs !== 'number' ||
+    typeof deps.limits.maxTurns !== 'number' ||
+    typeof deps.limits.maxWallMs !== 'number'
+  ) {
+    return { decision: 'stopped', reason: 'invalid-limits' };
+  }
+  if (typeof deps.ownerId !== 'string' || deps.ownerId.length === 0) {
+    return { decision: 'stopped', reason: 'invalid-owner' };
+  }
+  idleInFlight = true;
+  try {
+    const statePath = resolveStatePath(ctx.projectDir);
+    let current: GoalState | null;
+    try {
+      current = await deps.loadState(statePath);
+    } catch {
+      return { decision: 'stopped', reason: 'corrupt-state' };
+    }
+    const now = deps.clock.nowMs();
+    let stopRequested = false;
+    try {
+      stopRequested = await deps.hasStopFile();
+    } catch {
+      // Fail closed: a filesystem error must not silently ignore STOP_GOAL.
+      return { decision: 'stopped', reason: 'stop-check-failed' };
+    }
+    const gate = shouldContinue(current, now, ctx.lastMessageId ?? null, deps.limits, { stopRequested });
+    if (!gate.ok) {
+      // No-goal and finished goals stop the loop; cooldown and contention only skip one tick.
+      const terminal =
+        gate.reason === 'no-state' ||
+        gate.reason.startsWith('stopped-') ||
+        gate.reason === 'max-turns' ||
+        gate.reason === 'wall-time' ||
+        gate.reason === 'stop-file';
+      return { decision: terminal ? 'stopped' : 'skipped', reason: gate.reason };
+    }
+    let claimed: { claimed: boolean; state: GoalState | null };
+    try {
+      claimed = await deps.tryClaim(statePath, deps.ownerId, LEASE_TTL_MS, deps.clock);
+    } catch {
+      // Lock I/O failure stops this tick instead of escaping to the host.
+      return { decision: 'stopped', reason: 'claim-failed' };
+    }
+    if (!claimed.claimed || claimed.state === null) {
+      return { decision: 'skipped', reason: 'lease-held' };
+    }
+    const prompt = buildContinuationPrompt(claimed.state);
+    let sent: { messageId: string; tokenSpend?: number };
+    try {
+      sent = await deps.sendPrompt(prompt);
+    } catch {
+      // Send failure clears our lease so the next tick can retry, then stops this tick.
+      try {
+        await deps.saveState(statePath, { ...claimed.state, leaseOwner: null, leaseExpiresAtMs: 0, updatedAtMs: deps.clock.nowMs() });
+      } catch {
+        // Cleanup failure keeps the original send failure as the reported reason.
+      }
+      return { decision: 'stopped', reason: 'send-failed' };
+    }
+    // Validate the send result: an empty id would poison human-message yield next tick.
+    if (typeof sent !== 'object' || sent === null || typeof sent.messageId !== 'string' || sent.messageId.length === 0) {
+      try {
+        await deps.saveState(statePath, { ...claimed.state, leaseOwner: null, leaseExpiresAtMs: 0, updatedAtMs: deps.clock.nowMs() });
+      } catch {
+        // Same cleanup path as a thrown send failure.
+      }
+      return { decision: 'stopped', reason: 'send-failed' };
+    }
+    // Post-send timestamp: slow sends must not shorten the real cooldown.
+    const afterSend = deps.clock.nowMs();
+    const next: GoalState = {
+      ...claimed.state,
+      iterationCount: claimed.state.iterationCount + 1,
+      lastTurnAtMs: afterSend,
+      lastContinuedMessageId: sent.messageId,
+      tokenSpend: claimed.state.tokenSpend + safeSpend(sent.tokenSpend),
+      updatedAtMs: afterSend,
+      leaseOwner: null,
+      leaseExpiresAtMs: 0
+    };
+    try {
+      await deps.saveState(statePath, next);
+    } catch {
+      return { decision: 'stopped', reason: 'save-failed' };
+    }
+    return { decision: 'sent', reason: 'ok', messageId: sent.messageId };
+  } finally {
+    idleInFlight = false;
+  }
+}
diff --git a/src/state.ts b/src/state.ts
index 751fce6..90eb192 100644
--- a/src/state.ts
+++ b/src/state.ts
@@ -21,7 +21,7 @@ export class SystemClock implements Clock {
   }
 }
 
-/** Persisted goal state shape. */
+/** Persisted goal state shape. Phase 2 adds turn tracking for the idle loop. */
 export interface GoalState {
   objective: string;
   status: GoalStatus;
@@ -34,6 +34,8 @@ export interface GoalState {
   createdAtMs: number;
   updatedAtMs: number;
   hostVersion: string;
+  lastTurnAtMs: number;
+  lastContinuedMessageId: string;
 }
 
 export const STATE_FILENAME = 'goal-state.json';
@@ -72,7 +74,9 @@ export function initialState(objective: string, clock: Clock, hostVersion: strin
     lastSummary: '',
     createdAtMs: now,
     updatedAtMs: now,
-    hostVersion
+    hostVersion,
+    lastTurnAtMs: 0,
+    lastContinuedMessageId: ''
   };
 }
 
@@ -97,9 +101,25 @@ function isValidState(value: unknown): value is GoalState {
   if (typeof v['createdAtMs'] !== 'number') return false;
   if (typeof v['updatedAtMs'] !== 'number') return false;
   if (typeof v['hostVersion'] !== 'string') return false;
+  // Phase 2 fields stay optional so Phase 1 files load, then normalize fills them.
+  if ('lastTurnAtMs' in v && typeof v['lastTurnAtMs'] !== 'number') return false;
+  if ('lastContinuedMessageId' in v && typeof v['lastContinuedMessageId'] !== 'string') return false;
   return true;
 }
 
+/**
+ * Fill Phase 2 defaults for Phase 1 files missing new fields.
+ * @param input validated state possibly missing new fields
+ */
+export function normalizeState(input: GoalState): GoalState {
+  // Nullish fallback fills runtime-undefined fields from Phase 1 files.
+  return {
+    ...input,
+    lastTurnAtMs: input.lastTurnAtMs ?? 0,
+    lastContinuedMessageId: input.lastContinuedMessageId ?? ''
+  };
+}
+
 /**
  * Load state from disk, return null if missing.
  * @param statePath absolute path to goal-state.json
@@ -112,7 +132,8 @@ export async function loadGoalState(statePath: string): Promise<GoalState | null
     if (!isValidState(parsed)) {
       throw new Error('corrupt goal state at ' + statePath);
     }
-    return parsed;
+    // Normalize so Phase 1 files gain Phase 2 turn-tracking defaults.
+    return normalizeState(parsed);
   } catch (err: unknown) {
     // ENOENT maps to null so callers handle first-run cleanly.
     const code = (err as { code?: string }).code;
diff --git a/tests/limits.test.ts b/tests/limits.test.ts
new file mode 100644
index 0000000..80f70b3
--- /dev/null
+++ b/tests/limits.test.ts
@@ -0,0 +1,33 @@
+/**
+ * Limits tests Phase 2.
+ * Why these tests exist: lock budget stops for the idle loop.
+ */
+import { describe, expect, it } from 'vitest';
+import { DEFAULT_LIMITS, checkBudget } from '../src/limits.js';
+import { initialState } from '../src/state.js';
+import type { Clock } from '../src/state.js';
+
+/** Fixed clock for budget math. */
+class FakeClock implements Clock {
+  nowMs(): number {
+    return 1700000000000;
+  }
+}
+
+describe('checkBudget', () => {
+  it('ok within budgets', () => {
+    const c = new FakeClock();
+    const s = initialState('a', c, '2.0.29');
+    expect(checkBudget(s, c.nowMs(), DEFAULT_LIMITS).ok).toBe(true);
+  });
+  it('max turns stops', () => {
+    const c = new FakeClock();
+    const s = { ...initialState('a', c, '2.0.29'), iterationCount: 30 };
+    expect(checkBudget(s, c.nowMs(), DEFAULT_LIMITS).reason).toBe('max-turns');
+  });
+  it('wall time stops', () => {
+    const c = new FakeClock();
+    const s = { ...initialState('a', c, '2.0.29'), createdAtMs: c.nowMs() - 7200000 - 1 };
+    expect(checkBudget(s, c.nowMs(), DEFAULT_LIMITS).reason).toBe('wall-time');
+  });
+});
diff --git a/tests/loop.test.ts b/tests/loop.test.ts
new file mode 100644
index 0000000..d8eb446
--- /dev/null
+++ b/tests/loop.test.ts
@@ -0,0 +1,250 @@
+/**
+ * Loop behavior tests Phase 2.
+ * Why these tests exist: lock single send plus skip rules plus stop rules.
+ */
+import { describe, expect, it, beforeEach } from 'vitest';
+import { _resetIdleInFlightForTests, buildContinuationPrompt, handleSessionIdle, shouldContinue } from '../src/loop.js';
+import type { IdleDeps } from '../src/loop.js';
+import { DEFAULT_LIMITS } from '../src/limits.js';
+import { initialState } from '../src/state.js';
+import type { Clock, GoalState } from '../src/state.js';
+
+/** Fixed clock plus mutable now for cooldown travel. */
+class FakeClock implements Clock {
+  constructor(public now: number) {}
+  nowMs(): number {
+    return this.now;
+  }
+}
+
+/** Fresh active state with optional overrides. */
+function makeActive(clock: FakeClock, over: Partial<GoalState> = {}): GoalState {
+  return { ...initialState('ship login', clock, '2.0.29'), ...over };
+}
+
+/** In-memory deps with controllable store and captured prompts. */
+function makeDeps(store: { state: GoalState | null }, clock: FakeClock, sent: string[], extra: Partial<IdleDeps> = {}): IdleDeps {
+  return {
+    clock,
+    limits: DEFAULT_LIMITS,
+    ownerId: 'owner-A',
+    loadState: async () => store.state,
+    saveState: async (_p, s) => {
+      store.state = s;
+    },
+    tryClaim: async (_p, owner, ttl, c) => {
+      // Mirror of the file lease: live foreign lease blocks, else claim wins.
+      const now = c.nowMs();
+      if (store.state === null) return { claimed: false, state: null };
+      const held = store.state.leaseOwner !== null && store.state.leaseExpiresAtMs > now && store.state.leaseOwner !== owner;
+      if (held) return { claimed: false, state: store.state };
+      store.state = { ...store.state, leaseOwner: owner, leaseExpiresAtMs: now + ttl };
+      return { claimed: true, state: store.state };
+    },
+    sendPrompt: async (prompt: string) => {
+      sent.push(prompt);
+      return { messageId: 'msg-' + String(sent.length), tokenSpend: 10 };
+    },
+    hasStopFile: async () => false,
+    ...extra
+  };
+}
+
+beforeEach(() => {
+  _resetIdleInFlightForTests();
+});
+
+describe('shouldContinue', () => {
+  it('stops on complete blocked cleared', () => {
+    const c = new FakeClock(1700000000000);
+    for (const s of ['complete', 'blocked', 'cleared'] as const) {
+      const got = shouldContinue(makeActive(c, { status: s }), c.now, null, DEFAULT_LIMITS);
+      expect(got.ok).toBe(false);
+    }
+  });
+  it('skips cooldown and human message', () => {
+    const c = new FakeClock(1700000000000);
+    const cool = makeActive(c, { lastTurnAtMs: c.now - 5000 });
+    expect(shouldContinue(cool, c.now, null, DEFAULT_LIMITS).reason).toBe('cooldown');
+    const human = makeActive(c, { lastTurnAtMs: 0, lastContinuedMessageId: 'msg-1' });
+    expect(shouldContinue(human, c.now, 'msg-human-2', DEFAULT_LIMITS).reason).toBe('human-message');
+  });
+  it('stops on max turns and wall time', () => {
+    const c = new FakeClock(1700000000000);
+    const maxed = makeActive(c, { iterationCount: 30 });
+    expect(shouldContinue(maxed, c.now, null, DEFAULT_LIMITS).reason).toBe('max-turns');
+    const old = makeActive(c, { createdAtMs: c.now - 7200000 - 1 });
+    expect(shouldContinue(old, c.now, null, DEFAULT_LIMITS).reason).toBe('wall-time');
+  });
+  it('prompt contains objective and stop verbs', () => {
+    const c = new FakeClock(1700000000000);
+    const p = buildContinuationPrompt(makeActive(c));
+    expect(p).toContain('ship login');
+    expect(p).toContain('complete');
+    expect(p).toContain('block');
+  });
+});
+
+describe('handleSessionIdle', () => {
+  it('sends once and updates state', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c, { lastTurnAtMs: 0 }) as GoalState | null };
+    const sent: string[] = [];
+    const got = await handleSessionIdle({ projectDir: '/tmp/p1', lastMessageId: null }, makeDeps(store, c, sent));
+    expect(got.decision).toBe('sent');
+    expect(sent.length).toBe(1);
+    expect(store.state?.iterationCount).toBe(1);
+    expect(store.state?.lastContinuedMessageId).toBe('msg-1');
+  });
+  it('parallel double idle yields exactly one send', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c, { lastTurnAtMs: 0 }) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent);
+    const ctx = { projectDir: '/tmp/p2', lastMessageId: null };
+    const out = await Promise.all([handleSessionIdle(ctx, deps), handleSessionIdle(ctx, deps)]);
+    const wins = out.filter((r) => r.decision === 'sent').length;
+    expect(wins).toBe(1);
+    expect(sent.length).toBe(1);
+  });
+  it('skips when lease held', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c, { leaseOwner: 'other', leaseExpiresAtMs: c.now + 60000 }) as GoalState | null };
+    const sent: string[] = [];
+    const got = await handleSessionIdle({ projectDir: '/tmp/p3', lastMessageId: null }, makeDeps(store, c, sent));
+    expect(got.decision).toBe('skipped');
+    expect(got.reason).toBe('lease-held');
+    expect(sent.length).toBe(0);
+  });
+  it('stops on stop file', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { hasStopFile: async () => true });
+    const got = await handleSessionIdle({ projectDir: '/tmp/p4', lastMessageId: null }, deps);
+    expect(got.decision).toBe('stopped');
+    expect(got.reason).toBe('stop-file');
+  });
+});
+
+describe('handleSessionIdle edges', () => {
+  it('maps load throw to corrupt-state', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { loadState: async () => { throw new Error('bad json'); } });
+    const got = await handleSessionIdle({ projectDir: '/tmp/e1', lastMessageId: null }, deps);
+    expect(got.decision).toBe('stopped');
+    expect(got.reason).toBe('corrupt-state');
+  });
+  it('maps tryClaim throw to claim-failed', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { tryClaim: async () => { throw new Error('lock io'); } });
+    const got = await handleSessionIdle({ projectDir: '/tmp/e2', lastMessageId: null }, deps);
+    expect(got.reason).toBe('claim-failed');
+  });
+  it('maps send throw to send-failed and clears lease', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { sendPrompt: async () => { throw new Error('model down'); } });
+    const got = await handleSessionIdle({ projectDir: '/tmp/e3', lastMessageId: null }, deps);
+    expect(got.reason).toBe('send-failed');
+    expect(store.state?.leaseOwner).toBeNull();
+  });
+  it('rejects empty messageId as send-failed', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { sendPrompt: async () => ({ messageId: '', tokenSpend: 0 }) });
+    const got = await handleSessionIdle({ projectDir: '/tmp/e4', lastMessageId: null }, deps);
+    expect(got.reason).toBe('send-failed');
+    expect(store.state?.iterationCount).toBe(0);
+  });
+  it('handles null ctx without throw', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const got = await handleSessionIdle(null as unknown as { projectDir: string; lastMessageId: string | null }, makeDeps(store, c, sent));
+    expect(got.reason).toBe('invalid-context');
+  });
+  it('maps stop check throw to stop-check-failed', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { hasStopFile: async () => { throw new Error('fs perm'); } });
+    const got = await handleSessionIdle({ projectDir: '/tmp/e6', lastMessageId: null }, deps);
+    expect(got.reason).toBe('stop-check-failed');
+  });
+  it('uses post-send time for cooldown', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c, { lastTurnAtMs: 0 }) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { sendPrompt: async (p: string) => { c.now += 5000; sent.push(p); return { messageId: 'msg-9', tokenSpend: 1 }; } });
+    await handleSessionIdle({ projectDir: '/tmp/e7', lastMessageId: null }, deps);
+    expect(store.state?.lastTurnAtMs).toBe(1700000005000);
+  });
+  it('loads Phase 1 file via normalize defaults', async () => {
+    const { normalizeState } = await import('../src/state.js');
+    const c = new FakeClock(1700000000000);
+    const base = makeActive(c);
+    const legacy = { ...base } as unknown as Record<string, unknown>;
+    delete legacy['lastTurnAtMs'];
+    delete legacy['lastContinuedMessageId'];
+    const fixed = normalizeState(legacy as unknown as GoalState);
+    expect(fixed.lastTurnAtMs).toBe(0);
+    expect(fixed.lastContinuedMessageId).toBe('');
+  });
+  it('rejects bad register opts without throw', async () => {
+    const { registerIdleHandler } = await import('../src/index.js');
+    expect(registerIdleHandler({}, null as unknown as never).registered).toBe(false);
+    expect(registerIdleHandler({}, { projectDir: '', getLastMessageId: () => null, sendPrompt: async () => ({ messageId: 'x' }) }).registered).toBe(false);
+  });
+});
+
+describe('handleSessionIdle hardening', () => {
+  it('returns invalid-deps for missing clock', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent) as unknown as Record<string, unknown>;
+    delete deps['clock'];
+    const got = await handleSessionIdle({ projectDir: '/tmp/h1', lastMessageId: null }, deps as unknown as IdleDeps);
+    expect(got.reason).toBe('invalid-deps');
+  });
+  it('returns invalid-limits for malformed limits', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { limits: { minDelayMs: 1 } as unknown as typeof DEFAULT_LIMITS });
+    const got = await handleSessionIdle({ projectDir: '/tmp/h2', lastMessageId: null }, deps);
+    expect(got.reason).toBe('invalid-limits');
+  });
+  it('maps save after send throw to save-failed', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { saveState: async () => { throw new Error('disk full'); } });
+    const first = await handleSessionIdle({ projectDir: '/tmp/h3', lastMessageId: null }, deps);
+    expect(first.reason).toBe('save-failed');
+  });
+  it('treats non numeric spend as zero', async () => {
+    const c = new FakeClock(1700000000000);
+    const store = { state: makeActive(c) as GoalState | null };
+    const sent: string[] = [];
+    const deps = makeDeps(store, c, sent, { sendPrompt: async (p: string) => { sent.push(p); return { messageId: 'msg-good', tokenSpend: '10' as unknown as number }; } });
+    const got = await handleSessionIdle({ projectDir: '/tmp/h4', lastMessageId: null }, deps);
+    expect(got.decision).toBe('sent');
+    expect(store.state?.tokenSpend).toBe(0);
+  });
+  it('registers success with fake host', async () => {
+    const { registerIdleHandler } = await import('../src/index.js');
+    let cb: (() => Promise<void>) | null = null;
+    const host = { onIdle: (f: () => Promise<void>) => { cb = f; } };
+    const out = registerIdleHandler(host, { projectDir: '/tmp/h5', getLastMessageId: () => null, sendPrompt: async () => ({ messageId: 'm1' }), ownerId: 't-owner' });
+    expect(out.registered).toBe(true);
+    expect(typeof cb).toBe('function');
+  });
+});
diff --git a/tests/state.test.ts b/tests/state.test.ts
index 69eb4f0..2a67853 100644
--- a/tests/state.test.ts
+++ b/tests/state.test.ts
@@ -72,3 +72,20 @@ describe('state validation edges', () => {
     await expect(loadGoalState(sp)).rejects.toThrow();
   });
 });
+
+describe('file claim concurrency', () => {
+  it('parallel file claims yield exactly one winner', async () => {
+    // Real-file proof for the wx claim lock: two processes worth of
+    // concurrency collapse to one winner (QA F1, ADR-002).
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-claim-'));
+    const sp = resolveStatePath(dir);
+    const clock = new FakeClock(1700000000000);
+    await saveGoalState(sp, initialState('claim race', clock, '2.0.29'));
+    const out = await Promise.all([
+      tryClaimLease(sp, 'file-A', LEASE_TTL_MS, clock),
+      tryClaimLease(sp, 'file-B', LEASE_TTL_MS, clock)
+    ]);
+    const wins = out.filter((r) => r.claimed).length;
+    expect(wins).toBe(1);
+  });
+});
```
<!-- END_GIT_DIFF -->
