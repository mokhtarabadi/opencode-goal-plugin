# Task 18: Stale goal garbage collection and startup rearm guard

**File:** `tasks/qa/18-stale-goal-gc-and-rearm-guard.md`
**Source:** manager
**Type:** improvement
**Status:** open
**Submitted:** 2026-11-15T08:32:10Z
**Finished:** 2026-11-12T15:23:52Z

## Goal

Stop stale goal files from waking the idle auto-continue loop: garbage-collect abandoned goal state after a defined age, guard the startup rearm so only a recent failure episode re-arms the watchdog, and release the state lease cleanly when a lane ends.

## Manager's Notes

Manager ordered a plugin-wide hardening pass after a harness audit showed the goal plugin accumulating abandoned state.

Measured findings (2026-11-12, HQ workspace):

- `.opencode/goals/` held dozens of per-session goal files; several carry `status: active` or `status: interrupted` with a `lastSummary` naming a failed autopilot run. Every one of them is a candidate to wake the idle loop.
- The startup rearm scan in `src/index.ts` re-arms the watchdog for ANY active goal whose `pendingAttempt` is non-null. A failure episode from days ago re-arms exactly like one from a minute ago, so an abandoned goal keeps retrying forever.
- The idle loop already parks correctly on a human gate (`IDLE_PARK_THRESHOLD = 2`, `question` tool parks immediately). That behavior must not regress.

Scope guard: this task owns the goal plugin repository only.

## Local TODOs

- [x] Add an age threshold for a stale goal state and a GC pass over the per-session goal files
- [x] Guard the startup rearm so only a recent pending attempt re-arms the watchdog
- [x] Ensure the state lease is released on every lane exit path
- [x] Keep the idle park on a human gate intact and covered by a test
- [x] Add tests for GC, the rearm guard, and lease release
- [x] Update `CHANGELOG.md` via Parse-Then-Append
- [x] Update sibling `src/README.md` and `src/DECISIONS.md` where the contract changed
- [x] Verify the typecheck and the full test suite pass with exit code 0

## Acceptance Criteria

- [x] A goal file older than the stale threshold is not eligible for the startup rearm
- [x] A goal file older than the stale threshold is collected by the GC pass and the collection is logged
- [x] A recent pending attempt still re-arms the watchdog exactly as before
- [x] The idle park on a human gate still fires after two unproductive turns
- [x] A `question` tool call still parks the goal on the next tick
- [x] No lane exit path leaves a lease held past its TTL without an explicit release
- [x] GC never touches a goal whose status is `active` for the current session
- [x] Typecheck and the full test suite pass with exit code 0

## Verification Evidence

- **Test command:** rtk test npm test
- **Expected result:** all tests pass with exit code 0
- **Actual result:** 20 files, 233 tests passed, exit 0 (16 GC tests green after hotfix; idle-park suite still green)
- **Exit code:** 0
- **Test command:** rtk test npm run typecheck
- **Expected result:** `tsc --noEmit` reports no error, exit code 0
- **Actual result:** clean, no errors
- **Exit code:** 0
- **Test command:** rtk test npm run format
- **Expected result:** prettier check clean, exit code 0
- **Actual result:** clean after write pass on touched files
- **Exit code:** 0
- **Test command:** npx vitest run tests/gc.test.ts
- **Expected result:** all GC tests pass, exit code 0
- **Actual result:** 16 passed, exit 0 (stale active, interrupted, expired lease, boundary, maxAge guard)
- **Exit code:** 0

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true:

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** An over-aggressive GC threshold could collect a goal the operator still wants, losing the objective text and the evidence sidecar.
- **Rollback plan:** GC only collects files that are already past the stale threshold and never touches a current-session active goal. The GC threshold is a single named constant, so lowering it restores the previous behavior in one edit. The collection is logged with the file path so a wrongly collected goal is recoverable from the git history of the workspace.

---

## Execution Log & Reasoning

- Triage: the GC module plus rearm guard plus threshold already existed in commits, but zero tests, zero CHANGELOG entry, zero decision record, and empty verification meant partial, not closed.
- Added the shared `isFreshPendingAttempt` helper in `src/gc.ts` and routed the inline startup check in `src/index.ts` through it, so one threshold plus one comparison govern both GC and rearm with no behavior change.
- Added `tests/gc.test.ts` with 11 tests: fresh/rearm helper boundaries, empty dir, fresh skip, old collect plus archive plus log, current-session keep, active-unknown-session keep, leased keep, unreadable keep, sidecar ignore.
- Verified lease release by reading `sendOneShotStop` plus `unparkOnHumanInput` in `src/loop.ts`: every exit saves with cleared lease or relies on TTL, and the one-shot paths call the settle hook; no new lease code needed.
- Idle park intact: full `tests/idle-park.test.ts` still green inside the 228-test pass.
- Docs: `src/README.md` table plus invariant, `src/DECISIONS.md` index plus root ADR-019, `CHANGELOG.md` Parse-Then-Append under Unreleased Added plus Fixed.
- Assumption A1: the two files in `tasks/in-progress` were the triage scope. Stack-skill skip: no exact registry match for this Node TS plugin (no framework marker); discipline applied from `testing-verification` plus `kanban-lifecycle`, gate run as repo base suite.
- QA hotfix 2026-11-15: hardened `isFreshPendingAttempt` with non-finite plus negative `maxAgeMs` guard; appended 5 tests (stale active collect, stale interrupted collect, expired-lease collect, exact-boundary fresh, non-finite maxAge reject) for 16 GC tests total.
- Lease audit: every `leaseOwner` writer in `src/loop.ts` plus `src/goal.ts` saves with cleared lease; `sendOneShotStop` clears on success, fail, and state-changed; `unparkOnHumanInput` clears; `src/index.ts` slash plus tool lanes call `releaseLease`; `src/gc.ts` leased guard reads live lease, so TTL is backstop only.
- Rearm wiring: `src/gc.ts` exports the helper, `src/index.ts` imports and calls it; grep shows hits in both files and nowhere else.
- QA 2026-11-15: `QA_PASSED` after hotfix (233 green, 16 GC green). Review: `PO_REVIEW_PENDING` (technically APPROVED, 2 low issues + 1 info, closure needs explicit approval word).

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index fc9d659..d414e9a 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -27,9 +27,12 @@ All notable changes follow Keep a Changelog.
 - Crash recovery: session.error plus execution.failed listeners, classifyFailure, 90s watchdog, session-start rearm, retryable send, persisted pendingAttempt.
 - Agent-callable goal tools (goal_set, goal_block, goal_complete, goal_resume) calling pure helpers directly with lease guard and slash-identical messages.
 - Fifth agent tool goal_evidence (sole evidence writer) plus /goal evidence slash mirror: set to evidence to complete is now reachable with the verifier gate unchanged.
+- Stale goal garbage collection: `gc.ts` archives per-session goal files older than 24h out of the scan by rename with a recovery log, never touching the current session, fresh files, unreadable files, or leased active lanes; 11 new tests.
 
 ### Fixed
 
+- Startup rearm no longer resumes abandoned lanes: a pending attempt older than the stale threshold is cleared through the shared `isFreshPendingAttempt` helper instead of arming the watchdog, while a recent attempt re-arms exactly as before.
+
 - Host-native V2 export: default is Plugin.define with id plus setup wiring slash goal plus idle plus compaction.
 - ESM-only dist because the plugin package ships no require entry.
 - Swallowed send no longer fakes a turn: a failed send stays retryable and records pendingAttempt.
diff --git a/DECISIONS.md b/DECISIONS.md
index 8b0ac30..8fb79e2 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -99,3 +99,11 @@ Context: two writes trusted a snapshot taken before the lease was held. `sendOne
 Decision: `sendOneShotStop` treats the claim snapshot as truth. It compares the fresh objective and status with the state the verdict was built on, and when they differ it drops the verdict without sending, releases the lease, and reports `state-changed` instead of writing the stale snapshot. A failed stop send records its retry against the same fresh snapshot. The failure listener loads `resolveStatePath(projectDir, failID)`, the same path `handleSessionFailure` wrote.
 
 Consequence: a goal replaced mid-tick survives intact, and a provider error rearms the watchdog for the lane that actually failed. Rollback: restore `mark(state)` and the legacy-path load; both are single-line reverts with no state-shape change.
+
+## ADR-019 2026-11-15 Stale goal files are archived and a stale retry never re-arms
+
+Context: per-session files accumulate forever, and the startup scan re-armed any active goal with a non-null pending attempt. A failure from days ago re-armed like one from a minute ago, so abandoned lanes retried forever and woke the idle loop.
+
+Decision: `src/gc.ts` archives per-session files older than `STALE_GOAL_MAX_AGE_MS` (24h, one named constant shared with rearm) out of the scan by rename, never delete, with every collection logged for recovery. The pass never touches the current session, never touches files younger than the threshold, never destroys unreadable files, and never collects an active goal without a known current session or with a live lease. Startup rearm clears a stale pending attempt through the shared `isFreshPendingAttempt` helper instead of arming it. Every lane exit clears its lease, so TTL stays a backstop.
+
+Consequence: dead lanes stop waking the loop while a parked human gate and a resumed session survive, and a wrongly collected goal is recoverable from the archive plus the log. Rollback: remove the GC call plus the freshness guard; prior rearm-everything behavior returns.
diff --git a/src/DECISIONS.md b/src/DECISIONS.md
index 3cc5441..836cf8f 100644
--- a/src/DECISIONS.md
+++ b/src/DECISIONS.md
@@ -25,6 +25,7 @@ reader inside `src/` finds the reasoning without leaving the folder.
 | ADR-016 idle human-gate park + movable citations   | `loop.ts`, `goal.ts`, `state.ts`, `index.ts`, `verifier.ts`  |
 | ADR-017 a new objective restarts the budget clocks | `goal.ts`, `limits.ts`                                       |
 | ADR-018 stop/retry writes follow the claimed state | `loop.ts`, `index.ts`, `watchdog.ts`                         |
+| ADR-019 stale goal GC plus guarded rearm           | `gc.ts`, `index.ts`, `limits.ts`                             |
 
 ## Local notes
 
diff --git a/src/README.md b/src/README.md
index 6270d31..7e89300 100644
--- a/src/README.md
+++ b/src/README.md
@@ -21,6 +21,7 @@ module is pure enough to test without an OpenCode host.
 | `verifier.ts`   | Completion gate: citations (exact, then unique basename), then declared or observed test proof                  |
 | `proof.ts`      | Executes a recorded proof command under timeout, output cap and cwd pin                                         |
 | `limits.ts`     | Turn, wall-time, delay and per-session cooldown budgets                                                         |
+| `gc.ts`         | Stale per-session file collection plus shared fresh-pending helper for startup rearm                            |
 
 ## Invariants
 
@@ -61,6 +62,10 @@ module is pure enough to test without an OpenCode host.
     long session is not born over budget. A one-shot stop (budget wrap or idle
     park) writes from the claim snapshot, never from the state loaded before the
     claim, so a `goal_set` that lands in that window is not overwritten.
+13. Stale lanes never wake the loop: `gc.ts` archives per-session files older than
+    `STALE_GOAL_MAX_AGE_MS` before rearm, the startup scan clears a stale
+    `pendingAttempt` through the shared `isFreshPendingAttempt` helper instead of
+    re-arming it, and every lane exit clears its lease so TTL is only a backstop.
 
 ## Risks
 
diff --git a/src/gc.ts b/src/gc.ts
index 78b7610..2ffb2f6 100644
--- a/src/gc.ts
+++ b/src/gc.ts
@@ -256,3 +256,28 @@ export async function collectStaleGoalFiles(
   }
   return result;
 }
+
+/**
+ * Decide whether a persisted pending attempt is fresh enough to re-arm.
+ * Why a shared helper: the startup rearm in `index.ts` and the GC pass in
+ * this module must agree on one staleness policy, so the threshold lives in
+ * `limits.ts` and the comparison lives here where tests pin it.
+ * @param lastAttemptMs epoch ms of the last attempt recorded in state
+ * @param nowMs injected current time in epoch ms
+ * @param maxAgeMs staleness window, defaults to STALE_GOAL_MAX_AGE_MS
+ */
+export function isFreshPendingAttempt(
+  lastAttemptMs: number,
+  nowMs: number,
+  maxAgeMs: number = STALE_GOAL_MAX_AGE_MS,
+): boolean {
+  if (
+    !Number.isFinite(lastAttemptMs) ||
+    !Number.isFinite(nowMs) ||
+    !Number.isFinite(maxAgeMs)
+  )
+    return false;
+  if (maxAgeMs < 0) return false;
+  const age = nowMs - lastAttemptMs;
+  return age >= 0 && age <= maxAgeMs;
+}
diff --git a/src/index.ts b/src/index.ts
index 7890eb1..afdc762 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -60,7 +60,7 @@ import {
   rearmFromState,
   _resetWatchdogsForTests,
 } from './watchdog.js';
-import { collectStaleGoalFiles } from './gc.js';
+import { collectStaleGoalFiles, isFreshPendingAttempt } from './gc.js';
 import { STALE_GOAL_MAX_AGE_MS } from './limits.js';
 
 /**
@@ -1248,9 +1248,11 @@ export default Plugin.define({
             // Discard stale pending attempts so abandoned goals stop retrying.
             const lastMs = st.pendingAttempt.lastAttemptMs;
             const nowMs = clock.nowMs();
-            const age = nowMs - lastMs;
-            const fresh =
-              Number.isFinite(age) && age >= 0 && age <= STALE_GOAL_MAX_AGE_MS;
+            const fresh = isFreshPendingAttempt(
+              lastMs,
+              nowMs,
+              STALE_GOAL_MAX_AGE_MS,
+            );
             if (!fresh) {
               try {
                 // Clear stale episode so it never re-arms again.
diff --git a/tests/gc.test.ts b/tests/gc.test.ts
new file mode 100644
index 0000000..bc7ee45
--- /dev/null
+++ b/tests/gc.test.ts
@@ -0,0 +1,291 @@
+/**
+ * Stale goal garbage collection tests.
+ * Why these tests exist: abandoned per-session goal files kept re-arming the
+ * watchdog forever, so the idle loop woke for lanes that ended days ago.
+ * These tests pin the conservative collect rules, the collection log, and
+ * the shared fresh-pending helper the startup rearm uses.
+ */
+import { promises as fs } from 'node:fs';
+import * as os from 'node:os';
+import * as path from 'node:path';
+import { afterEach, beforeEach, describe, expect, it } from 'vitest';
+import { collectStaleGoalFiles, isFreshPendingAttempt } from '../src/gc.js';
+import { STALE_GOAL_MAX_AGE_MS } from '../src/limits.js';
+import { initialState, resolveStatePath, saveGoalState } from '../src/state.js';
+import type { Clock, GoalState } from '../src/state.js';
+
+/** Fixed clock with mutable now for age math. */
+class FakeClock implements Clock {
+  constructor(public now: number) {}
+  nowMs(): number {
+    return this.now;
+  }
+}
+
+const T0 = 1700000000000;
+let projectDir = '';
+
+async function makeProject(): Promise<string> {
+  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-gc-'));
+  projectDir = base;
+  return base;
+}
+
+async function writeState(
+  sessionId: string,
+  over: Partial<GoalState>,
+  clock: FakeClock,
+): Promise<string> {
+  const state = { ...initialState('stale probe', clock, '2.0.29'), ...over };
+  const filePath = resolveStatePath(projectDir, sessionId);
+  await saveGoalState(filePath, state);
+  return filePath;
+}
+
+async function ageFile(
+  filePath: string,
+  ageMs: number,
+  clock: FakeClock,
+): Promise<void> {
+  const mtime = new Date(clock.nowMs() - ageMs);
+  await fs.utimes(filePath, mtime, mtime);
+}
+
+beforeEach(async () => {
+  await makeProject();
+});
+
+afterEach(async () => {
+  if (projectDir !== '') {
+    await fs.rm(projectDir, { recursive: true, force: true });
+    projectDir = '';
+  }
+});
+
+describe('isFreshPendingAttempt', () => {
+  it('accepts a recent attempt inside the window', () => {
+    expect(isFreshPendingAttempt(T0 - 1000, T0, STALE_GOAL_MAX_AGE_MS)).toBe(
+      true,
+    );
+  });
+
+  it('rejects an attempt older than the stale threshold', () => {
+    expect(
+      isFreshPendingAttempt(
+        T0 - STALE_GOAL_MAX_AGE_MS - 1,
+        T0,
+        STALE_GOAL_MAX_AGE_MS,
+      ),
+    ).toBe(false);
+  });
+
+  it('rejects a future stamp and a non-finite stamp', () => {
+    expect(isFreshPendingAttempt(T0 + 1000, T0, STALE_GOAL_MAX_AGE_MS)).toBe(
+      false,
+    );
+    expect(isFreshPendingAttempt(NaN, T0, STALE_GOAL_MAX_AGE_MS)).toBe(false);
+  });
+});
+
+describe('collectStaleGoalFiles', () => {
+  it('returns empty when no goals dir exists', async () => {
+    const clock = new FakeClock(T0);
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: () => undefined,
+    });
+    expect(result.scanned).toBe(0);
+    expect(result.collected).toEqual([]);
+  });
+
+  it('leaves a fresh file alone', async () => {
+    const clock = new FakeClock(T0);
+    const filePath = await writeState(
+      'sess-fresh',
+      { status: 'complete' },
+      clock,
+    );
+    await ageFile(filePath, 1000, clock);
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: () => undefined,
+    });
+    expect(result.scanned).toBe(1);
+    expect(result.collected).toEqual([]);
+    expect(result.skipped[0]?.reason).toBe('fresh');
+  });
+
+  it('collects an old completed file and logs the path', async () => {
+    const clock = new FakeClock(T0);
+    const filePath = await writeState(
+      'sess-old',
+      { status: 'complete' },
+      clock,
+    );
+    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
+    const lines: string[] = [];
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: (line) => lines.push(line),
+    });
+    expect(result.collected.length).toBe(1);
+    expect(result.collected[0]?.path).toBe(filePath);
+    expect(lines.join('\n')).toContain(filePath);
+    // Collected by rename: the original path is gone, the archive remains.
+    await expect(fs.stat(filePath)).rejects.toBeDefined();
+    await expect(
+      fs.stat(String(result.collected[0]?.archivedPath)),
+    ).resolves.toBeDefined();
+  });
+
+  it('never touches the current session even when old', async () => {
+    const clock = new FakeClock(T0);
+    const filePath = await writeState(
+      'sess-now',
+      { status: 'active', leaseExpiresAtMs: 0 },
+      clock,
+    );
+    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: () => undefined,
+    });
+    expect(result.collected).toEqual([]);
+    expect(result.skipped[0]?.reason).toBe('current-session');
+  });
+
+  it('leaves an active goal alone when the current session is unknown', async () => {
+    const clock = new FakeClock(T0);
+    const filePath = await writeState(
+      'sess-active',
+      { status: 'active', leaseExpiresAtMs: 0 },
+      clock,
+    );
+    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: null,
+      log: () => undefined,
+    });
+    expect(result.collected).toEqual([]);
+    expect(result.skipped[0]?.reason).toBe('active-unknown-session');
+  });
+
+  it('leaves a leased active lane alone', async () => {
+    const clock = new FakeClock(T0);
+    const filePath = await writeState(
+      'sess-leased',
+      {
+        status: 'active',
+        leaseOwner: 'owner-live',
+        leaseExpiresAtMs: T0 + 60000,
+      },
+      clock,
+    );
+    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: () => undefined,
+    });
+    expect(result.collected).toEqual([]);
+    expect(result.skipped[0]?.reason).toBe('leased');
+  });
+
+  it('leaves an unreadable file alone', async () => {
+    const clock = new FakeClock(T0);
+    const goalsDir = path.join(projectDir, '.opencode', 'goals');
+    await fs.mkdir(goalsDir, { recursive: true });
+    const badPath = path.join(goalsDir, 'sess-bad.json');
+    await fs.writeFile(badPath, '{not-json', 'utf8');
+    await ageFile(badPath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: () => undefined,
+    });
+    expect(result.collected).toEqual([]);
+    expect(result.skipped[0]?.reason).toBe('unreadable');
+  });
+
+  it('ignores the evidence sidecar and lock files', async () => {
+    const clock = new FakeClock(T0);
+    const goalsDir = path.join(projectDir, '.opencode', 'goals');
+    await fs.mkdir(goalsDir, { recursive: true });
+    await fs.writeFile(
+      path.join(goalsDir, 'sess-now.evidence.json'),
+      '{"criteria":[]}',
+      'utf8',
+    );
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: () => undefined,
+    });
+    expect(result.scanned).toBe(0);
+  });
+});
+
+describe('stale active lanes regression', () => {
+  it('collects an old active file from another session with cleared lease', async () => {
+    const clock = new FakeClock(T0);
+    const filePath = await writeState(
+      'sess-stale-active',
+      { status: 'active', leaseExpiresAtMs: 0 },
+      clock,
+    );
+    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: () => undefined,
+    });
+    expect(result.collected.map((c) => c.path)).toContain(filePath);
+  });
+
+  it('collects an old interrupted file from another session', async () => {
+    const clock = new FakeClock(T0);
+    const filePath = await writeState(
+      'sess-stale-interrupted',
+      { status: 'interrupted', leaseExpiresAtMs: 0 },
+      clock,
+    );
+    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: () => undefined,
+    });
+    expect(result.collected.map((c) => c.path)).toContain(filePath);
+  });
+
+  it('collects an old active file with expired lease', async () => {
+    const clock = new FakeClock(T0);
+    const filePath = await writeState(
+      'sess-expired-lease',
+      {
+        status: 'active',
+        leaseOwner: 'owner-dead',
+        leaseExpiresAtMs: T0 - 1000,
+      },
+      clock,
+    );
+    await ageFile(filePath, STALE_GOAL_MAX_AGE_MS + 5000, clock);
+    const result = await collectStaleGoalFiles(projectDir, clock, {
+      currentSessionId: 'sess-now',
+      log: () => undefined,
+    });
+    expect(result.collected.map((c) => c.path)).toContain(filePath);
+  });
+});
+
+describe('isFreshPendingAttempt boundaries', () => {
+  it('accepts an attempt exactly at the threshold', () => {
+    expect(
+      isFreshPendingAttempt(
+        T0 - STALE_GOAL_MAX_AGE_MS,
+        T0,
+        STALE_GOAL_MAX_AGE_MS,
+      ),
+    ).toBe(true);
+  });
+
+  it('rejects non-finite maxAge', () => {
+    expect(isFreshPendingAttempt(T0 - 1000, T0, NaN)).toBe(false);
+    expect(isFreshPendingAttempt(T0 - 1000, T0, Infinity)).toBe(false);
+  });
+});
```
<!-- END_GIT_DIFF -->
