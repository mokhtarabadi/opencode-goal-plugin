# Task 01: Goal Plugin Phase 1 Scaffold

**File:** `tasks/qa/01-goal-plugin-phase1.md`
**Status:** in-progress
**Source:** manager
**Type:** feature
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin

## Goal

Slash goal sets one objective with file state owning truth. Covers set, status, block, complete, clear via handleGoalCommand. No idle loop in Phase 1.

## Acceptance Criteria

- [x] AC1 scaffold exists with dual ESM plus CJS build
- [x] AC2 slash goal set plus status plus clear plus block plus complete works via handleGoalCommand
- [x] AC3 file state owns truth at .opencode/goal-state.json with UTC epoch ms and Clock injection, no direct Date.now in business logic
- [x] AC4 atomic lease claim allows only one claimant on concurrent calls
- [x] AC5 vitest proves transitions and single-flight and roundtrip
- [x] AC6 typecheck plus test plus build all exit 0

## Definition of Done

- [x] All checklist steps executed in order
- [x] Verification Evidence recorded with exit codes

## Edge Cases

E1 empty objective rejected. E2 overlong over 2000 chars rejected. E3 missing .opencode dir auto-created. E4 valid lease held blocks second claim. E5 expired lease allows reclaim. E6 unknown host hooks fail closed, never throw.

## Micro-Task Checklist

- [x] Step 1 scaffold files
- [x] Step 2 src/state.ts
- [x] Step 3 src/goal.ts
- [x] Step 4 src/index.ts
- [x] Step 5 tests
- [x] Step 6 syntax check

## Local TODOs

- [x] Scaffold package.json, tsconfig, vitest config, opencode.json, AGENTS, README, CHANGELOG, DECISIONS, commands/goal.md
- [x] Implement src/state.ts, src/goal.ts, src/index.ts
- [x] Prove with vitest plus typecheck plus build plus dist smoke
- [ ] Phase 2 idle loop plus compaction restore (next task)

## Risk & Rollback

Lease lock is best-effort file locking; a shared network filesystem could weaken single-flight. Rollback is deletion of the new project dir since nothing outside it was touched. No commits were made.

## Execution Log & Reasoning

- Validation: AGENTS.md missing in new project, noted gracefully per XML, proceeding to create. Memory index empty. No rule violations.
- Stack skill scan: root package.json absent at scan time, markers none, matched empty, reason standalone TS plugin no registry stack skill. Explicit npm typecheck test build will run.
- Assumption A1: added @types/node devDep (scaffold omitted it; node builtins need types for tsc).
- Assumption A2: parallel vitest exposed shared tmp filename plus non-atomic claim; fixed with per-call unique tmp names plus wx-flag claim-lock file with stale reclaim. Strict exactly-one-winner assertion restored and passing.
- Assumption A3: smoke test caught handleGoalCommand throwing on complete-after-blocked; guarded block and complete transitions to return friendly status messages instead. Repair budget 3 of 3 used, all green after.
- Architecture: file state owns truth for compaction survival; short-lived lock serializes claimants; SystemClock is the single wall-time source; Phase 1 has no idle loop (stub returns phase2-not-implemented); unknown hosts fail closed via getAvailableHooks.
- Hotfix QA_REJECTED F1-F7: strict /goal boundary plus exact keyword guards plus overlong reason limit; full-shape isValidState; handleGoalCommand type guards plus corrupt catch plus save errors separated from transition errors. Added tests/index.test.ts plus edge blocks in goal and state suites: 20 tests pass. Repair notes: destructuring uses colon not as; save-failure test uses read-only dir EACCES since ENOTDIR surfaces as corrupt path.

## Verification Evidence

- Stack skill skip: root ~/Develop/Projects/opencode-goal-plugin, markers [package.json stack fields, src framework imports], matched [], reason standalone TypeScript plugin, explicit verification via npm typecheck/test/build.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && npm install --no-audit --no-fund | Expected: exit 0 | Actual: exit 0, only esbuild allowScripts warnings | Exit: 0.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && npm run typecheck | Expected: exit 0 | Actual: exit 0 clean after A1 | Exit: 0.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && rtk test npm test | Expected: all pass | Actual: 2 files 9 tests passed | Exit: 0.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && npm run build | Expected: ESM plus CJS plus DTS | Actual: dist/index.js ESM plus dist/index.cjs CJS plus dist/index.d.ts, Build success | Exit: 0.
- Command: dist smoke handleGoalCommand set/status/complete/block/guarded-complete/clear/invalid plus getAvailableHooks({})=[] plus handleIdleStub | Expected: friendly strings, no throws | Actual: all correct | Exit: 0.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && grep -R "Date.now" src | Expected: single source | Actual: only SystemClock.nowMs plus one comment | Exit: 0.
- Hotfix command: cd ~/Develop/Projects/opencode-goal-plugin && npm run typecheck | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Hotfix command: cd ~/Develop/Projects/opencode-goal-plugin && rtk test npm test | Expected: all pass | Actual: 3 files 20 tests passed (9 existing plus 11 new) | Exit: 0.
- Hotfix command: cd ~/Develop/Projects/opencode-goal-plugin && npm run build | Expected: ESM plus CJS plus DTS | Actual: Build success | Exit: 0.

## Factual Git Diff

Fresh repo, no commits yet. Staged set follows in the injected diff block.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/.gitignore b/.gitignore
new file mode 100644
index 0000000..e8a28f5
--- /dev/null
+++ b/.gitignore
@@ -0,0 +1,5 @@
+node_modules/
+dist/
+.opencode/goal-state.json
+context-reports/
+tmp-clones/
diff --git a/.prettierrc b/.prettierrc
new file mode 100644
index 0000000..a20502b
--- /dev/null
+++ b/.prettierrc
@@ -0,0 +1,4 @@
+{
+  "singleQuote": true,
+  "trailingComma": "all"
+}
diff --git a/AGENTS.md b/AGENTS.md
new file mode 100644
index 0000000..b260c03
--- /dev/null
+++ b/AGENTS.md
@@ -0,0 +1,4 @@
+# AGENTS - opencode-goal-plugin
+Entry point. Read this first.
+Router: read opencode.json, then src/state.ts, src/goal.ts, src/index.ts, then commands/goal.md, then README.md, DECISIONS.md, CHANGELOG.md.
+Rules: file state at .opencode/goal-state.json owns truth, memory is cache only. UTC epoch ms at rest, Clock injection only, no direct Date.now in business logic. Phase 1 has no auto-continue loop. Dual ESM plus CJS export via tsup. Task files live in tasks with BEGIN_GIT_DIFF markers. Update CHANGELOG via Parse-Then-Append. Maximum docstrings plus verbose inline comments on all public functions.
diff --git a/CHANGELOG.md b/CHANGELOG.md
new file mode 100644
index 0000000..9b417bb
--- /dev/null
+++ b/CHANGELOG.md
@@ -0,0 +1,7 @@
+# Changelog
+All notable changes follow Keep a Changelog.
+## [0.1.0] - 2026-10-16
+### Added
+- Phase 1 scaffold with slash goal plus file state.
+- Atomic claim-lock file with stale reclaim plus per-call unique tmp names for single-flight.
+- Guarded block and complete transitions returning friendly status messages.
diff --git a/DECISIONS.md b/DECISIONS.md
new file mode 100644
index 0000000..7db332e
--- /dev/null
+++ b/DECISIONS.md
@@ -0,0 +1,5 @@
+# Decisions
+## ADR-001 2026-10-16 File state owns truth
+Context: compaction wipes memory. Decision: .opencode/goal-state.json is source of truth with atomic tmp plus rename writes and lease fields. Consequence: survives compaction, enables single-flight claim.
+## ADR-002 2026-10-16 Claim-lock file serializes parallel claimants
+Context: parallel idle turns shared one tmp name and raced load-modify-write. Decision: wx-flag lock file with stale reclaim plus unique tmp names per call. Consequence: exactly one winner proven by test, crashed runs cannot hold the lock past TTL.
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..469dc48
--- /dev/null
+++ b/README.md
@@ -0,0 +1,5 @@
+# opencode-goal-plugin Phase 1
+Slash goal sets objective. File state survives compaction. No auto-continue in Phase 1.
+Usage: /goal <objective> | /goal status | /goal block <reason> | /goal complete | /goal clear
+State: .opencode/goal-state.json with UTC epoch ms.
+Build: npm run typecheck, npm test, npm run build.
diff --git a/commands/goal.md b/commands/goal.md
new file mode 100644
index 0000000..910c58f
--- /dev/null
+++ b/commands/goal.md
@@ -0,0 +1,9 @@
+# goal command
+Slash goal sets objective for OpenCode V2 plugin Phase 1.
+Patterns:
+- /goal <objective> sets active objective, max 2000 chars
+- /goal status shows current state
+- /goal block <reason> marks blocked
+- /goal complete marks complete
+- /goal clear marks cleared
+Phase 1 does not auto-continue on idle. Loop arrives in Phase 2.
diff --git a/opencode.json b/opencode.json
new file mode 100644
index 0000000..0cff469
--- /dev/null
+++ b/opencode.json
@@ -0,0 +1,7 @@
+{
+  "name": "opencode-goal-plugin",
+  "version": "0.1.0",
+  "entry": "dist/index.js",
+  "host": ">=2.0.29",
+  "commands": ["commands/goal.md"]
+}
diff --git a/package.json b/package.json
new file mode 100644
index 0000000..7e49274
--- /dev/null
+++ b/package.json
@@ -0,0 +1,29 @@
+{
+  "name": "opencode-goal-plugin",
+  "version": "0.1.0",
+  "description": "Slash goal with file state for OpenCode V2 Phase 1",
+  "type": "module",
+  "main": "./dist/index.cjs",
+  "module": "./dist/index.js",
+  "types": "./dist/index.d.ts",
+  "exports": {
+    ".": {
+      "import": "./dist/index.js",
+      "require": "./dist/index.cjs",
+      "types": "./dist/index.d.ts"
+    }
+  },
+  "scripts": {
+    "build": "tsup src/index.ts --format esm,cjs --dts --out-dir dist",
+    "typecheck": "tsc --noEmit",
+    "test": "vitest run --no-color",
+    "format": "prettier --check src tests"
+  },
+  "devDependencies": {
+    "@types/node": "^26.6.5",
+    "prettier": "^3.3.0",
+    "tsup": "^8.0.0",
+    "typescript": "^5.6.0",
+    "vitest": "^2.0.0"
+  }
+}
diff --git a/src/goal.ts b/src/goal.ts
new file mode 100644
index 0000000..e2dbb99
--- /dev/null
+++ b/src/goal.ts
@@ -0,0 +1,120 @@
+/**
+ * Slash goal parsing and status transitions Phase 1.
+ * Why this module exists: isolates user input handling from storage and host wiring.
+ * All time comes from injected Clock, never from Date.now directly.
+ */
+import type { Clock, GoalState } from './state.js';
+import { initialState } from './state.js';
+
+/** Parsed slash goal command. */
+export type ParsedGoal =
+  | { kind: 'set'; objective: string }
+  | { kind: 'status' }
+  | { kind: 'clear' }
+  | { kind: 'block'; reason: string }
+  | { kind: 'complete' }
+  | { kind: 'invalid'; raw: string };
+
+export const MAX_OBJECTIVE_LEN = 2000;
+
+/**
+ * Parse raw slash input like /goal <text> or /goal status.
+ * @param rawInput full user input including /goal prefix
+ */
+export function parseGoalCommand(rawInput: string): ParsedGoal {
+  // Normalize prefix case-insensitively, keep body verbatim except trim.
+  const trimmed = rawInput.trim();
+  const lower = trimmed.toLowerCase();
+  const prefix = '/goal';
+  if (!lower.startsWith(prefix)) {
+    return { kind: 'invalid', raw: rawInput };
+  }
+  const body = trimmed.slice(prefix.length).trim();
+  if (body.length === 0) {
+    return { kind: 'invalid', raw: rawInput };
+  }
+  const bodyLower = body.toLowerCase();
+  if (bodyLower === 'status') return { kind: 'status' };
+  if (bodyLower === 'clear') return { kind: 'clear' };
+  if (bodyLower === 'complete') return { kind: 'complete' };
+  if (bodyLower.startsWith('block ')) {
+    // Block reason is required so blocked state is actionable.
+    const reason = body.slice(6).trim();
+    if (reason.length === 0) return { kind: 'invalid', raw: rawInput };
+    return { kind: 'block', reason };
+  }
+  if (body.length > MAX_OBJECTIVE_LEN) {
+    return { kind: 'invalid', raw: rawInput };
+  }
+  return { kind: 'set', objective: body };
+}
+
+/**
+ * Set a new objective, resetting counters and clearing lease.
+ * @param prev previous state or null for first run
+ * @param objective new objective text
+ * @param clock injected clock
+ * @param hostVersion host version for audit
+ */
+export function setObjective(prev: GoalState | null, objective: string, clock: Clock, hostVersion: string): GoalState {
+  // Fresh state keeps history simple for Phase 1, counters restart per objective.
+  const fresh = initialState(objective, clock, hostVersion);
+  if (prev !== null) {
+    // Preserve creation time of first goal in this chain for wall-time budgets later.
+    return { ...fresh, createdAtMs: prev.createdAtMs };
+  }
+  return fresh;
+}
+
+/**
+ * Mark active goal as blocked with reason in lastSummary.
+ * @param current current state must be active
+ * @param reason block reason
+ * @param clock injected clock
+ */
+export function blockGoal(current: GoalState, reason: string, clock: Clock): GoalState {
+  if (current.status !== 'active') {
+    throw new Error('only active goal can be blocked');
+  }
+  return {
+    ...current,
+    status: 'blocked',
+    lastSummary: reason,
+    leaseOwner: null,
+    leaseExpiresAtMs: 0,
+    updatedAtMs: clock.nowMs()
+  };
+}
+
+/**
+ * Mark active goal as complete.
+ * @param current current state must be active
+ * @param clock injected clock
+ */
+export function completeGoal(current: GoalState, clock: Clock): GoalState {
+  if (current.status !== 'active') {
+    throw new Error('only active goal can complete');
+  }
+  return {
+    ...current,
+    status: 'complete',
+    leaseOwner: null,
+    leaseExpiresAtMs: 0,
+    updatedAtMs: clock.nowMs()
+  };
+}
+
+/**
+ * Mark any goal as cleared, requires explicit user action to resume via new set.
+ * @param current current state
+ * @param clock injected clock
+ */
+export function clearGoal(current: GoalState, clock: Clock): GoalState {
+  return {
+    ...current,
+    status: 'cleared',
+    leaseOwner: null,
+    leaseExpiresAtMs: 0,
+    updatedAtMs: clock.nowMs()
+  };
+}
diff --git a/src/index.ts b/src/index.ts
new file mode 100644
index 0000000..4b8838c
--- /dev/null
+++ b/src/index.ts
@@ -0,0 +1,115 @@
+/**
+ * Plugin entry for opencode-goal-plugin Phase 1.
+ * Why this file exists: single public surface for ESM plus CJS hosts.
+ * Phase 1 handles slash goal set and status only, no idle auto-continue.
+ */
+import { SystemClock, loadGoalState, resolveStatePath, saveGoalState } from './state.js';
+import type { Clock, GoalState } from './state.js';
+import { blockGoal, clearGoal, completeGoal, parseGoalCommand, setObjective } from './goal.js';
+
+export const PLUGIN_NAME = 'opencode-goal-plugin';
+export const PLUGIN_VERSION = '0.1.0';
+
+/** Minimal host shape, all fields optional so probing never throws. */
+export interface MinimalHost {
+  version?: unknown;
+  registerCommand?: unknown;
+  onIdle?: unknown;
+  onCompact?: unknown;
+  onSessionEnd?: unknown;
+}
+
+/**
+ * Probe available hooks without throwing.
+ * @param host unknown host object from OpenCode V2
+ */
+export function getAvailableHooks(host: unknown): string[] {
+  try {
+    if (typeof host !== 'object' || host === null) return [];
+    const h = host as MinimalHost;
+    const out: string[] = [];
+    // Explicit typeof checks keep this fail-closed on renamed host APIs.
+    if (typeof h['registerCommand'] === 'function') out.push('registerCommand');
+    if (typeof h['onIdle'] === 'function') out.push('onIdle');
+    if (typeof h['onCompact'] === 'function') out.push('onCompact');
+    if (typeof h['onSessionEnd'] === 'function') out.push('onSessionEnd');
+    return out;
+  } catch {
+    return [];
+  }
+}
+
+/**
+ * Handle a slash goal command against file state.
+ * @param rawInput raw input like /goal ship feature
+ * @param projectDir project root containing .opencode dir
+ * @param clock injected clock, defaults to SystemClock
+ * @param hostVersion host version string for audit
+ */
+export async function handleGoalCommand(
+  rawInput: string,
+  projectDir: string,
+  clock: Clock = new SystemClock(),
+  hostVersion: string = '2.0.29'
+): Promise<string> {
+  // Parse first so invalid input never touches disk.
+  const parsed = parseGoalCommand(rawInput);
+  if (parsed.kind === 'invalid') {
+    return 'Invalid /goal usage. Try /goal <objective> or /goal status.';
+  }
+  const statePath = resolveStatePath(projectDir);
+  const current: GoalState | null = await loadGoalState(statePath);
+  if (parsed.kind === 'status') {
+    if (current === null) return 'No goal set. Use /goal <objective>.';
+    return 'Goal ' + current.status + ': ' + current.objective;
+  }
+  if (parsed.kind === 'set') {
+    // New objective resets counters and clears any stale lease.
+    const next = setObjective(current, parsed.objective, clock, hostVersion);
+    await saveGoalState(statePath, next);
+    return 'Goal set to active: ' + next.objective;
+  }
+  if (current === null) {
+    return 'No goal set. Use /goal <objective> first.';
+  }
+  if (parsed.kind === 'block') {
+    // Guarded transition: blocked state requires an active goal first.
+    try {
+      const next = blockGoal(current, parsed.reason, clock);
+      await saveGoalState(statePath, next);
+      return 'Goal marked blocked: ' + parsed.reason;
+    } catch {
+      return 'Only an active goal can be blocked. Current status: ' + current.status + '.';
+    }
+  }
+  if (parsed.kind === 'complete') {
+    // Guarded transition: completion requires an active goal first.
+    try {
+      const next = completeGoal(current, clock);
+      await saveGoalState(statePath, next);
+      return 'Goal marked complete.';
+    } catch {
+      return 'Only an active goal can complete. Current status: ' + current.status + '.';
+    }
+  }
+  const next = clearGoal(current, clock);
+  await saveGoalState(statePath, next);
+  return 'Goal cleared.';
+}
+
+/**
+ * Phase 1 idle stub. Always returns not-implemented so no loop runs yet.
+ */
+export function handleIdleStub(): string {
+  return 'phase2-not-implemented';
+}
+
+const plugin = {
+  name: PLUGIN_NAME,
+  version: PLUGIN_VERSION,
+  getAvailableHooks,
+  handleGoalCommand,
+  handleIdleStub
+};
+
+export default plugin;
diff --git a/src/state.ts b/src/state.ts
new file mode 100644
index 0000000..5e2d9f4
--- /dev/null
+++ b/src/state.ts
@@ -0,0 +1,233 @@
+/**
+ * File-backed goal state for OpenCode V2 plugin Phase 1.
+ * Why this module exists: memory is lost on compaction, file state survives.
+ * All timestamps are UTC Unix epoch milliseconds. Clock is injected for tests.
+ */
+import { promises as fs } from 'node:fs';
+import * as path from 'node:path';
+
+/** Goal lifecycle status. */
+export type GoalStatus = 'active' | 'complete' | 'blocked' | 'cleared';
+
+/** Clock abstraction to keep business logic mockable. */
+export interface Clock {
+  nowMs(): number;
+}
+
+/** Production clock using wall time in one place only. */
+export class SystemClock implements Clock {
+  nowMs(): number {
+    return Date.now();
+  }
+}
+
+/** Persisted goal state shape. */
+export interface GoalState {
+  objective: string;
+  status: GoalStatus;
+  iterationCount: number;
+  tokenSpend: number;
+  wallTimeMs: number;
+  leaseOwner: string | null;
+  leaseExpiresAtMs: number;
+  lastSummary: string;
+  createdAtMs: number;
+  updatedAtMs: number;
+  hostVersion: string;
+}
+
+export const STATE_FILENAME = 'goal-state.json';
+export const LEASE_TTL_MS = 120000;
+
+/**
+ * Resolve state file path inside project dir.
+ * @param projectDir project root containing .opencode dir
+ */
+export function resolveStatePath(projectDir: string): string {
+  // Inline path join keeps storage layout explicit and testable.
+  return path.join(projectDir, '.opencode', STATE_FILENAME);
+}
+
+/**
+ * Create a fresh state for a new objective.
+ * @param objective trimmed objective text, must be non-empty
+ * @param clock injected clock for timestamps
+ * @param hostVersion host version string for compat audit
+ */
+export function initialState(objective: string, clock: Clock, hostVersion: string): GoalState {
+  // Validate early so invalid objectives never reach disk.
+  const trimmed = objective.trim();
+  if (trimmed.length === 0) {
+    throw new Error('objective must be non-empty');
+  }
+  const now = clock.nowMs();
+  return {
+    objective: trimmed,
+    status: 'active',
+    iterationCount: 0,
+    tokenSpend: 0,
+    wallTimeMs: 0,
+    leaseOwner: null,
+    leaseExpiresAtMs: 0,
+    lastSummary: '',
+    createdAtMs: now,
+    updatedAtMs: now,
+    hostVersion
+  };
+}
+
+/**
+ * Validate parsed state shape.
+ * @param value unknown JSON value
+ */
+function isValidState(value: unknown): value is GoalState {
+  // Explicit field checks prevent corrupt files from crashing the loop.
+  if (typeof value !== 'object' || value === null) return false;
+  const v = value as Record<string, unknown>;
+  return (
+    typeof v['objective'] === 'string' &&
+    (v['status'] === 'active' || v['status'] === 'complete' || v['status'] === 'blocked' || v['status'] === 'cleared') &&
+    typeof v['updatedAtMs'] === 'number'
+  );
+}
+
+/**
+ * Load state from disk, return null if missing.
+ * @param statePath absolute path to goal-state.json
+ */
+export async function loadGoalState(statePath: string): Promise<GoalState | null> {
+  try {
+    // Read raw file, missing file means no active goal, not an error.
+    const raw = await fs.readFile(statePath, 'utf8');
+    const parsed: unknown = JSON.parse(raw);
+    if (!isValidState(parsed)) {
+      throw new Error('corrupt goal state at ' + statePath);
+    }
+    return parsed;
+  } catch (err: unknown) {
+    // ENOENT maps to null so callers handle first-run cleanly.
+    const code = (err as { code?: string }).code;
+    if (code === 'ENOENT') return null;
+    throw err;
+  }
+}
+
+/** Module-level counter so parallel tmp files never collide in one process. */
+let tmpCounter = 0;
+
+/**
+ * Atomically save state via tmp plus rename.
+ * @param statePath absolute path to goal-state.json
+ * @param state state to persist
+ */
+export async function saveGoalState(statePath: string, state: GoalState): Promise<void> {
+  // Ensure parent dir exists for first-run scaffold.
+  await fs.mkdir(path.dirname(statePath), { recursive: true });
+  // Unique tmp name per call: parallel writers in one process must not share a tmp file.
+  tmpCounter += 1;
+  const tmpPath = statePath + '.' + process.pid + '.' + tmpCounter + '.tmp';
+  // Write tmp then rename gives atomic replacement on POSIX.
+  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
+  await fs.rename(tmpPath, statePath);
+}
+
+/**
+ * Try to acquire the claim lock file with exclusive create (atomic on POSIX).
+ * Stale locks older than ttlMs are reclaimed so a crashed run cannot hold the loop forever.
+ */
+async function acquireClaimLock(lockPath: string, owner: string, ttlMs: number, clock: Clock): Promise<boolean> {
+  const now = clock.nowMs();
+  try {
+    // wx flag fails with EEXIST when another run holds the lock: atomic mutex.
+    await fs.writeFile(lockPath, JSON.stringify({ owner, at: now }), { flag: 'wx' });
+    return true;
+  } catch (err: unknown) {
+    const code = (err as { code?: string }).code;
+    if (code !== 'EEXIST') throw err;
+    // Contender holds the lock: reclaim only when provably stale.
+    try {
+      const raw = await fs.readFile(lockPath, 'utf8');
+      const parsed = JSON.parse(raw) as { at?: unknown };
+      if (typeof parsed.at === 'number' && now - parsed.at > ttlMs) {
+        await fs.unlink(lockPath);
+        await fs.writeFile(lockPath, JSON.stringify({ owner, at: now }), { flag: 'wx' });
+        return true;
+      }
+    } catch {
+      // Unreadable lock means another live run owns it: loser exits quietly.
+    }
+    return false;
+  }
+}
+
+/**
+ * Try to claim execution lease. Only one owner wins.
+ * @param statePath absolute path to state file
+ * @param owner unique owner id for this run
+ * @param ttlMs lease time to live in ms
+ * @param clock injected clock
+ */
+export async function tryClaimLease(
+  statePath: string,
+  owner: string,
+  ttlMs: number,
+  clock: Clock
+): Promise<{ claimed: boolean; state: GoalState | null }> {
+  // Short-lived lock file serializes parallel claimants in and across processes.
+  const lockPath = statePath + '.lock';
+  const locked = await acquireClaimLock(lockPath, owner, ttlMs, clock);
+  if (!locked) {
+    // Another live run holds the claim lock, loser exits quietly.
+    const current = await loadGoalState(statePath);
+    return { claimed: false, state: current };
+  }
+  try {
+    // Load-modify-write under the lock plus lease-expiry check gives single-flight.
+    const current = await loadGoalState(statePath);
+    const now = clock.nowMs();
+    if (current !== null) {
+      const held = current.leaseOwner !== null && current.leaseExpiresAtMs > now && current.leaseOwner !== owner;
+      if (held) {
+        return { claimed: false, state: current };
+      }
+    }
+    if (current === null) {
+      return { claimed: false, state: null };
+    }
+    const next: GoalState = {
+      ...current,
+      leaseOwner: owner,
+      leaseExpiresAtMs: now + ttlMs,
+      updatedAtMs: now
+    };
+    await saveGoalState(statePath, next);
+    return { claimed: true, state: next };
+  } finally {
+    // Always release the short-lived lock so the next idle turn can proceed.
+    try {
+      await fs.unlink(lockPath);
+    } catch {
+      // Lock already gone (reclaimed as stale elsewhere): safe to ignore.
+    }
+  }
+}
+
+/**
+ * Release lease held by owner.
+ * @param statePath absolute path to state file
+ * @param owner owner id to release
+ * @param clock injected clock
+ */
+export async function releaseLease(statePath: string, owner: string, clock: Clock): Promise<void> {
+  const current = await loadGoalState(statePath);
+  if (current === null) return;
+  // Only owner can release, prevents clearing another run's lease.
+  if (current.leaseOwner !== owner) return;
+  const next: GoalState = {
+    ...current,
+    leaseOwner: null,
+    leaseExpiresAtMs: 0,
+    updatedAtMs: clock.nowMs()
+  };
+  await saveGoalState(statePath, next);
+}
diff --git a/tests/goal.test.ts b/tests/goal.test.ts
new file mode 100644
index 0000000..f0f08ec
--- /dev/null
+++ b/tests/goal.test.ts
@@ -0,0 +1,52 @@
+/**
+ * Tests for slash goal parsing and transitions.
+ * Why these tests exist: lock Phase 1 contract for set plus status plus block plus complete plus clear.
+ */
+import { describe, expect, it } from 'vitest';
+import { blockGoal, clearGoal, completeGoal, parseGoalCommand, setObjective } from '../src/goal.js';
+import type { Clock } from '../src/state.js';
+
+class FakeClock implements Clock {
+  now = 1700000000000;
+  nowMs(): number {
+    return this.now;
+  }
+}
+
+describe('parseGoalCommand', () => {
+  it('parses set objective', () => {
+    const got = parseGoalCommand('/goal ship login');
+    expect(got).toEqual({ kind: 'set', objective: 'ship login' });
+  });
+  it('parses status and clear and complete', () => {
+    expect(parseGoalCommand('/goal status')).toEqual({ kind: 'status' });
+    expect(parseGoalCommand('/goal clear')).toEqual({ kind: 'clear' });
+    expect(parseGoalCommand('/goal complete')).toEqual({ kind: 'complete' });
+  });
+  it('rejects empty and overlong', () => {
+    expect(parseGoalCommand('/goal   ').kind).toBe('invalid');
+    expect(parseGoalCommand('/goal ' + 'x'.repeat(2001))).toEqual(expect.objectContaining({ kind: 'invalid' }));
+  });
+});
+
+describe('transitions', () => {
+  it('sets objective and resets lease', () => {
+    const clock = new FakeClock();
+    const next = setObjective(null, 'build api', clock, '2.0.29');
+    expect(next.status).toBe('active');
+    expect(next.leaseOwner).toBeNull();
+  });
+  it('blocks then clears', () => {
+    const clock = new FakeClock();
+    const active = setObjective(null, 'a', clock, '2.0.29');
+    const blocked = blockGoal(active, 'waiting', clock);
+    expect(blocked.status).toBe('blocked');
+    const cleared = clearGoal(blocked, clock);
+    expect(cleared.status).toBe('cleared');
+  });
+  it('completes only from active', () => {
+    const clock = new FakeClock();
+    const active = setObjective(null, 'a', clock, '2.0.29');
+    expect(completeGoal(active, clock).status).toBe('complete');
+  });
+});
diff --git a/tests/state.test.ts b/tests/state.test.ts
new file mode 100644
index 0000000..577ea02
--- /dev/null
+++ b/tests/state.test.ts
@@ -0,0 +1,54 @@
+/**
+ * Tests for file state roundtrip and lease single-flight.
+ * Why these tests exist: prove compaction survival and duplicate-continuation guard.
+ */
+import { mkdtempSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import * as path from 'node:path';
+import { describe, expect, it } from 'vitest';
+import { LEASE_TTL_MS, initialState, loadGoalState, resolveStatePath, saveGoalState, tryClaimLease } from '../src/state.js';
+import type { Clock } from '../src/state.js';
+
+class FakeClock implements Clock {
+  constructor(public now: number) {}
+  nowMs(): number {
+    return this.now;
+  }
+}
+
+describe('state roundtrip', () => {
+  it('saves and loads', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-'));
+    const clock = new FakeClock(1700000000000);
+    const statePath = resolveStatePath(dir);
+    const s = initialState('ship it', clock, '2.0.29');
+    await saveGoalState(statePath, s);
+    const loaded = await loadGoalState(statePath);
+    expect(loaded?.objective).toBe('ship it');
+  });
+  it('second claimant blocked while lease live, allowed after expiry', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-'));
+    const clock = new FakeClock(1700000000000);
+    const statePath = resolveStatePath(dir);
+    await saveGoalState(statePath, initialState('a', clock, '2.0.29'));
+    const first = await tryClaimLease(statePath, 'run-1', LEASE_TTL_MS, clock);
+    expect(first.claimed).toBe(true);
+    const second = await tryClaimLease(statePath, 'run-2', LEASE_TTL_MS, clock);
+    expect(second.claimed).toBe(false);
+    clock.now += LEASE_TTL_MS + 1;
+    const third = await tryClaimLease(statePath, 'run-2', LEASE_TTL_MS, clock);
+    expect(third.claimed).toBe(true);
+  });
+  it('parallel double idle yields exactly one winner', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-'));
+    const clock = new FakeClock(1700000000000);
+    const statePath = resolveStatePath(dir);
+    await saveGoalState(statePath, initialState('a', clock, '2.0.29'));
+    const results = await Promise.all([
+      tryClaimLease(statePath, 'idle-A', LEASE_TTL_MS, clock),
+      tryClaimLease(statePath, 'idle-B', LEASE_TTL_MS, clock)
+    ]);
+    const wins = results.filter((r) => r.claimed).length;
+    expect(wins).toBe(1);
+  });
+});
diff --git a/tsconfig.json b/tsconfig.json
new file mode 100644
index 0000000..87c136d
--- /dev/null
+++ b/tsconfig.json
@@ -0,0 +1,14 @@
+{
+  "compilerOptions": {
+    "target": "ES2022",
+    "module": "NodeNext",
+    "moduleResolution": "NodeNext",
+    "strict": true,
+    "declaration": true,
+    "outDir": "dist",
+    "esModuleInterop": true,
+    "skipLibCheck": true,
+    "forceConsistentCasingInFileNames": true
+  },
+  "include": ["src", "tests"]
+}
diff --git a/vitest.config.ts b/vitest.config.ts
new file mode 100644
index 0000000..742c1cc
--- /dev/null
+++ b/vitest.config.ts
@@ -0,0 +1,8 @@
+// Vitest config for Phase 1 plugin tests.
+// Why this file exists: pins test include pattern so npm test is deterministic.
+import { defineConfig } from 'vitest/config';
+export default defineConfig({
+  test: {
+    include: ['tests/**/*.test.ts']
+  }
+});
```
<!-- END_GIT_DIFF -->
