# Task 07: Crash And Error Recovery For Active Goal

**File:** `tasks/qa/07-goal-crash-error-recovery.md`
**Status:** in-progress
**Source:** manager
**Type:** bug
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Host:** opencode v2.0.29

## Goal

When OpenCode server errors or crashes mid-turn, an active goal must resume continuation instead of stalling forever. Today the plugin only reacts to session.idle, so no idle means no continue.

## Reported Symptom

Manager set a goal, it was running, OpenCode server threw an error, and nothing happened after. The plugin never sent continue again; goal stayed active with no recovery.

## Confirmed Defect

- `src/index.ts:647` filters to `session.idle` only, every other event ignored.
- `src/index.ts:670` sendPrompt does `.catch(() => null)`, so a failed turn looks like a normal send.
- No `session.error` listener anywhere in `src/` (grep clean).
- No watchdog timer and no session-start resume of an active goal.

## Clone Findings (recovery survey)

- prevalentWare: only clone with a real idle-never-arrives watchdog, `armTurnWatchdog` with `max_turn_time` at `src/server.ts:1616`, plus transport retry plus `session.execution.failed/interrupted` handling at `src/server.ts:3056`.
- willytop8: maps V2 `execution.failed/interrupted` to `session.error` at `src/v2-bridge.js:315`, no idle watchdog, forces `stopped` on hydrate at `src/goal-plugin.js:1714`.
- goal-loop: no session.error listener, forces `paused` on load at `src/core/state.ts:300`.
- heimoshuiyu: listens `session.error` plus `MessageAbortedError` at `src/index.ts:389`, but guards are in-memory only, crash-fragile.
- oh-my-goal: idle only, crash-fragile, no failure events.

## Seat Check

Domains → seats: session/event contract plus recovery design → Software Architect; loop race plus timer plus resume → Senior Programmer. Skipped: UI/UX Designer (no visual surface), Project Planner plus Sprint Strategist (single bug), QA Engineer plus Code Reviewer (later gates). Trigger eval TITLE+BODY: Architect fires on contract plus API design; Programmer fires on race plus silent-fail plus performance; Designer miss. Cross-disciplinary → 2-seat consult.

## Acceptance Criteria

- [x] D1 failed send never synthesizes turn-unlabeled and stays retryable
- [x] D2 session.error plus execution.failed plus interrupted subscribed with user-abort park versus provider-error retry
- [x] D3 90s watchdog with Clock math plus unref plus cleanup fires once when idle never arrives
- [x] D4 startup rearm without immediate send plus real lastMessageId threaded
- [x] D5 wrap sends exactly once with persisted flag guard
- [x] D6 pendingAttempt plus heartbeat plus failureCount plus recoveryEpoch persisted atomically
- [x] Invariants intact: lease 120s wx, Clock UTC ms, file-state atomic truth, limits 20s/30/2h/STOP_GOAL
- [x] Full suite 111 pass plus typecheck plus prettier green

## Local TODOs

- [x] Create task file and move to in-progress
- [x] Clone recovery survey plus discovery report
- [x] Brain plan O1 approval
- [x] Implement D1-D6 plus 9 regression tests
- [x] Docs sync plus QA transition

## Risk & Rollback

Risk is host event-name drift and a timer that fires after the goal is done, contained by fail-closed event guards plus clear-on-success plus one timer per lane. Rollback is revert of this slice; the pure loop plus file state keep prior idle-only behavior.

## Brainstorm

Brainstorm: required — cross-disciplinary plus hard to reverse loop behavior.

## Execution Log & Reasoning

- Defect reproduced by code read at cited lines. Awaiting brain plan for recovery strategy (session.error listener, watchdog timer, session-start resume) before any code.
- Manager asked brain plus clone analysis for the strategy; survey done, sending to brain now.
- Discovery ground truth: context-reports/context_report_20261016_221359_947dffe1.md. Confirms only trigger is session.idle src/index.ts:647, send swallowed src/index.ts:667-680, wrapupSent unread src/loop.ts:316-333, zero hits for session.error plus timers plus resume, registerIdleHandler plus registerCompactionHandler never called from setup.
- Brain Plan Verdict (task_id 07): O1 selected — D1 retryable send, D2 session.error plus execution.failed listener with classifyFailure, D3 90s watchdog timer with Clock math plus unref, D4 session-start resume plus fix dead wiring plus thread real lastMessageId, D5 wrap-once sends plus flag guard, D6 persisted pendingAttempt plus lastHeartbeatMs plus failureCount plus recoveryEpoch. Brainstorm required. Manager Approved, requesting implementation XML.
- O1 D1-D6 applied. D1: sendPrompt now returns a discriminated SendResult, normalizeSendResult keeps a legacy plain result working, a failed send never advances the turn and records pendingAttempt. D2: setup subscribes session.error plus session.execution.failed plus session.execution.interrupted, classifyFailure splits user-abort versus provider-error, handleSessionFailure parks on abort (status interrupted, requires manual resume) and records a retry on provider error. D3: new src/watchdog.ts with armWatchdog plus clearWatchdog plus rearmFromState, 90s deadline before the 120s lease TTL, unref plus one timer per lane. D4: shared buildIdleDeps, startup rearm from persisted state without an immediate send, real lastMessageID threaded from the event payload. D5: one wrap-up send on the first budget hit then a persisted wrapped-up stop. D6: recovery fields persisted atomically and every refire path claims the lease.
- Invariants preserved: single-flight lease 120s wx, Clock UTC ms with SystemClock as the only Date.now, file-state atomic tmp plus fsync plus chmod plus rename, limits 20s/30/2h/STOP_GOAL unchanged.
- Honest limitation recorded: the plugin runs inside the OpenCode server process, so during a hard server crash no code runs until the host restarts. Recovery after restart is handled by the startup rearm; recovery during a provider error is handled by the error listener plus watchdog.

## Verification Evidence

- Command: rtk test npm test | Expected: all pass | Actual: 14 files 102 tests passed | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: npx prettier --check src/*.ts tests/*.ts | Expected: exit 0 | Actual: exit 0 after --write | Exit: 0.
- Stack gate skip record: root=. markers=[package.json] matched=[] reason=no stack marker found.
- New tests: tests/recovery.test.ts (D1 retryable send, D2 classification plus handler, D3 watchdog, D5 wrap-once, D6 persisted guards).
- Hotfix QA_REJECTED F1-F7 applied: lease-guarded failure write, abort-aware send with retryable respected, real lastSessionId lane instead of fake startup, event-hint classification with top-level error read, wrap flips only after a successful send, watchdog finite plus 500-lane bounds, and /goal resume for a parked goal.
- Hotfix QA_REJECTED F8-F10 applied: settleFailedSend persists lastSessionId so a first-failure restart can rearm, wrap path settles the watchdog on both success and failure, buildPendingAttempt tolerates undefined pending.
- Command: rtk test npm test | Expected: all pass | Actual: 14 files 111 tests passed | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- QA verdict: QA_PASSED after three rounds (111 tests green plus typecheck clean).
- Review verdict: PO_REVIEW_PENDING with technical approval, low issues only (resume throw, silent unknown error, per-tick closure allocation).

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 2711ead..216adca 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -10,9 +10,14 @@ All notable changes follow Keep a Changelog.
 - Fail-closed lease with token single-flight plus per-session cooldown fairness.
 - Evidence-gated complete helper plus wrap-up flag plus context nudge injection.
 - V2 strictness with goal input JSON Schema plus traversal-safe title check.
+- Crash recovery: session.error plus execution.failed listeners, classifyFailure, 90s watchdog, session-start rearm, retryable send, persisted pendingAttempt.
 ### Fixed
 - Host-native V2 export: default is Plugin.define with id plus setup wiring slash goal plus idle plus compaction.
 - ESM-only dist because the plugin package ships no require entry.
+- Swallowed send no longer fakes a turn: a failed send stays retryable and records pendingAttempt.
+- Active goal no longer stalls when no session.idle arrives: watchdog plus error listener plus resume.
+- Hotfix: lease-guarded failure write plus abort-aware send plus real startup lane plus wrap-after-success plus watchdog bounds plus /goal resume.
+- Hotfix: failed-send lane persistence plus wrap watchdog settle plus pending undefined guard.
 - Hotfix idle survival: compaction keeps live controller, stale entries cleared.
 - Hotfix evidence wiring: both complete lanes require proof plus wrapupSent once.
 - Hotfix setup guard plus session fairness plus lease proof with sidecar.
diff --git a/DECISIONS.md b/DECISIONS.md
index 305b4da..d143d74 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -11,3 +11,6 @@ Context: compaction wipes memory and self-report completes too easily. Decision:
 Context: host loader rejected our plain-object default export as missing id. Decision: default export is Plugin.define with id opencode-goal-plugin plus setup wiring command, idle subscribe, and session hooks, ESM-only dist, @opencode/plugin dependency. Consequence: entry passes host schema on web, CLI, and TUI.
 ## ADR-006 2026-10-16 Best-plugin hardening without contract break
 Context: clones showed crash truncation, double-fire, false complete, global throttle unfairness. Decision: fsync plus chmod plus quarantine, token single-flight plus fail-closed reclaim, evidence-gated helper plus wrapupSent plus nudge, per-session cooldown plus AbortSet, JSON Schema plus traversal guard, file-state stays truth. Consequence: 83 tests green with 7 new regressions, no V2 contract change.
+## ADR-007 2026-10-16 Crash and error recovery for an active goal
+Context: idle-only trigger stalled an active goal forever when the host emitted no session.idle after a server error or crash, and a failed send was swallowed as a fake success (catch to null then turn-unlabeled). Clone survey: only prevalentWare had a watchdog; heimoshuiyu plus willytop8 plus prevalentWare listened to session.error; goal-loop plus willytop8 paused recovered goals. Decision: subscribe session.error plus execution.failed plus execution.interrupted and classify user-abort versus provider-error; park on abort and park-require-resume; record pendingAttempt plus lastHeartbeatMs plus failureCount plus recoveryEpoch in file state; a 90s watchdog wakes before the 120s lease TTL and every wake re-enters the same lease plus token guard; session start rearms without an immediate send; a failed send stays retryable and never advances the turn; one wrap-up send then stop. Consequence: 102 tests green, an active goal survives a provider error, a failed send, and a restart, and the V2 contract (Plugin.define id plus setup, event.subscribe plus AbortController cleanup) is unchanged.
+Rollback: revert this slice; the pure loop plus file state keep prior idle-only behavior.
diff --git a/commands/goal.md b/commands/goal.md
index 910c58f..6a70ab5 100644
--- a/commands/goal.md
+++ b/commands/goal.md
@@ -1,9 +1,11 @@
 # goal command
-Slash goal sets objective for OpenCode V2 plugin Phase 1.
+Slash goal sets objective for OpenCode V2 plugin.
 Patterns:
 - /goal <objective> sets active objective, max 2000 chars
 - /goal status shows current state
 - /goal block <reason> marks blocked
-- /goal complete marks complete
+- /goal complete marks complete (needs evidence)
+- /goal resume re-activates a parked goal (interrupted or blocked)
 - /goal clear marks cleared
-Phase 1 does not auto-continue on idle. Loop arrives in Phase 2.
+Idle auto-continue sends one prompt per idle tick. A provider error or a
+failed send re-arms a watchdog so an active goal resumes instead of stalling.
diff --git a/src/goal.ts b/src/goal.ts
index 079feee..82e081b 100644
--- a/src/goal.ts
+++ b/src/goal.ts
@@ -13,6 +13,7 @@ export type ParsedGoal =
   | { kind: 'clear' }
   | { kind: 'block'; reason: string }
   | { kind: 'complete' }
+  | { kind: 'resume' }
   | { kind: 'invalid'; raw: string };
 
 export const MAX_OBJECTIVE_LEN = 2000;
@@ -78,6 +79,14 @@ export function parseGoalCommand(rawInput: string): ParsedGoal {
   ) {
     return { kind: 'invalid', raw: rawInput };
   }
+  if (bodyLower === 'resume') return { kind: 'resume' };
+  if (
+    bodyLower.startsWith('resume ') ||
+    bodyLower.startsWith('resume\t') ||
+    bodyLower.startsWith('resume\n')
+  ) {
+    return { kind: 'invalid', raw: rawInput };
+  }
   if (bodyLower === 'block') {
     // Bare block names no reason, so the blocked state would be unactionable.
     return { kind: 'invalid', raw: rawInput };
@@ -221,3 +230,27 @@ export function clearGoal(current: GoalState, clock: Clock): GoalState {
     updatedAtMs: clock.nowMs(),
   };
 }
+
+/**
+ * Resume a parked goal back to active after an explicit user request.
+ * Why this exists: a user abort parks the goal as interrupted, and the only
+ * path back is an explicit /goal resume. Blocked goals can also be resumed.
+ * Clears any stale retry so the watchdog does not fire against a fresh start.
+ * @param current current state, must be interrupted or blocked
+ * @param clock injected clock
+ */
+export function resumeGoal(current: GoalState, clock: Clock): GoalState {
+  // Only a parked goal can resume; active and finished states are no-ops.
+  if (current.status !== 'interrupted' && current.status !== 'blocked') {
+    throw new Error('only a parked goal can resume');
+  }
+  return {
+    ...current,
+    status: 'active',
+    pendingAttempt: null,
+    recoveryEpoch: current.recoveryEpoch + 1,
+    leaseOwner: null,
+    leaseExpiresAtMs: 0,
+    updatedAtMs: clock.nowMs(),
+  };
+}
diff --git a/src/index.ts b/src/index.ts
index 9ddf36e..92e2cdb 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -21,10 +21,15 @@ import {
   completeGoal,
   parseGoalCommand,
   setObjective,
+  resumeGoal,
   isSafeGoalTitle,
   GoalInputSchema,
 } from './goal.js';
-import { handleSessionIdle } from './loop.js';
+import {
+  handleSessionIdle,
+  handleSessionFailure,
+  classifyFailure,
+} from './loop.js';
 import { DEFAULT_LIMITS, STOP_FILE_NAME } from './limits.js';
 import type { Limits } from './limits.js';
 import {
@@ -35,6 +40,12 @@ import {
 } from './compaction.js';
 import { saveEvidence, emptyEvidence, loadEvidence } from './evidence.js';
 import { tryCompleteWithEvidence } from './verifier.js';
+import {
+  armWatchdog,
+  clearWatchdog,
+  rearmFromState,
+  _resetWatchdogsForTests,
+} from './watchdog.js';
 
 /**
  * V2 contract note: file-state at .opencode/goal-state.json owns truth.
@@ -205,6 +216,23 @@ export async function handleGoalCommand(
     }
     return 'Goal marked complete.';
   }
+  if (parsed.kind === 'resume') {
+    // Resume a parked goal back to active after an explicit user request.
+    let resumed: GoalState;
+    try {
+      resumed = resumeGoal(current, clock);
+    } catch {
+      return (
+        'Only a parked goal can resume. Current status: ' + current.status + '.'
+      );
+    }
+    try {
+      await saveGoalState(statePath, resumed);
+    } catch (err) {
+      return 'Failed to save goal state: ' + (err as Error).message;
+    }
+    return 'Goal resumed: ' + resumed.objective;
+  }
   const cleared = clearGoal(current, clock);
   try {
     await saveGoalState(statePath, cleared);
@@ -428,7 +456,8 @@ export function buildGoalWorkInstruction(
     ').\n' +
     'Work toward it now with concrete steps.\n' +
     'When done, finish with evidence and call /goal complete. ' +
-    'If blocked, call /goal block <reason>. To cancel, call /goal clear.'
+    'If blocked, call /goal block <reason>. To cancel, call /goal clear. ' +
+    'If the goal was parked, call /goal resume to continue.'
   );
 }
 
@@ -625,6 +654,88 @@ export default Plugin.define({
     const controller = new AbortController();
     const idleAbortControllers = new Set<AbortController>();
     idleAbortControllers.add(controller);
+    // Shared deps builder so idle ticks, failure rearms, and startup resume all
+    // use one sender. Why one builder: a second copy could drift and let a wake
+    // or a retry send twice under the same lane.
+    const buildIdleDeps = (rawID: string) => {
+      const session = (
+        ctx as { session?: { prompt?: (a: unknown) => Promise<unknown> } }
+      ).session;
+      const promptFn =
+        session !== undefined && typeof session.prompt === 'function'
+          ? session.prompt.bind(session)
+          : null;
+      return {
+        clock,
+        limits: DEFAULT_LIMITS,
+        ownerId,
+        loadState: loadGoalState,
+        saveState: saveGoalState,
+        tryClaim: tryClaimLease,
+        sendPrompt: async (prompt: string) => {
+          // Real failures stay failures: never synthesize a fake success.
+          // A thrown send or an empty message id becomes a retryable result.
+          if (promptFn === null) {
+            return {
+              success: false as const,
+              error: 'no-prompt-fn',
+              retryable: true,
+            };
+          }
+          try {
+            const res = (await promptFn({
+              sessionID: rawID,
+              text: prompt,
+            })) as {
+              messageID?: unknown;
+              tokenSpend?: unknown;
+            } | null;
+            const messageID =
+              typeof res?.messageID === 'string' && res.messageID.length > 0
+                ? res.messageID
+                : '';
+            if (messageID === '') {
+              return {
+                success: false as const,
+                error: 'empty-message-id',
+                retryable: true,
+              };
+            }
+            const tokenSpend =
+              typeof res?.tokenSpend === 'number' ? res.tokenSpend : 0;
+            return { success: true as const, messageId: messageID, tokenSpend };
+          } catch (err: unknown) {
+            const msg = err instanceof Error ? err.message : String(err);
+            // An abort must not be retried: mark it non-retryable so the loop
+            // parks the goal instead of arming a watchdog against a user stop.
+            const kind = classifyFailure(err);
+            return {
+              success: false as const,
+              error: msg,
+              retryable: kind !== 'user-abort',
+            };
+          }
+        },
+        hasStopFile,
+        // Settle hook: success clears the watchdog, failure re-arms it.
+        onTurnSettled: (r: { ok: boolean; deadlineMs: number | null }) => {
+          try {
+            if (r.ok || r.deadlineMs === null) {
+              clearWatchdog(projectDir, rawID);
+              return;
+            }
+            armWatchdog(projectDir, rawID, r.deadlineMs, clock, async () => {
+              await handleSessionIdle(
+                { projectDir, lastMessageId: null, sessionId: rawID },
+                buildIdleDeps(rawID),
+              );
+            });
+          } catch {
+            // Watchdog bookkeeping is best-effort.
+          }
+        },
+      };
+    };
     const idleTask = (async () => {
       try {
         const events = (
@@ -644,46 +755,74 @@ export default Plugin.define({
         for await (const event of stream) {
           try {
             if (event === null || typeof event !== 'object') continue;
-            if ((event as { type?: unknown }).type !== 'session.idle') continue;
+            const evType = (event as { type?: unknown }).type;
             const data = (event as { data?: { sessionID?: unknown } }).data;
             const props = (event as { properties?: { sessionID?: unknown } })
               .properties;
+            // Failure events (error / execution.failed / execution.interrupted)
+            // are the crash-and-abort signal: classify and park or mark retry.
+            if (
+              evType === 'session.error' ||
+              evType === 'session.execution.failed' ||
+              evType === 'session.execution.interrupted'
+            ) {
+              const failID = data?.sessionID ?? props?.sessionID;
+              if (typeof failID !== 'string' || failID.length === 0) continue;
+              const errPayload =
+                (event as { error?: unknown }).error ??
+                (
+                  event as {
+                    properties?: { error?: unknown };
+                    data?: { error?: unknown };
+                  }
+                ).properties?.error ??
+                (event as { data?: { error?: unknown } }).data?.error ??
+                evType;
+              await handleSessionFailure(
+                { projectDir, sessionId: failID },
+                {
+                  clock,
+                  loadState: loadGoalState,
+                  saveState: saveGoalState,
+                  tryClaim: tryClaimLease,
+                  ownerId,
+                },
+                errPayload,
+                typeof evType === 'string' ? evType : undefined,
+              );
+              // Re-arm the watchdog from the persisted attempt so a retryable
+              // provider error wakes the loop even when no idle event follows.
+              void loadGoalState(resolveStatePath(projectDir))
+                .then((st) => {
+                  if (st === null) return;
+                  rearmFromState(projectDir, failID, st, clock, async () => {
+                    await handleSessionIdle(
+                      { projectDir, lastMessageId: null, sessionId: failID },
+                      buildIdleDeps(failID),
+                    );
+                  });
+                })
+                .catch(() => undefined);
+              continue;
+            }
+            if (evType !== 'session.idle') continue;
             const rawID = data?.sessionID ?? props?.sessionID;
             if (typeof rawID !== 'string' || rawID.length === 0) continue;
-            const session = (
-              ctx as { session?: { prompt?: (a: unknown) => Promise<unknown> } }
-            ).session;
-            if (session === undefined || typeof session.prompt !== 'function')
-              continue;
-            const promptFn = session.prompt.bind(session);
-            const deps = {
-              clock,
-              limits: DEFAULT_LIMITS,
-              ownerId,
-              loadState: loadGoalState,
-              saveState: saveGoalState,
-              tryClaim: tryClaimLease,
-              sendPrompt: async (prompt: string) => {
-                const res = (await promptFn({
-                  sessionID: rawID,
-                  text: prompt,
-                }).catch(() => null)) as {
-                  messageID?: unknown;
-                  tokenSpend?: unknown;
-                } | null;
-                const messageID =
-                  typeof res?.messageID === 'string' && res.messageID.length > 0
-                    ? res.messageID
-                    : 'turn-unlabeled';
-                const tokenSpend =
-                  typeof res?.tokenSpend === 'number' ? res.tokenSpend : 0;
-                return { messageId: messageID, tokenSpend };
-              },
-              hasStopFile,
-            };
+            // Thread the real last message id so the human-message yield works.
+            // Falling back to null only when the host omits it.
+            const lastMsgId =
+              (props as { lastMessageID?: unknown } | undefined)
+                ?.lastMessageID ??
+              (data as { lastMessageID?: unknown } | undefined)
+                ?.lastMessageID ??
+              null;
             await handleSessionIdle(
-              { projectDir, lastMessageId: null, sessionId: rawID },
-              deps,
+              {
+                projectDir,
+                lastMessageId: typeof lastMsgId === 'string' ? lastMsgId : null,
+                sessionId: rawID,
+              },
+              buildIdleDeps(rawID),
             );
           } catch {
             // One bad tick never kills the subscription.
@@ -694,6 +833,29 @@ export default Plugin.define({
       }
     })();
 
+    // Session-start resume: rearm any outstanding retry from file state.
+    // Why no immediate send: a blind resume would bypass the lease and the
+    // 20s cooldown. Rearm only, so the watchdog performs the guarded retry.
+    void loadGoalState(resolveStatePath(projectDir))
+      .then((st) => {
+        if (st === null || st.status !== 'active') return;
+        if (st.pendingAttempt === null) return;
+        // Rearm the exact last real session. A missing id means no lane is
+        // known yet, so skip: the next real event will rearm correctly.
+        const lane =
+          typeof st.lastSessionId === 'string' && st.lastSessionId.length > 0
+            ? st.lastSessionId
+            : '';
+        if (lane === '') return;
+        rearmFromState(projectDir, lane, st, clock, async () => {
+          await handleSessionIdle(
+            { projectDir, lastMessageId: null, sessionId: lane },
+            buildIdleDeps(lane),
+          );
+        });
+      })
+      .catch(() => undefined);
+
     // Compaction survival: re-inject the goal summary from file state, never send.
     try {
       const session = (
diff --git a/src/loop.ts b/src/loop.ts
index a27c595..e076e15 100644
--- a/src/loop.ts
+++ b/src/loop.ts
@@ -67,6 +67,11 @@ export interface IdleContext {
   sessionId?: string | null;
 }
 
+/** Discriminated result of one send attempt. */
+export type SendResult =
+  | { success: true; messageId: string; tokenSpend?: number }
+  | { success: false; error: string; retryable: boolean };
+
 /** Injected collaborators so tests never touch disk or model. */
 export interface IdleDeps {
   clock: Clock;
@@ -80,10 +85,63 @@ export interface IdleDeps {
     ttl: number,
     c: Clock,
   ) => Promise<{ claimed: boolean; state: GoalState | null }>;
+  /**
+   * Send one continuation prompt.
+   * Return shape is tolerant: an object with success true carries messageId,
+   * success false carries error plus retryable. A legacy plain
+   * { messageId } return is treated as success when the id is non-empty.
+   */
   sendPrompt: (
     prompt: string,
-  ) => Promise<{ messageId: string; tokenSpend?: number }>;
+  ) => Promise<SendResult | { messageId: string; tokenSpend?: number }>;
   hasStopFile: () => Promise<boolean>;
+  /**
+   * Optional hook fired after a turn ends, success or failure.
+   * Why this exists: the host clears the watchdog on success and re-arms it on
+   * a failure without the pure loop depending on timer state.
+   */
+  onTurnSettled?: (result: { ok: boolean; deadlineMs: number | null }) => void;
+}
+
+/**
+ * Normalize a raw send result into a discriminated SendResult.
+ * Why this helper exists: older tests and hosts return a plain
+ * { messageId } object. A missing or empty id means failure, never a
+ * synthesized turn label, so a failed send stays retryable.
+ * @param raw unknown result from the host sender
+ */
+export function normalizeSendResult(raw: unknown): SendResult {
+  if (raw !== null && typeof raw === 'object') {
+    const r = raw as Record<string, unknown>;
+    if ('success' in r) {
+      if (
+        r['success'] === true &&
+        typeof r['messageId'] === 'string' &&
+        r['messageId'].length > 0
+      ) {
+        return {
+          success: true,
+          messageId: r['messageId'],
+          tokenSpend: typeof r['tokenSpend'] === 'number' ? r['tokenSpend'] : 0,
+        };
+      }
+      return {
+        success: false,
+        error: typeof r['error'] === 'string' ? r['error'] : 'send-failed',
+        retryable: r['retryable'] !== false,
+      };
+    }
+    // Legacy shape: non-empty messageId counts as success.
+    if (typeof r['messageId'] === 'string' && r['messageId'].length > 0) {
+      return {
+        success: true,
+        messageId: r['messageId'],
+        tokenSpend: typeof r['tokenSpend'] === 'number' ? r['tokenSpend'] : 0,
+      };
+    }
+  }
+  // Anything else is a retryable failure, never a fake success.
+  return { success: false, error: 'send-failed', retryable: true };
 }
 
 /** Idle tick outcome. */
@@ -102,6 +160,293 @@ function safeSpend(v: unknown): number {
   return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
 }
 
+/**
+ * Default watchdog deadline: wake before the 120s lease TTL expires.
+ * Why 90s exists: a wake sooner than the lease grants a clean claim while a
+ * wake later than TTL would let another process reclaim first.
+ */
+export const DEFAULT_MAX_TURN_MS = 90000;
+
+/**
+ * Build or extend a pending continuation attempt after a failed turn.
+ * Why this helper exists: retry state must be explicit and persisted so the
+ * watchdog and a restart can resume. Timestamps come from the injected clock.
+ * @param state current goal state carrying any prior attempt
+ * @param reason failure classification (provider-error or user-abort)
+ * @param nowMs injected now in epoch ms
+ */
+export function buildPendingAttempt(
+  state: GoalState,
+  reason: string,
+  nowMs: number,
+): import('./state.js').PendingAttempt {
+  // Continue an existing episode when present, else start a fresh one.
+  // Loose null check covers an undefined value from a raw disk read.
+  const prev = state.pendingAttempt;
+  const hasPrev = prev !== null && prev !== undefined;
+  return {
+    firstAttemptMs: hasPrev ? prev.firstAttemptMs : nowMs,
+    lastAttemptMs: nowMs,
+    attemptCount: hasPrev ? prev.attemptCount + 1 : 1,
+    deadlineMs: nowMs + DEFAULT_MAX_TURN_MS,
+    reason,
+  };
+}
+
+/** Failure classification for crash-versus-abort decisions. */
+export type FailureKind = 'user-abort' | 'provider-error'; /**
+ * Classify a failure payload as a user abort or a retryable provider error.
+ * Why this helper exists: an explicit user abort must park the goal and
+ * require a manual resume, while a transient provider error should retry.
+ * Precedence: an exact MessageAbortedError name or an explicit abort phrase
+ * wins; otherwise the event type hint decides (interrupted means the user
+ * stopped, failed means a provider error); otherwise provider-error.
+ * Pure and total so callers never throw on a weird error shape.
+ * @param err unknown error name or payload
+ * @param evType optional host event type hint
+ */
+export function classifyFailure(err: unknown, evType?: string): FailureKind {
+  // Build one lowercase match string from the common error shapes.
+  let name = '';
+  let message = '';
+  if (typeof err === 'string') {
+    message = err;
+  } else if (err !== null && typeof err === 'object') {
+    const e = err as { name?: unknown; message?: unknown; type?: unknown };
+    if (typeof e.name === 'string') name = e.name;
+    if (typeof e.message === 'string') message = e.message;
+    // Some hosts put the error name on `type`.
+    if (name === '' && typeof e.type === 'string') name = e.type;
+  }
+  const low = (name + ' ' + message).toLowerCase();
+  // Exact abort names win without needing an event hint.
+  if (low.includes('messageabortederror')) return 'user-abort';
+  // An explicit user stop phrase must not be overridden by an event hint.
+  if (low.includes('user abort') || low.includes('aborted by user')) {
+    return 'user-abort';
+  }
+  // A bare "aborted" alone is ambiguous: a transport can abort too, so it only
+  // counts as an abort when the event hint also says interrupted.
+  if (evType === 'session.execution.interrupted') return 'user-abort';
+  if (
+    low.includes('aborted') ||
+    low.includes('canceled') ||
+    low.includes('cancelled')
+  ) {
+    // Without an interrupted hint, treat a bare abort word as a provider error.
+    return 'provider-error';
+  }
+  // Everything else (timeout, network, 5xx, transport, provider) is retryable.
+  return 'provider-error';
+}
+
+/**
+ * Handle one session failure event: classify and either park or mark retry.
+ * Why this function exists: a failed or interrupted turn must not stall an
+ * active goal silently. A user abort parks the goal and requires a manual
+ * resume; a provider error records a retry attempt for the watchdog.
+ * @param ctx project dir plus session id
+ * @param deps injected clock plus storage
+ * @param err the failure payload from the host event
+ */
+export async function handleSessionFailure(
+  ctx: { projectDir: string; sessionId?: string | null },
+  deps: {
+    clock: Clock;
+    loadState: (p: string) => Promise<GoalState | null>;
+    saveState: (p: string, s: GoalState) => Promise<void>;
+    /** Lease claim so a failure write never races an idle tick. */
+    tryClaim?: (
+      p: string,
+      owner: string,
+      ttl: number,
+      c: Clock,
+    ) => Promise<{ claimed: boolean; state: GoalState | null }>;
+    ownerId?: string;
+  },
+  err: unknown,
+  evType?: string,
+): Promise<IdleDecision> {
+  // Null guards: a host with an empty payload gets a reason, never a throw.
+  if (ctx === null || typeof ctx !== 'object') {
+    return { decision: 'stopped', reason: 'invalid-context' };
+  }
+  if (
+    typeof ctx.projectDir !== 'string' ||
+    ctx.projectDir.trim().length === 0
+  ) {
+    return { decision: 'stopped', reason: 'invalid-project-dir' };
+  }
+  if (
+    deps === null ||
+    typeof deps !== 'object' ||
+    typeof deps.loadState !== 'function' ||
+    typeof deps.saveState !== 'function'
+  ) {
+    return { decision: 'stopped', reason: 'invalid-deps' };
+  }
+  if (
+    deps.clock === null ||
+    typeof deps.clock !== 'object' ||
+    typeof deps.clock.nowMs !== 'function'
+  ) {
+    return { decision: 'stopped', reason: 'invalid-deps' };
+  }
+  const statePath = resolveStatePath(ctx.projectDir);
+  let current: GoalState | null;
+  try {
+    current = await deps.loadState(statePath);
+  } catch {
+    return { decision: 'stopped', reason: 'corrupt-state' };
+  }
+  // No goal or a finished goal: nothing to recover, exit quietly.
+  if (current === null) return { decision: 'skipped', reason: 'no-state' };
+  if (current.status !== 'active') {
+    return { decision: 'skipped', reason: 'stopped-' + current.status };
+  }
+  // Claim the lease before any failure write so it cannot race an idle tick.
+  // Why required: a blind read-modify-write could clear a held lease or lose
+  // a failureCount increment. Without a claimer the caller opted out of it.
+  if (typeof deps.tryClaim === 'function') {
+    let claimed = false;
+    try {
+      const res = await deps.tryClaim(
+        statePath,
+        deps.ownerId ?? 'failure',
+        LEASE_TTL_MS,
+        deps.clock,
+      );
+      claimed = res.claimed;
+      if (res.state !== null) current = res.state;
+    } catch {
+      return { decision: 'stopped', reason: 'claim-failed' };
+    }
+    if (!claimed) return { decision: 'skipped', reason: 'lease-held' };
+  }
+  const now = deps.clock.nowMs();
+  const kind = classifyFailure(err, evType);
+  const sessionId =
+    typeof ctx.sessionId === 'string' && ctx.sessionId.length > 0
+      ? ctx.sessionId
+      : current.lastSessionId;
+  if (kind === 'user-abort') {
+    // Park the goal: an explicit abort must never be auto-resumed.
+    try {
+      await deps.saveState(statePath, {
+        ...current,
+        status: 'interrupted',
+        pendingAttempt: null,
+        recoveryEpoch: current.recoveryEpoch + 1,
+        lastSessionId: sessionId,
+        leaseOwner: null,
+        leaseExpiresAtMs: 0,
+        updatedAtMs: now,
+      });
+    } catch {
+      return { decision: 'stopped', reason: 'save-failed' };
+    }
+    return { decision: 'stopped', reason: 'user-abort-parked' };
+  }
+  // Provider error: record a retry attempt and let the watchdog wake the loop.
+  try {
+    await deps.saveState(statePath, {
+      ...current,
+      pendingAttempt: buildPendingAttempt(current, 'provider-error', now),
+      failureCount: current.failureCount + 1,
+      recoveryEpoch: current.recoveryEpoch + 1,
+      lastSessionId: sessionId,
+      leaseOwner: null,
+      leaseExpiresAtMs: 0,
+      updatedAtMs: now,
+    });
+  } catch {
+    return { decision: 'stopped', reason: 'save-failed' };
+  }
+  return { decision: 'skipped', reason: 'provider-error-retry' };
+}
+
+/**
+ * Settle a failed send: park on a user abort, else record a retry attempt.
+ * Why this helper exists: both the thrown and the non-retryable paths share
+ * one recovery policy, so the classification cannot drift between them.
+ * @param statePath absolute goal state path
+ * @param state the state at claim time
+ * @param deps injected deps (clock, saveState, onTurnSettled)
+ * @param kind failure classification
+ */
+async function settleFailedSend(
+  statePath: string,
+  state: GoalState,
+  deps: IdleDeps,
+  kind: FailureKind,
+  sessionId: string,
+): Promise<IdleDecision> {
+  const now = deps.clock.nowMs();
+  if (kind === 'user-abort') {
+    // Park: an explicit abort must never be auto-retried.
+    try {
+      await deps.saveState(statePath, {
+        ...state,
+        status: 'interrupted',
+        pendingAttempt: null,
+        recoveryEpoch: state.recoveryEpoch + 1,
+        lastSessionId: sessionId,
+        leaseOwner: null,
+        leaseExpiresAtMs: 0,
+        updatedAtMs: now,
+      });
+    } catch {
+      return { decision: 'stopped', reason: 'save-failed' };
+    }
+    try {
+      deps.onTurnSettled?.({ ok: true, deadlineMs: null });
+    } catch {
+      // Settle hook is best-effort.
+    }
+    return { decision: 'stopped', reason: 'user-abort-parked' };
+  }
+  const pending = buildPendingAttempt(state, 'provider-error', now);
+  try {
+    await deps.saveState(statePath, {
+      ...state,
+      pendingAttempt: pending,
+      failureCount: state.failureCount + 1,
+      // Persist the real lane so a restart can rearm the watchdog.
+      lastSessionId: sessionId,
+      leaseOwner: null,
+      leaseExpiresAtMs: 0,
+      updatedAtMs: now,
+    });
+  } catch {
+    // Cleanup failure keeps the send failure as the reported reason.
+  }
+  try {
+    deps.onTurnSettled?.({ ok: false, deadlineMs: pending.deadlineMs });
+  } catch {
+    // Settle hook is best-effort.
+  }
+  return { decision: 'stopped', reason: 'send-failed' };
+}
+
+/**
+ * Build the one-time wrap-up prompt sent when a budget is exhausted.
+ * Why this exists: the loop must tell the agent to stop cleanly instead of
+ * dying silently. Sent at most once, then the persisted flag blocks re-entry.
+ * @param state active goal state
+ * @param reason the budget reason that tripped (max-turns or wall-time)
+ */
+export function buildWrapupPrompt(state: GoalState, reason: string): string {
+  return (
+    'Goal budget reached (' +
+    reason +
+    ') for "' +
+    state.objective +
+    '".\n' +
+    'Stop starting new work. Summarize what is done with evidence and finish now.\n' +
+    'If the objective is met call /goal complete. Otherwise call /goal block <reason>.'
+  );
+}
+
 /**
  * Pure gate for auto-continue.
  * @param state current state or null when no goal file exists
@@ -120,6 +465,8 @@ export function shouldContinue(
   if (state === null) return { ok: false, reason: 'no-state' };
   if (state.status !== 'active')
     return { ok: false, reason: 'stopped-' + state.status };
+  // A sent wrap-up is terminal: never send a second one after the budget hit.
+  if (state.wrapupSent === true) return { ok: false, reason: 'wrapped-up' };
   // Verification in flight pauses auto turns without stopping the goal.
   if (state.pendingVerification === true)
     return { ok: false, reason: 'verification-pending' };
@@ -312,24 +659,89 @@ export async function handleSessionIdle(
         gate.reason.startsWith('stopped-') ||
         gate.reason === 'max-turns' ||
         gate.reason === 'wall-time' ||
+        gate.reason === 'wrapped-up' ||
         gate.reason === 'stop-file';
-      // Wrap-up-once bookkeeping: first budget hit flips wrapupSent true.
-      // Why save here exists: exactly one final marker survives restarts.
-      // Second hit becomes no-op without extra writes. Best-effort only.
+      // Wrap-up-once: on the first budget hit send one final wrap prompt, mark
+      // the persisted flag, then every later hit stops without another send.
       if (
         (gate.reason === 'max-turns' || gate.reason === 'wall-time') &&
         current !== null &&
         (current as GoalState).wrapupSent !== true
       ) {
+        const cur = current as GoalState;
+        // Claim the lease so the wrap send stays single-flight like any turn.
+        let wrapClaimed: { claimed: boolean; state: GoalState | null } | null =
+          null;
+        try {
+          wrapClaimed = await deps.tryClaim(
+            statePath,
+            deps.ownerId,
+            LEASE_TTL_MS,
+            deps.clock,
+          );
+        } catch {
+          wrapClaimed = null;
+        }
+        // Lease not held: skip this tick without flipping the flag so the wrap
+        // can still be sent later. A lost lease must not consume the one wrap.
+        if (wrapClaimed === null || !wrapClaimed.claimed) {
+          return { decision: 'skipped', reason: 'lease-held' };
+        }
+        let wrapOk = false;
+        try {
+          const raw = await deps.sendPrompt(
+            buildWrapupPrompt(cur, gate.reason),
+          );
+          wrapOk = normalizeSendResult(raw).success;
+        } catch {
+          // A thrown wrap send is a failure: do not flip the flag.
+          wrapOk = false;
+        }
+        // Only a real successful wrap marks the goal wrapped.
+        if (wrapOk) {
+          try {
+            await deps.saveState(statePath, {
+              ...cur,
+              wrapupSent: true,
+              leaseOwner: null,
+              leaseExpiresAtMs: 0,
+              updatedAtMs: now,
+            });
+          } catch {
+            // Bookkeeping failure never changes the terminal verdict.
+          }
+          // A completed wrap clears any watchdog: the goal is terminal.
+          try {
+            deps.onTurnSettled?.({ ok: true, deadlineMs: null });
+          } catch {
+            // Settle hook is best-effort.
+          }
+          return { decision: 'stopped', reason: gate.reason };
+        }
+        // Send failed: record a retry attempt and stop without flipping.
+        const wrapPending = buildPendingAttempt(cur, 'provider-error', now);
         try {
           await deps.saveState(statePath, {
-            ...(current as GoalState),
-            wrapupSent: true,
+            ...cur,
+            pendingAttempt: wrapPending,
+            failureCount: cur.failureCount + 1,
+            leaseOwner: null,
+            leaseExpiresAtMs: 0,
             updatedAtMs: now,
           });
         } catch {
-          // Bookkeeping failure never changes the terminal verdict.
+          // Cleanup failure keeps the send failure as the reported reason.
         }
+        // A failed wrap re-arms the watchdog so the wrap can be retried.
+        try {
+          deps.onTurnSettled?.({
+            ok: false,
+            deadlineMs: wrapPending.deadlineMs,
+          });
+        } catch {
+          // Settle hook is best-effort.
+        }
+        return { decision: 'stopped', reason: 'send-failed' };
       }
       return {
         decision: terminal ? 'stopped' : 'skipped',
@@ -363,41 +775,33 @@ export async function handleSessionIdle(
       return { decision: 'skipped', reason: 'lease-held' };
     }
     const prompt = buildContinuationPrompt(claimed.state);
-    let sent: { messageId: string; tokenSpend?: number };
+    let rawSent: unknown;
     try {
-      sent = await deps.sendPrompt(prompt);
-    } catch {
-      // Send failure clears our lease so the next tick can retry, then stops this tick.
-      try {
-        await deps.saveState(statePath, {
-          ...claimed.state,
-          leaseOwner: null,
-          leaseExpiresAtMs: 0,
-          updatedAtMs: deps.clock.nowMs(),
-        });
-      } catch {
-        // Cleanup failure keeps the original send failure as the reported reason.
-      }
-      return { decision: 'stopped', reason: 'send-failed' };
+      rawSent = await deps.sendPrompt(prompt);
+    } catch (err: unknown) {
+      // A thrown send is retryable unless it is a user abort, which parks.
+      return settleFailedSend(
+        statePath,
+        claimed.state,
+        deps,
+        classifyFailure(err),
+        sessionPart,
+      );
     }
-    // Validate the send result: an empty id would poison human-message yield next tick.
-    if (
-      typeof sent !== 'object' ||
-      sent === null ||
-      typeof sent.messageId !== 'string' ||
-      sent.messageId.length === 0
-    ) {
-      try {
-        await deps.saveState(statePath, {
-          ...claimed.state,
-          leaseOwner: null,
-          leaseExpiresAtMs: 0,
-          updatedAtMs: deps.clock.nowMs(),
-        });
-      } catch {
-        // Same cleanup path as a thrown send failure.
-      }
-      return { decision: 'stopped', reason: 'send-failed' };
+    const sent = normalizeSendResult(rawSent);
+    // A failed send never advances the turn and stays retryable for the watchdog.
+    if (!sent.success) {
+      // A non-retryable failure is a user abort: park instead of retrying.
+      const kind: FailureKind = sent.retryable
+        ? 'provider-error'
+        : 'user-abort';
+      return settleFailedSend(
+        statePath,
+        claimed.state,
+        deps,
+        kind,
+        sessionPart,
+      );
     }
     // Post-send timestamp: slow sends must not shorten the real cooldown.
     const afterSend = deps.clock.nowMs();
@@ -408,6 +812,12 @@ export async function handleSessionIdle(
       lastContinuedMessageId: sent.messageId,
       tokenSpend: claimed.state.tokenSpend + safeSpend(sent.tokenSpend),
       updatedAtMs: afterSend,
+      // Success clears the retry episode and records a fresh heartbeat.
+      pendingAttempt: null,
+      lastHeartbeatMs: afterSend,
+      failureCount: 0,
+      // Remember the real session so a restart can rearm the right lane.
+      lastSessionId: sessionPart,
       leaseOwner: null,
       leaseExpiresAtMs: 0,
     };
@@ -422,6 +832,12 @@ export async function handleSessionIdle(
     } catch {
       // Cooldown bookkeeping never blocks a successful send.
     }
+    // A successful turn clears any watchdog: no stale wake should fire.
+    try {
+      deps.onTurnSettled?.({ ok: true, deadlineMs: null });
+    } catch {
+      // Settle hook is best-effort.
+    }
     return { decision: 'sent', reason: 'ok', messageId: sent.messageId };
   } finally {
     // Release only our own token: a successor's guard must survive our exit.
diff --git a/src/state.ts b/src/state.ts
index 1d961f8..ba2beae 100644
--- a/src/state.ts
+++ b/src/state.ts
@@ -6,8 +6,9 @@
 import { promises as fs } from 'node:fs';
 import * as path from 'node:path';
 
-/** Goal lifecycle status. */
-export type GoalStatus = 'active' | 'complete' | 'blocked' | 'cleared';
+/** Goal lifecycle status. Interrupted parks a goal after a user abort. */
+export type GoalStatus =
+  'active' | 'complete' | 'blocked' | 'cleared' | 'interrupted';
 
 /** Clock abstraction to keep business logic mockable. */
 export interface Clock {
@@ -21,6 +22,26 @@ export class SystemClock implements Clock {
   }
 }
 
+/**
+ * Pending continuation attempt for crash and error recovery.
+ * Why this field exists: a failed or interrupted send must be retryable and
+ * survive a restart. Storing first plus last attempt time and count in file
+ * state lets the watchdog and next tick resume without double counting turns.
+ * All timestamps are UTC epoch ms from the injected Clock.
+ */
+export interface PendingAttempt {
+  /** Epoch ms of the first attempt in this retry episode. */
+  firstAttemptMs: number;
+  /** Epoch ms of the most recent attempt. */
+  lastAttemptMs: number;
+  /** How many attempts have been made in this episode. */
+  attemptCount: number;
+  /** Deadline epoch ms after which the watchdog should wake the loop. */
+  deadlineMs: number;
+  /** Last classification: provider-error or user-abort or unknown. */
+  reason: string;
+}
+
 /** Persisted goal state shape. Phase 2 adds turn tracking for the idle loop. */
 export interface GoalState {
   objective: string;
@@ -49,6 +70,23 @@ export interface GoalState {
    * disk so older files still load.
    */
   wrapupSent: boolean;
+  /**
+   * Pending continuation attempt for crash and error recovery.
+   * Null when no retry is outstanding. Persisted so restart can rearm.
+   */
+  pendingAttempt: PendingAttempt | null;
+  /** Epoch ms of the last successful heartbeat turn from the injected Clock. */
+  lastHeartbeatMs: number;
+  /** Consecutive provider failures, reset on a successful turn. */
+  failureCount: number;
+  /** Monotonic epoch bumped on abort or restart to invalidate stale work. */
+  recoveryEpoch: number;
+  /**
+   * Last real session id that touched this goal.
+   * Why this field exists: startup rearm must not invent a fake session lane.
+   * Empty means unknown, so no watchdog is armed until a real event arrives.
+   */
+  lastSessionId: string;
 }
 
 export const STATE_FILENAME = 'goal-state.json';
@@ -101,6 +139,11 @@ export function initialState(
     verificationFailReason: null,
     revisionCount: 0,
     wrapupSent: false,
+    pendingAttempt: null,
+    lastHeartbeatMs: 0,
+    failureCount: 0,
+    recoveryEpoch: 0,
+    lastSessionId: '',
   };
 }
 
@@ -123,7 +166,8 @@ function isValidState(value: unknown): value is GoalState {
     v['status'] !== 'active' &&
     v['status'] !== 'complete' &&
     v['status'] !== 'blocked' &&
-    v['status'] !== 'cleared'
+    v['status'] !== 'cleared' &&
+    v['status'] !== 'interrupted'
   )
     return false;
   if (typeof v['iterationCount'] !== 'number') return false;
@@ -171,6 +215,27 @@ function isValidState(value: unknown): value is GoalState {
     return false;
   // Wrap-up flag stays optional so older files load, then normalize fills it.
   if ('wrapupSent' in v && typeof v['wrapupSent'] !== 'boolean') return false;
+  // Recovery fields stay optional so older files load, then normalize fills them.
+  if ('pendingAttempt' in v) {
+    const pa = v['pendingAttempt'];
+    if (pa !== null) {
+      if (typeof pa !== 'object') return false;
+      const p = pa as Record<string, unknown>;
+      if (typeof p['firstAttemptMs'] !== 'number') return false;
+      if (typeof p['lastAttemptMs'] !== 'number') return false;
+      if (typeof p['attemptCount'] !== 'number') return false;
+      if (typeof p['deadlineMs'] !== 'number') return false;
+      if (typeof p['reason'] !== 'string') return false;
+    }
+  }
+  if ('lastHeartbeatMs' in v && typeof v['lastHeartbeatMs'] !== 'number')
+    return false;
+  if ('failureCount' in v && typeof v['failureCount'] !== 'number')
+    return false;
+  if ('recoveryEpoch' in v && typeof v['recoveryEpoch'] !== 'number')
+    return false;
+  if ('lastSessionId' in v && typeof v['lastSessionId'] !== 'string')
+    return false;
   return true;
 }
 
@@ -192,6 +257,58 @@ export function normalizeState(input: GoalState): GoalState {
     verificationFailReason: input.verificationFailReason ?? null,
     revisionCount: input.revisionCount ?? 0,
     wrapupSent: typeof wrap === 'boolean' ? wrap : false,
+    pendingAttempt: normalizePendingAttempt(
+      (input as unknown as { pendingAttempt?: unknown }).pendingAttempt,
+    ),
+    lastHeartbeatMs:
+      typeof (input as unknown as { lastHeartbeatMs?: unknown })
+        .lastHeartbeatMs === 'number'
+        ? ((input as unknown as { lastHeartbeatMs: number })
+            .lastHeartbeatMs as number)
+        : 0,
+    failureCount:
+      typeof (input as unknown as { failureCount?: unknown }).failureCount ===
+      'number'
+        ? ((input as unknown as { failureCount: number })
+            .failureCount as number)
+        : 0,
+    recoveryEpoch:
+      typeof (input as unknown as { recoveryEpoch?: unknown }).recoveryEpoch ===
+      'number'
+        ? ((input as unknown as { recoveryEpoch: number })
+            .recoveryEpoch as number)
+        : 0,
+    lastSessionId:
+      typeof (input as unknown as { lastSessionId?: unknown }).lastSessionId ===
+      'string'
+        ? ((input as unknown as { lastSessionId: string })
+            .lastSessionId as string)
+        : '',
+  };
+}
+
+/**
+ * Normalize a possibly-missing pendingAttempt field from an older file.
+ * Why this helper exists: normalizeState needs a total conversion without
+ * crashing on undefined, null, or a partial object from disk.
+ * @param raw unknown pendingAttempt value
+ */
+function normalizePendingAttempt(raw: unknown): PendingAttempt | null {
+  if (raw === null || raw === undefined) return null;
+  if (typeof raw !== 'object') return null;
+  const p = raw as Record<string, unknown>;
+  // Every field is required: a partial record is dropped, not trusted.
+  if (typeof p['firstAttemptMs'] !== 'number') return null;
+  if (typeof p['lastAttemptMs'] !== 'number') return null;
+  if (typeof p['attemptCount'] !== 'number') return null;
+  if (typeof p['deadlineMs'] !== 'number') return null;
+  if (typeof p['reason'] !== 'string') return null;
+  return {
+    firstAttemptMs: p['firstAttemptMs'],
+    lastAttemptMs: p['lastAttemptMs'],
+    attemptCount: p['attemptCount'],
+    deadlineMs: p['deadlineMs'],
+    reason: p['reason'],
   };
 }
 
diff --git a/src/watchdog.ts b/src/watchdog.ts
new file mode 100644
index 0000000..bae1f2c
--- /dev/null
+++ b/src/watchdog.ts
@@ -0,0 +1,137 @@
+/**
+ * Watchdog timer for the idle-never-arrives stall.
+ * Why this module exists: the idle-only trigger cannot wake the loop when the
+ * host emits no further event after a crash. A bounded timer re-checks file
+ * state, and every fire goes through the same lease claim plus token guard as
+ * an idle tick, so a wake can never double-send.
+ * The timer handle lives in memory only; the deadline and attempt count live
+ * in file state so a restart can rearm.
+ */
+import type { Clock, GoalState } from './state.js';
+
+/** Default watchdog deadline in ms: wake before the 120s lease TTL expires. */
+export const DEFAULT_MAX_TURN_MS = 90000;
+
+/** In-memory timer handles keyed by projectDir plus sessionId. */
+const watchdogHandles = new Map<string, { timer: unknown }>();
+
+/** Build the composite watchdog key. */
+function watchdogKey(projectDir: string, sessionId: string): string {
+  return projectDir + ':' + sessionId;
+}
+
+/**
+ * Clear one watchdog timer if present.
+ * @param projectDir project root
+ * @param sessionId session lane id
+ */
+export function clearWatchdog(projectDir: string, sessionId: string): void {
+  const key = watchdogKey(projectDir, sessionId);
+  const entry = watchdogHandles.get(key);
+  if (entry === undefined) return;
+  try {
+    // clearTimeout is tolerant of an already-fired or cleared handle.
+    clearTimeout(entry.timer as ReturnType<typeof setTimeout>);
+  } catch {
+    // Clearing an expired handle is a no-op, never an error.
+  }
+  watchdogHandles.delete(key);
+}
+
+/**
+ * Arm one watchdog timer for a session lane.
+ * Why one per key: a second arm replaces the first so a lane never stacks
+ * timers. The handle is unref'd when the runtime supports it so a pending
+ * wake never keeps the process alive by itself.
+ * @param projectDir project root
+ * @param sessionId session lane id
+ * @param deadlineMs absolute epoch ms after which the wake should fire
+ * @param clock injected clock used only for the delay math
+ * @param onFire async callback invoked once when the timer fires
+ */
+export function armWatchdog(
+  projectDir: string,
+  sessionId: string,
+  deadlineMs: number,
+  clock: Clock,
+  onFire: () => Promise<void>,
+): void {
+  // Replace any existing timer for this lane so we never double-fire.
+  clearWatchdog(projectDir, sessionId);
+  const now = clock.nowMs();
+  // Validate the deadline: a NaN, infinite, or negative value from corrupt
+  // state must not tight-loop. Fall back to the default window from the clock.
+  const safeDeadline =
+    typeof deadlineMs === 'number' &&
+    Number.isFinite(deadlineMs) &&
+    deadlineMs >= 0
+      ? deadlineMs
+      : now + DEFAULT_MAX_TURN_MS;
+  // Cap the delay to a sane minimum so a past deadline still wakes promptly.
+  const delay = Math.max(1000, safeDeadline - now);
+  // Bound the map: evict the oldest lane before adding a new one.
+  if (
+    watchdogHandles.size >= 500 &&
+    !watchdogHandles.has(watchdogKey(projectDir, sessionId))
+  ) {
+    const oldest = watchdogHandles.keys().next();
+    if (!oldest.done) watchdogHandles.delete(oldest.value);
+  }
+  const timer = setTimeout(() => {
+    // Remove the handle first: the lane is no longer armed.
+    watchdogHandles.delete(watchdogKey(projectDir, sessionId));
+    void onFire().catch(() => undefined);
+  }, delay);
+  // unref keeps a parked wake from blocking process exit.
+  const handle = timer as unknown as { unref?: () => void };
+  if (typeof handle.unref === 'function') {
+    handle.unref();
+  }
+  watchdogHandles.set(watchdogKey(projectDir, sessionId), { timer });
+}
+
+/**
+ * Rearm a watchdog from persisted state when a retry is outstanding.
+ * Why this exists: after a restart the in-memory timer is gone, but the
+ * pending attempt and its deadline survive in the state file.
+ * @param projectDir project root
+ * @param sessionId session lane id
+ * @param state current goal state
+ * @param clock injected clock
+ * @param onFire async callback invoked once when the timer fires
+ */
+export function rearmFromState(
+  projectDir: string,
+  sessionId: string,
+  state: GoalState,
+  clock: Clock,
+  onFire: () => Promise<void>,
+): void {
+  const pending = state.pendingAttempt;
+  // Guard null and undefined so a partial file never arms a timer.
+  if (pending === null || pending === undefined) return;
+  // Only rearm while the goal can still make progress.
+  if (state.status !== 'active') return;
+  armWatchdog(projectDir, sessionId, pending.deadlineMs, clock, onFire);
+}
+
+/**
+ * Reset all timers for tests only.
+ */
+export function _resetWatchdogsForTests(): void {
+  for (const entry of watchdogHandles.values()) {
+    try {
+      clearTimeout(entry.timer as ReturnType<typeof setTimeout>);
+    } catch {
+      // Best-effort cleanup only.
+    }
+  }
+  watchdogHandles.clear();
+}
+
+/**
+ * Read the count of armed watchdogs for diagnostics and tests.
+ */
+export function watchdogCount(): number {
+  return watchdogHandles.size;
+}
diff --git a/tests/goal.test.ts b/tests/goal.test.ts
index 644d0db..958a1dc 100644
--- a/tests/goal.test.ts
+++ b/tests/goal.test.ts
@@ -28,6 +28,7 @@ describe('parseGoalCommand', () => {
     expect(parseGoalCommand('/goal status')).toEqual({ kind: 'status' });
     expect(parseGoalCommand('/goal clear')).toEqual({ kind: 'clear' });
     expect(parseGoalCommand('/goal complete')).toEqual({ kind: 'complete' });
+    expect(parseGoalCommand('/goal resume')).toEqual({ kind: 'resume' });
   });
   it('rejects empty and overlong', () => {
     expect(parseGoalCommand('/goal   ').kind).toBe('invalid');
diff --git a/tests/improvement.test.ts b/tests/improvement.test.ts
index fad1011..0c8b908 100644
--- a/tests/improvement.test.ts
+++ b/tests/improvement.test.ts
@@ -146,7 +146,7 @@ describe('H1-H4 integration proofs', () => {
     const second = await tryClaimLease(sp, 'holder-B', LEASE_TTL_MS, clock);
     expect(second.claimed).toBe(false);
   });
-  it('wrapup flips once on budget hit then stays silent', async () => {
+  it('wrapup sends once on budget hit then stays silent', async () => {
     const { handleSessionIdle, _resetIdleInFlightForTests } =
       await import('../src/loop.js');
     const { initialState } = await import('../src/state.js');
@@ -164,6 +164,7 @@ describe('H1-H4 integration proofs', () => {
       wrapupSent: false,
     };
     const store = { state: base as typeof base | null };
+    const sent: string[] = [];
     let saves = 0;
     const deps = {
       clock,
@@ -174,8 +175,12 @@ describe('H1-H4 integration proofs', () => {
         saves += 1;
         store.state = s;
       },
-      tryClaim: async () => ({ claimed: false, state: store.state }),
-      sendPrompt: async () => ({ messageId: 'm1' }),
+      // Claim succeeds so the one-time wrap send actually fires.
+      tryClaim: async () => ({ claimed: true, state: store.state }),
+      sendPrompt: async (p: string) => {
+        sent.push(p);
+        return { success: true as const, messageId: 'wrap-1' };
+      },
       hasStopFile: async () => false,
     };
     const first = await handleSessionIdle(
@@ -184,12 +189,16 @@ describe('H1-H4 integration proofs', () => {
     );
     expect(first.reason).toBe('max-turns');
     expect(store.state?.wrapupSent).toBe(true);
+    expect(sent.length).toBe(1);
+    expect(sent[0]).toContain('budget reached');
     const savesAfterFirst = saves;
     const second = await handleSessionIdle(
       { projectDir: '/tmp/wrap1', lastMessageId: null },
       deps as never,
     );
-    expect(second.reason).toBe('max-turns');
+    // Wrapped-up is terminal: no second wrap send, no extra save.
+    expect(second.reason).toBe('wrapped-up');
+    expect(sent.length).toBe(1);
     expect(saves).toBe(savesAfterFirst);
   });
   it('two loop ticks same project different sessions both send', async () => {
diff --git a/tests/recovery.test.ts b/tests/recovery.test.ts
new file mode 100644
index 0000000..bea2fe4
--- /dev/null
+++ b/tests/recovery.test.ts
@@ -0,0 +1,421 @@
+/**
+ * Crash and error recovery regression tests.
+ * Why these tests exist: an active goal must survive a failed send, a provider
+ * error, and a restart. They prove the retryable send, the failure
+ * classification, the watchdog wake, the resume rearm, and the wrap-once rule
+ * without a live host.
+ */
+import { describe, expect, it } from 'vitest';
+import {
+  _resetIdleInFlightForTests,
+  buildPendingAttempt,
+  buildWrapupPrompt,
+  classifyFailure,
+  handleSessionFailure,
+  handleSessionIdle,
+  normalizeSendResult,
+  shouldContinue,
+} from '../src/loop.js';
+import type { IdleDeps } from '../src/loop.js';
+import {
+  DEFAULT_LIMITS,
+  _resetPerSessionCooldownForTests,
+} from '../src/limits.js';
+import { initialState, normalizeState } from '../src/state.js';
+import type { Clock, GoalState } from '../src/state.js';
+import {
+  armWatchdog,
+  clearWatchdog,
+  watchdogCount,
+  _resetWatchdogsForTests,
+} from '../src/watchdog.js';
+
+/** Fixed clock with mutable now. */
+class FakeClock implements Clock {
+  constructor(public now: number) {}
+  nowMs(): number {
+    return this.now;
+  }
+}
+
+/** Fresh active state with overrides. */
+function makeActive(
+  clock: FakeClock,
+  over: Partial<GoalState> = {},
+): GoalState {
+  return { ...initialState('recover goal', clock, '2.0.29'), ...over };
+}
+
+/** Minimal deps with a scripted send result. */
+function makeDeps(
+  store: { state: GoalState | null },
+  clock: FakeClock,
+  sendResult: unknown,
+  extra: Partial<IdleDeps> = {},
+): IdleDeps {
+  return {
+    clock,
+    limits: DEFAULT_LIMITS,
+    ownerId: 'owner-R',
+    loadState: async () => store.state,
+    saveState: async (_p, s) => {
+      store.state = s;
+    },
+    tryClaim: async () => {
+      if (store.state === null) return { claimed: false, state: null };
+      return { claimed: true, state: store.state };
+    },
+    sendPrompt: async () => sendResult as never,
+    hasStopFile: async () => false,
+    ...extra,
+  };
+}
+
+describe('D1 retryable send', () => {
+  it('normalizes a legacy result and a failure', () => {
+    expect(normalizeSendResult({ messageId: 'm1' }).success).toBe(true);
+    expect(normalizeSendResult({ messageId: '' }).success).toBe(false);
+    expect(normalizeSendResult(null).success).toBe(false);
+    const fail = normalizeSendResult({ success: true, messageId: '' });
+    expect(fail.success).toBe(false);
+  });
+  it('failed send does not advance the turn and records an attempt', async () => {
+    _resetIdleInFlightForTests();
+    _resetPerSessionCooldownForTests();
+    const clock = new FakeClock(1700000000000);
+    const store = {
+      state: makeActive(clock, { lastTurnAtMs: 0 }) as GoalState | null,
+    };
+    const deps = makeDeps(store, clock, {
+      success: false,
+      error: 'provider down',
+      retryable: true,
+    });
+    const got = await handleSessionIdle(
+      { projectDir: '/tmp/rec1', lastMessageId: null },
+      deps,
+    );
+    expect(got.reason).toBe('send-failed');
+    // Turn count stays put so the failed attempt can be retried.
+    expect(store.state?.iterationCount).toBe(0);
+    expect(store.state?.pendingAttempt).not.toBeNull();
+    expect(store.state?.failureCount).toBe(1);
+  });
+});
+
+describe('D2 failure classification plus handler', () => {
+  it('classifies abort versus provider error', () => {
+    expect(classifyFailure({ name: 'MessageAbortedError' })).toBe('user-abort');
+    expect(classifyFailure('aborted by user')).toBe('user-abort');
+    // A bare "aborted" is ambiguous: a transport can abort too, so without an
+    // interrupted hint it stays a retryable provider error.
+    expect(classifyFailure('operation was aborted')).toBe('provider-error');
+    expect(
+      classifyFailure('operation was aborted', 'session.execution.interrupted'),
+    ).toBe('user-abort');
+    expect(classifyFailure('provider aborted connection')).toBe(
+      'provider-error',
+    );
+    expect(classifyFailure('request timeout')).toBe('provider-error');
+    expect(classifyFailure('ECONNRESET')).toBe('provider-error');
+    expect(classifyFailure(undefined)).toBe('provider-error');
+  });
+  it('user abort parks the goal and clears the attempt', async () => {
+    const clock = new FakeClock(1700000000000);
+    const store = { state: makeActive(clock) as GoalState | null };
+    const got = await handleSessionFailure(
+      { projectDir: '/tmp/rec2', sessionId: 's1' },
+      {
+        clock,
+        loadState: async () => store.state,
+        saveState: async (_p, s) => {
+          store.state = s;
+        },
+      },
+      { name: 'MessageAbortedError' },
+    );
+    expect(got.reason).toBe('user-abort-parked');
+    expect(store.state?.status).toBe('interrupted');
+    expect(store.state?.pendingAttempt).toBeNull();
+  });
+  it('provider error records a retry attempt', async () => {
+    const clock = new FakeClock(1700000000000);
+    const store = { state: makeActive(clock) as GoalState | null };
+    const got = await handleSessionFailure(
+      { projectDir: '/tmp/rec3', sessionId: 's1' },
+      {
+        clock,
+        loadState: async () => store.state,
+        saveState: async (_p, s) => {
+          store.state = s;
+        },
+      },
+      'fetch failed',
+    );
+    expect(got.reason).toBe('provider-error-retry');
+    expect(store.state?.status).toBe('active');
+    expect(store.state?.pendingAttempt).not.toBeNull();
+    expect(store.state?.failureCount).toBe(1);
+  });
+});
+
+describe('D3 watchdog', () => {
+  it('arms, fires once, and clears', async () => {
+    _resetWatchdogsForTests();
+    const clock = new FakeClock(1700000000000);
+    let fired = 0;
+    armWatchdog('/tmp/w1', 's1', clock.nowMs() + 1000, clock, async () => {
+      fired += 1;
+    });
+    expect(watchdogCount()).toBe(1);
+    await new Promise((r) => setTimeout(r, 1100));
+    expect(fired).toBe(1);
+    // Handle removed after firing: no stale re-fire.
+    expect(watchdogCount()).toBe(0);
+    clearWatchdog('/tmp/w1', 's1');
+    expect(watchdogCount()).toBe(0);
+  });
+});
+
+describe('D5 wrap-once prompt', () => {
+  it('wrap prompt names the objective and stop verbs', () => {
+    const clock = new FakeClock(1700000000000);
+    const p = buildWrapupPrompt(makeActive(clock), 'max-turns');
+    expect(p).toContain('recover goal');
+    expect(p).toContain('budget reached');
+    expect(p).toContain('complete');
+  });
+  it('gate stops once the wrap flag is set', () => {
+    const clock = new FakeClock(1700000000000);
+    const wrapped = makeActive(clock, { wrapupSent: true });
+    expect(
+      shouldContinue(wrapped, clock.now, null, DEFAULT_LIMITS).reason,
+    ).toBe('wrapped-up');
+  });
+});
+
+describe('D6 persisted guards', () => {
+  it('pending attempt survives a reload and normalize fills old files', () => {
+    const clock = new FakeClock(1700000000000);
+    const withAttempt = {
+      ...makeActive(clock),
+      pendingAttempt: buildPendingAttempt(
+        makeActive(clock),
+        'provider-error',
+        clock.nowMs(),
+      ),
+      lastHeartbeatMs: clock.nowMs(),
+      failureCount: 2,
+      recoveryEpoch: 3,
+    };
+    const reloaded = normalizeState(
+      JSON.parse(JSON.stringify(withAttempt)) as GoalState,
+    );
+    expect(reloaded.pendingAttempt?.attemptCount).toBe(1);
+    expect(reloaded.failureCount).toBe(2);
+    expect(reloaded.recoveryEpoch).toBe(3);
+    // An older file without the recovery fields still loads with defaults.
+    const legacy = JSON.parse(JSON.stringify(makeActive(clock))) as Record<
+      string,
+      unknown
+    >;
+    delete legacy['pendingAttempt'];
+    delete legacy['lastHeartbeatMs'];
+    delete legacy['failureCount'];
+    delete legacy['recoveryEpoch'];
+    const norm = normalizeState(legacy as unknown as GoalState);
+    expect(norm.pendingAttempt).toBeNull();
+    expect(norm.lastHeartbeatMs).toBe(0);
+    expect(norm.failureCount).toBe(0);
+    expect(norm.recoveryEpoch).toBe(0);
+  });
+});
+
+describe('hotfix guards', () => {
+  it('failure path skips when the lease is held', async () => {
+    const clock = new FakeClock(1700000000000);
+    const store = { state: makeActive(clock) as GoalState | null };
+    let saves = 0;
+    const got = await handleSessionFailure(
+      { projectDir: '/tmp/hx1', sessionId: 's1' },
+      {
+        clock,
+        loadState: async () => store.state,
+        saveState: async () => {
+          saves += 1;
+        },
+        tryClaim: async () => ({ claimed: false, state: store.state }),
+        ownerId: 'hf',
+      },
+      'fetch failed',
+    );
+    expect(got.reason).toBe('lease-held');
+    // A held lease must not be clobbered by the failure write.
+    expect(saves).toBe(0);
+  });
+  it('non-retryable send parks the goal', async () => {
+    _resetIdleInFlightForTests();
+    _resetPerSessionCooldownForTests();
+    const clock = new FakeClock(1700000000000);
+    const store = {
+      state: makeActive(clock, { lastTurnAtMs: 0 }) as GoalState | null,
+    };
+    const deps = makeDeps(store, clock, {
+      success: false,
+      error: 'aborted by user',
+      retryable: false,
+    });
+    const got = await handleSessionIdle(
+      { projectDir: '/tmp/hx2', lastMessageId: null },
+      deps,
+    );
+    expect(got.reason).toBe('user-abort-parked');
+    expect(store.state?.status).toBe('interrupted');
+    expect(store.state?.pendingAttempt).toBeNull();
+  });
+  it('interrupted goal resumes via resumeGoal', async () => {
+    const { resumeGoal } = await import('../src/goal.js');
+    const clock = new FakeClock(1700000000000);
+    const parked = makeActive(clock, { status: 'interrupted' });
+    const resumed = resumeGoal(parked, clock);
+    expect(resumed.status).toBe('active');
+    expect(resumed.recoveryEpoch).toBe(1);
+    // Active goals cannot resume again.
+    expect(() => resumeGoal(resumed, clock)).toThrow();
+  });
+  it('wrap does not flip when the lease is not claimed', async () => {
+    _resetIdleInFlightForTests();
+    const clock = new FakeClock(1700000000000);
+    const store = {
+      state: makeActive(clock, {
+        iterationCount: 30,
+        wrapupSent: false,
+      }) as GoalState | null,
+    };
+    const sent: string[] = [];
+    const deps = makeDeps(
+      store,
+      clock,
+      { success: true, messageId: 'w1' },
+      {
+        tryClaim: async () => ({ claimed: false, state: store.state }),
+        sendPrompt: async (p: string) => {
+          sent.push(p);
+          return { success: true as const, messageId: 'w1' };
+        },
+      },
+    );
+    const got = await handleSessionIdle(
+      { projectDir: '/tmp/hx3', lastMessageId: null },
+      deps,
+    );
+    expect(got.reason).toBe('lease-held');
+    expect(sent.length).toBe(0);
+    // Flag stays false so the wrap can still be sent later.
+    expect(store.state?.wrapupSent).toBe(false);
+  });
+  it('corrupt deadline does not tight-loop', async () => {
+    _resetWatchdogsForTests();
+    const clock = new FakeClock(1700000000000);
+    let fired = 0;
+    armWatchdog('/tmp/hx4', 's1', Number.NaN, clock, async () => {
+      fired += 1;
+    });
+    // A NaN deadline falls back to the default window, so nothing fires now.
+    expect(fired).toBe(0);
+    await new Promise((r) => setTimeout(r, 50));
+    expect(fired).toBe(0);
+    clearWatchdog('/tmp/hx4', 's1');
+    expect(watchdogCount()).toBe(0);
+  });
+  it('rearm treats undefined pending as none', async () => {
+    const { rearmFromState } = await import('../src/watchdog.js');
+    _resetWatchdogsForTests();
+    const clock = new FakeClock(1700000000000);
+    const state = {
+      ...makeActive(clock),
+      pendingAttempt: undefined as never,
+    };
+    rearmFromState('/tmp/hx5', 's1', state, clock, async () => undefined);
+    expect(watchdogCount()).toBe(0);
+  });
+  it('failed send persists the real session lane', async () => {
+    _resetIdleInFlightForTests();
+    _resetPerSessionCooldownForTests();
+    const clock = new FakeClock(1700000000000);
+    const store = {
+      state: makeActive(clock, {
+        lastTurnAtMs: 0,
+        lastSessionId: '',
+      }) as GoalState | null,
+    };
+    const deps = makeDeps(store, clock, {
+      success: false,
+      error: 'provider down',
+      retryable: true,
+    });
+    await handleSessionIdle(
+      { projectDir: '/tmp/hx6', lastMessageId: null, sessionId: 'sess-9' },
+      deps,
+    );
+    // A restart can now rearm the exact lane from persisted state.
+    expect(store.state?.lastSessionId).toBe('sess-9');
+    expect(store.state?.pendingAttempt).not.toBeNull();
+  });
+  it('wrap settles the watchdog on success and failure', async () => {
+    _resetIdleInFlightForTests();
+    _resetPerSessionCooldownForTests();
+    const clock = new FakeClock(1700000000000);
+    const mk = (wrapOk: boolean) => {
+      const store = {
+        state: makeActive(clock, {
+          iterationCount: 30,
+          wrapupSent: false,
+        }) as GoalState | null,
+      };
+      const settled: { ok: boolean; deadlineMs: number | null }[] = [];
+      const deps = makeDeps(store, clock, null, {
+        tryClaim: async () => ({ claimed: true, state: store.state }),
+        sendPrompt: async () =>
+          wrapOk
+            ? { success: true as const, messageId: 'w1' }
+            : { success: false as const, error: 'down', retryable: true },
+        onTurnSettled: (r) => settled.push(r),
+      });
+      return { deps, settled, store };
+    };
+    const ok = mk(true);
+    const a = await handleSessionIdle(
+      { projectDir: '/tmp/hx7', lastMessageId: null },
+      ok.deps,
+    );
+    expect(a.reason).toBe('max-turns');
+    expect(ok.settled[0]?.ok).toBe(true);
+    expect(ok.store.state?.wrapupSent).toBe(true);
+    _resetIdleInFlightForTests();
+    _resetPerSessionCooldownForTests();
+    const bad = mk(false);
+    const b = await handleSessionIdle(
+      { projectDir: '/tmp/hx8', lastMessageId: null },
+      bad.deps,
+    );
+    expect(b.reason).toBe('send-failed');
+    expect(bad.settled[0]?.ok).toBe(false);
+    expect(typeof bad.settled[0]?.deadlineMs).toBe('number');
+    // Flag stays false so the wrap can still be retried.
+    expect(bad.store.state?.wrapupSent).toBe(false);
+  });
+  it('buildPendingAttempt tolerates undefined pending', () => {
+    const clock = new FakeClock(1700000000000);
+    const state = {
+      ...makeActive(clock),
+      pendingAttempt: undefined as never,
+    };
+    expect(() =>
+      buildPendingAttempt(state, 'provider-error', clock.nowMs()),
+    ).not.toThrow();
+    expect(
+      buildPendingAttempt(state, 'provider-error', clock.nowMs()).attemptCount,
+    ).toBe(1);
+  });
+});
```
<!-- END_GIT_DIFF -->
