# Task 16: stop the idle loop from spending turns on a human gate, and unbreak evidence when a cited file moves

**File:** `tasks/backlog/16-idle-loop-human-gate-and-movable-citations.md`
**Source:** manager (2026-11-03, after one long session where the plugin fired repeated continuation prompts while the agent was correctly parked waiting for a manager decision, and where completion was blocked three times because a cited task file had moved lanes)
**Type:** improvement
**Status:** open

## Goal

Two behaviours cost real time in one session, and both are structural rather than user error:

1. **The idle loop cannot tell "blocked on a human" from "work left".** It kept injecting `Continue goal: …` turns while the agent was waiting for an approval decision, so the agent repeated its status message instead of doing nothing. The only brakes are `maxTurns` (30) and `maxWallMs` (2 h), which means an unresolved human gate can burn the entire turn budget before anything stops it.
2. **Evidence citations are resolved as live filesystem paths at completion time.** A cited file that legitimately moves between lanes (`tasks/qa/x.md` → `tasks/completed/x.md`) turns a correct body of work into `evidence-invalid — missing-file:<id>:<path>`, and the only remedy is amending the criterion.

Target: a parked goal stops spending turns on its own, and a citation that moved within the project still proves the criterion.

## Problem

### P1 — no human-gate state, so idle ticks keep firing

`shouldContinue` (`src/loop.ts:472`) yields on exactly these conditions: no state, status not `active`, `wrapupSent`, `pendingVerification`, `STOP_GOAL` present, a message id that moved past our last continuation, budget, and cooldown. There is no condition for "the last turn ended by asking the human a question and no answer has arrived".

Observed sequence: the agent asked for an approval decision, the manager answered "wait", the agent held, and the loop resumed as soon as the session idled. Each resume produced another continuation turn whose entire output was a restatement of the wait. `buildContinuationPrompt` (`src/loop.ts:512`) instructs "Do not repeat questions", but the prompt itself is the repetition trigger.

The designed remedy exists — `goal_block` (`src/tools.ts:737`) sets status `blocked`, and `shouldContinue` then returns `stopped-blocked`. It was not used, because nothing in the loop surfaces that "you are burning turns while waiting" until the budget is gone.

### P2 — citations are paths, not identities

`verifyEvidence` stats every cited file (`src/verifier.ts:190-200`) and reports `missing-file:<criterion>:<path>` on any miss. Record-time validation only checks the shape and non-emptiness of the array (`src/evidence.ts:136`), so nothing pins the citation to a stable identity.

Observed three times in one session: evidence recorded against `tasks/qa/<file>.md`, the task then moved to `tasks/completed/<file>.md` as part of normal Kanban flow, completion refused, criterion amended with the new path. The work was always correct; only the location changed. This punishes the exact workflow the project mandates (lane moves) and trains the operator to record citations late or loosely.

### P3 — no-progress detection is absent

Nothing counts consecutive continuation turns that produced no tool call, no state change, and no new evidence. A goal that is genuinely stuck (or waiting) is indistinguishable from a productive one until the turn budget expires.

## Scope

Ordered by value. Each item independent.

1. **Park-on-repetition (P1/P3).** Track continuation turns that ended with no tool invocation and no state mutation. After a small threshold (2–3), stop auto-continuing and emit one message telling the operator the goal is idle awaiting input, naming both remedies: answer, or `goal_block <reason>`. Reuse the existing failure/park plumbing rather than adding a third status.
2. **Explicit human-gate hint (P1).** When the last assistant turn used the `question` tool or ended in prose asking for a decision, treat the goal as parked for the next tick. The `question` tool call is already observable on the message; the prose case can stay best-effort.
3. **Movable citations (P2).** Resolve a missing citation by basename anywhere under the project before failing, and record which path actually satisfied it in the failure-free path. Keep the strict traversal guard (`isCitationInsideProjectDir`) exactly as is. If nothing matches by basename, fail as today.
4. **Citation identity option (P2, optional).** Accept an optional content hash per file at record time so a moved-and-edited file can still prove identity. Only if item 3 proves insufficient.
5. **Message clarity (minor).** `Only an active goal can record evidence. Current status: complete.` should name the remedy (`call goal_set first`), since that exact dead end was hit after a completion.

## Acceptance Criteria

- [ ] A goal parked while awaiting a human answer stops auto-continuing within at most 3 ticks, and the stop message names `goal_block` as the explicit remedy.
- [ ] A continuation turn that ends with no tool call and no state change counts toward that threshold; a productive turn resets it.
- [ ] A criterion citing `tasks/qa/x.md` still proves after the file is moved to `tasks/completed/x.md`, and the report states which path satisfied it.
- [ ] A citation pointing outside the project still fails as `traversal-escape`, unchanged.
- [ ] A citation with no basename match anywhere in the project still fails as `missing-file`, unchanged.
- [ ] Recording evidence against a completed goal returns a message naming `goal_set`, and a test pins that wording.
- [ ] The existing suite stays green; no test is weakened to accommodate a behavioural change.

## Verification Evidence

- **Test command:** `npm run typecheck && npm test` (vitest per `package.json` scripts)
- **Expected result:** existing suites green; new tests for park-on-repetition, movable citation resolution, traversal-escape regression, and the complete-goal message
- **Actual result:** _(The Hands fill this during execution)_
- **Exit code:** _(The Hands fill this during execution)_

## Definition of Done

- [ ] `npm run typecheck` and `npm test` exit 0
- [ ] `lint_task_file` passes on this file; `CHANGELOG.md` carries one line per shipped item
- [ ] Each of P1/P2/P3 is either fixed or explicitly deferred with a one-line reason in the Execution Log
- [ ] The DECISIONS.md entry explains why basename resolution is safe under the existing traversal guard

## Local TODOs

- [ ] Reproduce P1 with a fixture: active goal, continuation sent, no human reply, assert N ticks then park
- [ ] Reproduce P2 with a fixture: record a citation, move the file, assert completion still passes
- [ ] Confirm where the last assistant message exposes a `question` tool call so item 2 has a real signal
- [ ] Check whether basename resolution should search only `tasks/` and known doc roots rather than the whole project, to keep it cheap on large repos

## Risk & Rollback

- **Risk 1 — parking too eagerly.** A productive loop that happens to make no tool call twice could be parked prematurely. Mitigation: threshold of 2–3, reset on any tool call or state change, and the park message is recoverable with a single `goal_set`/`goal_resume`.
- **Risk 2 — basename ambiguity.** Two files sharing a name could satisfy the wrong citation. Mitigation: prefer an exact-path hit, then a basename hit only when it is unique; report ambiguity as a failure naming both candidates rather than guessing.
- **Risk 3 — silent verification weakening.** Any resolution change could hide a genuinely deleted file. Mitigation: keep `missing-file` for the no-match case and assert it in a test.
- **Rollback:** all three items are internal decisions behind existing messages and the same verifier entry point. Reverting restores the current strict path resolution and unconditional continuation.

## Execution Log & Reasoning

- **Implementation (lane 2, 2026-11-03):** park-on-repetition with a persisted `idleParked` latch and `IDLE_PARK_THRESHOLD = 2` (goal stays `active`, so `goal_block` remains callable and `goal_resume` gained the active-but-parked case); `question`-tool detection through `session.tool.input.started`, withheld until the lane proves it emits tool events so a silent host can never park a productive goal; citation resolution in `src/verifier.ts` — exact path first, then a unique basename under the project, `ambiguous-citation` naming candidates, `missing-file` preserved, traversal guard untouched and still first; completed-goal evidence message now names `goal_set`. Verified: typecheck 0, tests 0 (212, was 193), format 0, HEAD unchanged.
- **Review round 1 (2026-11-03): APPROVED / PO_REVIEW_PENDING.** Reviewer confirmed all six attack points: the latch cannot deadlock (cleared on block/complete/clear/resume/set, on every successful send, and on newer human input, with `resumeGoal` accepting active-plus-parked); the basename fallback cannot escape the project or prove a wrong file when two candidates share a name; the threshold is honest because any tool call or `progressKey` change resets the streak; host-event absence disarms the park instead of parking wrongly; no existing test was weakened (failures additive, state fields defaulted); docs match code.
- **Disputed nit (evidence, not opinion):** the review reported `idle-park.test.ts` holds 12 tests while `CHANGELOG.md` says 13. `npx vitest run tests/idle-park.test.ts` reports **13 passed**, matching the changelog. No change made — the documentation is correct and the count nit is a miscount.
- **Accepted limitation (recorded, deferred by scope):** basename resolution proves name identity, not content identity, so a deleted file whose basename survives uniquely elsewhere would pass as moved. The task's optional content-hash item was deliberately skipped; this limitation is now written down rather than implied.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 9c148b4..d16fa6f 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -6,6 +6,12 @@ All notable changes follow Keep a Changelog.
 
 ### Added
 
+- The idle loop now parks on a human gate instead of spending turns on it: `loop.ts` counts consecutive continuation turns that made no tool call and left the goal state unchanged (`scoreContinuationTurn`, `IDLE_PARK_THRESHOLD = 2`), stops auto-continuing, and posts exactly one message naming `goal_block <reason>` and `goal_resume`. The `question` tool parks the next tick immediately, any tool call or foreign state write resets the streak, and the goal stays `active` — a latch (`idleParked`) replaces any new status, so `goal_block` is callable at once and `goal_resume` gains the active-and-parked case. The wiring reads `session.tool.input.started` / `session.tool.called` and withholds the observation until the lane has proven it reports tool activity, so a host that stays silent cannot park a productive goal. 13 new tests.
+
+- Evidence citations survive a lane move: `verifyLocal` resolves the exact path first, then a unique basename anywhere under the project, and reports the path that satisfied the criterion on `LocalVerifyResult.citations` plus the success reason. Two same-named files fail as `ambiguous-citation` naming the candidates (never a silent guess), no match keeps `missing-file`, and `isCitationInsideProjectDir` is untouched, so a citation outside the project still fails as `traversal-escape`. The search is bounded (50 000 entries, depth 12, 32 matches, symlinks refused, build output skipped). 5 new tests.
+
+- Recording evidence against a completed goal now names the remedy: `Only an active goal can record evidence. Current status: complete. Call goal_set first to start a new goal.` 1 test pins the wording.
+
 - Re-recording an existing evidence id now amends the criterion instead of rejecting it: the previous version (claim, files, tests, `replacedAtMs`) is kept in a visible `history` array capped at 10, the verifier checks current criteria only, and the reply distinguishes `Criterion recorded` from `Criterion amended`. Closes the known limitation ADR-012 left open — a legitimately-moved citation (Kanban lane promotion, rename) is correctable in place while the audit trail stays readable.
 
 - A blocked `goal_complete` now names what failed: `describeVerificationFailure` quotes the verifier's concrete reasons (`test-failed:<id>:exit=N`, `missing-file:<id>:<path>`, `test-budget:<id>`) for both the tool and slash lanes, capped at five with `(+N more)`, instead of one canned sentence that told the agent to add citations even when the citations were fine. Reproduced live on a JDK-mismatch proof run. Evidence tests may now carry an optional flat `env` string map, validated as strings and merged into the child environment last, so a project can pin the toolchain its command actually needs. 9 new tests (including a no-leak-across-criteria check); full suite 187 green.
diff --git a/DECISIONS.md b/DECISIONS.md
index 08726c6..e5a7807 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -71,3 +71,15 @@ Context: ADR-012 left a known limitation open — `goal_evidence` rejected a reu
 Decision: re-recording an existing id replaces the criterion and appends the previous version (claim, files, tests, `replacedAtMs` from the injected Clock) to a `history` array on the new criterion, capped at `MAX_CRITERION_HISTORY` (10, oldest dropped) so a replace loop cannot bloat the sidecar. `validateEvidenceShape` accepts the optional field with strict per-entry checks; the verifier reads current criteria only and never looks at history, so a stale path kept there cannot fail proof. The tool lane and the slash lane share the single writer, so both gain the amend path at once; the reply distinguishes `Criterion recorded` (new id) from `Criterion amended` (existing id).
 
 Consequence: a legitimately-moved citation is correctable in place while the old citation stays readable in the sidecar — the audit trail, and the goalposts, do not move unseen. Rollback: restore the duplicate-id rejection in the writer and drop the `history` field, its validation, and the cap.
+
+## ADR-016 2026-11-03 A human gate stops the loop, and a citation survives a lane move
+
+Context: one long session exposed two structural costs. The idle loop could not tell "blocked on a human" from "work left": the only brakes were `maxTurns` (30) and `maxWallMs` (2 h), so an unresolved approval gate burned the whole turn budget while each continuation turn restated the same wait. Separately, evidence citations were resolved as live filesystem paths at completion time, so a cited task file that legitimately moved from `tasks/qa/` to `tasks/completed/` — the project's own mandated Kanban flow — turned correct work into `evidence-invalid — missing-file:<id>:<path>`, cured only by amending the criterion.
+
+Decision, part one (idle park). `GoalState` gains `noProgressTurns`, `idleParked`, `lastTurnKey`, `lastScoredTurnId`, all optional on disk and normalized for older files. The pure loop scores exactly one observation per continuation (`scoreContinuationTurn`): a tool call, or a change to the stamped fields (`progressKey`), resets the streak; otherwise the streak grows, and `IDLE_PARK_THRESHOLD` (2) consecutive empty turns stop the loop and post one message that names `goal_block <reason>` and `goal_resume`. The `question` tool sets an explicit human gate that parks on the very next tick regardless of the streak. No lifecycle value is invented: the goal stays `active`, only the loop pauses, so `goal_block` is callable immediately and `goal_resume` gains the one extra accepted case (active + `idleParked`). The one-shot post reuses the budget wrap-up plumbing (`sendOneShotStop`: claim, send once, persist the latch, settle), so a failed send stays retryable instead of half-parking. Scoring is idempotent by construction: an observation is only scored when its `turnId` equals `lastContinuedMessageId` and differs from `lastScoredTurnId`, which is what stops a replayed observation from re-parking the goal in the tick that a human answer cleared the latch. The wiring derives the observation from `session.tool.input.started` (the only event carrying the tool name; `session.tool.called` also counts, name unknown), and it withholds the observation entirely until the lane has proven it reports tool activity — a host that never emits tool events disarms the park rather than parking a goal it cannot judge. The prose "asked a question" case is not implemented: only the tool call is reliable, and a text heuristic that misfires would park productive work. A message id newer than our last continuation clears the latch, reusing the signal the existing human-message guard already trusts.
+
+Decision, part two (movable citations). `verifyLocal` keeps `isCitationInsideProjectDir` exactly as-is and still rejects escapes as `traversal-escape` before any filesystem work. For an in-project citation it now resolves in a fixed order: the exact path first (a stat hit and a real file, unchanged `not-a-file` for directories); on a miss, a basename search under the project root; a single hit satisfies the criterion and is reported as moved; zero hits keep `missing-file`; two or more hits fail as `ambiguous-citation` naming up to five candidates instead of guessing. The search is bounded by a 50 000-entry cap, a depth of 12, a 32-match cap and a skip list (`.git`, `.opencode`, `node_modules`, build output, virtualenvs), sorted for determinism, and refuses symlinks so it cannot loop. Every accepted citation is recorded on `LocalVerifyResult.citations`, and the success reason names moved paths, so the operator sees which file actually proved the criterion. Safety under the guard: the exact-path branch already required the citation to resolve inside the project, and the basename branch only ever emits paths discovered by walking the project root, so neither can escape it; a basename match must also be a regular file, so a directory of the same name cannot satisfy proof.
+
+Deferred: the optional content-hash identity (scope item 4) was not implemented. Basename resolution plus the existing amend path cover the observed failures, and a per-file hash would add a record-time invariant plus a migration for a case that has not occurred.
+
+Consequence: a goal parked on a human gate stops within two empty turns and says what to do next instead of silently burning the budget; a productive loop is never parked, because a tool call or any foreign state write resets the streak, and a host without tool events stays disarmed. A legitimate lane move still proves the criterion, ambiguity is loud instead of silently wrong, and a deleted file still fails closed as `missing-file`. Rollback: revert the four state fields, `scoreContinuationTurn`, `observeToolCall`, `sendOneShotStop`/`unparkOnHumanInput`, the `idle-awaiting-input` gate reason, the `resumeGoal` extra case and the wiring maps; and restore the previous `verifyLocal` stat loop plus drop `ResolvedCitation` and the basename search.
diff --git a/README.md b/README.md
index db31bc5..63ff92d 100644
--- a/README.md
+++ b/README.md
@@ -1,6 +1,6 @@
 # opencode-goal-plugin
 
-Slash goal sets one objective and the agent keeps working until it is complete, blocked, or cleared. File state survives compaction. Idle auto-continue sends one prompt per idle tick while the goal stays active and within limits.
+Slash goal sets one objective and the agent keeps working until it is complete, blocked, or cleared. File state survives compaction. Idle auto-continue sends one prompt per idle tick while the goal stays active and within limits. Two consecutive turns that make no tool call and change no goal state park the loop with one message naming `goal_block <reason>` and `goal_resume`; a `question` tool parks the next tick immediately.
 
 ## Install
 
@@ -37,6 +37,6 @@ Same server-only core runs on web, CLI, TUI, and server-only: no TUI imports, no
 /goal &lt;objective&gt; | /goal status | /goal block &lt;reason&gt; | /goal complete | /goal resume | /goal clear
 Agent tools (no slash needed, same guarded lane): `goal_set`, `goal_block`, `goal_complete`, `goal_resume`.
 Kill switch: create `.opencode/STOP_GOAL` to stop the loop immediately.
-Completion: `/goal complete` needs evidence in the session evidence sidecar (`.opencode/goals/<session-id>.evidence.json`) with file citations plus passing test proof. The recorded test command is executed at completion time, so a declared exit code alone cannot pass the gate, and a blocked completion quotes the verifier's failures so the cause is visible; a test entry may carry an `env` map to pin a toolchain. Compaction-safe: state reloads from file and resumes without double send.
+Completion: `/goal complete` needs evidence in the session evidence sidecar (`.opencode/goals/<session-id>.evidence.json`) with file citations plus passing test proof. A citation that legitimately moved inside the project (a Kanban lane promotion, a rename) still proves: the verifier tries the exact path first, then a unique basename hit, and reports which path answered it; two same-named files fail as `ambiguous-citation` naming both, and a citation with no match at all stays `missing-file`. The recorded test command is executed at completion time, so a declared exit code alone cannot pass the gate, and a blocked completion quotes the verifier's failures so the cause is visible; a test entry may carry an `env` map to pin a toolchain. Compaction-safe: state reloads from file and resumes without double send.
 State: `.opencode/goals/<session-id>.json` with UTC epoch ms, one file per session. A legacy `.opencode/goal-state.json` is still read as a fallback and migrates on the next write.
 Build: npm run typecheck, npm test, npm run compile.
diff --git a/docs/AGENT-TOOLS.md b/docs/AGENT-TOOLS.md
index 8ad44a5..062e8fa 100644
--- a/docs/AGENT-TOOLS.md
+++ b/docs/AGENT-TOOLS.md
@@ -66,6 +66,15 @@ Goal marked blocked: Waiting on the payments API credentials
 A blocked goal stops the auto-continue loop. Nothing resumes it except
 `goal_resume` or the human.
 
+### When the loop parks itself
+
+Two consecutive auto-continue turns that invoke no tool and change no goal state
+park the loop automatically: it posts one `Goal idle awaiting input` message
+naming `goal_block <reason>` and `goal_resume`, then stops. A turn that uses the
+`question` tool parks the next tick immediately. If you are waiting on a human,
+`goal_block` is the explicit way to say so — the parked loop stays `active`, so
+the call works right away and `goal_resume` brings it back after the answer.
+
 ## Tool 3 — goal_complete
 
 Close the goal when the work is done. This tool has a gate: it succeeds
diff --git a/src/DECISIONS.md b/src/DECISIONS.md
index 85ff238..66246e1 100644
--- a/src/DECISIONS.md
+++ b/src/DECISIONS.md
@@ -21,6 +21,8 @@ reader inside `src/` finds the reasoning without leaving the folder.
 | ADR-011 completion observes test results         | `proof.ts`, `verifier.ts`, `tools.ts`, `index.ts`            |
 | ADR-012 set resets the evidence sidecar          | `tools.ts`, `index.ts`, `evidence.ts`                        |
 | ADR-013 scoped evidence ends the legacy fallback | `evidence.ts`, `tools.ts`, `index.ts`                        |
+| ADR-015 re-recording an id amends it             | `tools.ts`, `evidence.ts`                                    |
+| ADR-016 idle human-gate park + movable citations | `loop.ts`, `goal.ts`, `state.ts`, `index.ts`, `verifier.ts`  |
 
 ## Local notes
 
diff --git a/src/README.md b/src/README.md
index 2140659..0ed97e4 100644
--- a/src/README.md
+++ b/src/README.md
@@ -14,11 +14,11 @@ module is pure enough to test without an OpenCode host.
 | `state.ts`      | `GoalState` shape, per-session path resolution, atomic save, claim lock and lease                               |
 | `goal.ts`       | Slash parsing, JSON Schemas, lifecycle transitions, title traversal guard                                       |
 | `tools.ts`      | The five agent tools and the lease-guarded mutation paths                                                       |
-| `loop.ts`       | One idle tick: gate, claim, send, record; failure classification                                                |
+| `loop.ts`       | One idle tick: gate, claim, send, record; failure classification; human-gate park                               |
 | `watchdog.ts`   | In-memory timers that wake a stalled lane from persisted state                                                  |
 | `compaction.ts` | Snapshot before compaction, restore after, abort-set pruning                                                    |
 | `evidence.ts`   | Evidence sidecar shape, per-session paths, atomic save                                                          |
-| `verifier.ts`   | Completion gate: citations, then declared or observed test proof                                                |
+| `verifier.ts`   | Completion gate: citations (exact, then unique basename), then declared or observed test proof                  |
 | `proof.ts`      | Executes a recorded proof command under timeout, output cap and cwd pin                                         |
 | `limits.ts`     | Turn, wall-time, delay and per-session cooldown budgets                                                         |
 
@@ -48,11 +48,23 @@ module is pure enough to test without an OpenCode host.
    must stay empty instead of merging the old bucket back in.
 9. Nothing in `src/` throws into the host: host callbacks map failures to a
    reason string.
+10. The idle park never invents a status. A goal parked on a human gate stays
+    `active`; only the auto-continue loop pauses, so `goal_block` works at once
+    and `goal_resume` (or `goal_set`) turns the loop back on. The latch is set
+    only from a turn observation the wiring actually saw, so a host that does not
+    report tool activity can never park a productive goal.
+11. A rejected completion never silently picks between two same-named files, and
+    a citation that resolves by basename is always reported: ambiguity fails as
+    `ambiguous-citation` naming the candidates, and no match stays `missing-file`.
 
 ## Risks
 
 - `loop.ts` and `index.ts` both own idle wiring; a second sender would allow a
   double turn, so both use one `buildIdleDeps`.
+- The park decision is only as good as the tool-event stream. `index.ts` sets the
+  observation from `session.tool.input.started` / `session.tool.called` and
+  withholds it until the lane has reported at least one tool event; a host that
+  renames those events disarms the park instead of parking wrongly.
 - `proof.ts` executes the recorded command with `cwd` set to the project
   directory. That is a starting directory, not a sandbox: a command that changes
   directory can leave it. The bounds are the timeout, the output cap, the command
diff --git a/src/goal.ts b/src/goal.ts
index cf052be..6b24855 100644
--- a/src/goal.ts
+++ b/src/goal.ts
@@ -360,6 +360,23 @@ export function setObjective(
   return fresh;
 }
 
+/**
+ * Clear the idle-park latch plus its no-progress counter and stamp.
+ * Why this helper exists: an explicit transition (block, complete, clear,
+ * resume) means a human or an agent decided something, so the loop has no
+ * human gate left to wait on and must start its streak over. Resetting the
+ * stamp also removes the stale "the goal changed" signal, which would otherwise
+ * credit the next turn with progress it did not make.
+ */
+function clearIdlePark(): Partial<GoalState> {
+  return {
+    idleParked: false,
+    noProgressTurns: 0,
+    lastTurnKey: '',
+    lastScoredTurnId: '',
+  };
+}
+
 /**
  * Mark active goal as blocked with reason in lastSummary.
  * @param current current state must be active
@@ -376,6 +393,7 @@ export function blockGoal(
   }
   return {
     ...current,
+    ...clearIdlePark(),
     status: 'blocked',
     lastSummary: reason,
     leaseOwner: null,
@@ -395,6 +413,7 @@ export function completeGoal(current: GoalState, clock: Clock): GoalState {
   }
   return {
     ...current,
+    ...clearIdlePark(),
     status: 'complete',
     leaseOwner: null,
     leaseExpiresAtMs: 0,
@@ -410,6 +429,7 @@ export function completeGoal(current: GoalState, clock: Clock): GoalState {
 export function clearGoal(current: GoalState, clock: Clock): GoalState {
   return {
     ...current,
+    ...clearIdlePark(),
     status: 'cleared',
     leaseOwner: null,
     leaseExpiresAtMs: 0,
@@ -422,16 +442,25 @@ export function clearGoal(current: GoalState, clock: Clock): GoalState {
  * Why this exists: a user abort parks the goal as interrupted, and the only
  * path back is an explicit /goal resume. Blocked goals can also be resumed.
  * Clears any stale retry so the watchdog does not fire against a fresh start.
- * @param current current state, must be interrupted or blocked
+ * An active goal behind the idle-park latch also resumes: the loop, not the
+ * lifecycle, was stopped, and this is the one verb that turns it back on.
+ * @param current current state, must be interrupted, blocked, or idle-parked
  * @param clock injected clock
  */
 export function resumeGoal(current: GoalState, clock: Clock): GoalState {
-  // Only a parked goal can resume; active and finished states are no-ops.
-  if (current.status !== 'interrupted' && current.status !== 'blocked') {
+  // Only a parked goal can resume; active and finished states are no-ops,
+  // except an active goal whose auto-continue loop parked for human input.
+  const idleParked = current.idleParked === true;
+  if (
+    current.status !== 'interrupted' &&
+    current.status !== 'blocked' &&
+    !(current.status === 'active' && idleParked)
+  ) {
     throw new Error('only a parked goal can resume');
   }
   return {
     ...current,
+    ...clearIdlePark(),
     status: 'active',
     pendingAttempt: null,
     recoveryEpoch: current.recoveryEpoch + 1,
diff --git a/src/index.ts b/src/index.ts
index 225ce09..eb2186a 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -36,6 +36,7 @@ import {
   handleSessionIdle,
   handleSessionFailure,
   classifyFailure,
+  observeToolCall,
 } from './loop.js';
 import { DEFAULT_LIMITS, STOP_FILE_NAME } from './limits.js';
 import type { Limits } from './limits.js';
@@ -928,6 +929,26 @@ export default Plugin.define({
     const controller = new AbortController();
     const idleAbortControllers = new Set<AbortController>();
     idleAbortControllers.add(controller);
+    /**
+     * Per-lane observation of the turn the last continuation started.
+     * Why this map exists: the pure loop cannot see the event stream, so the
+     * wiring records whether that turn invoked a tool and whether it asked the
+     * human a question, then hands it to the next idle tick. Keyed by session
+     * lane because two sessions must never share one judgement.
+     */
+    const turnObservations = new Map<
+      string,
+      { turnId: string; usedTool: boolean; askedQuestion: boolean }
+    >();
+    /**
+     * Per-lane count of tool events seen since setup.
+     * Why this exists: a host that never reports tool activity cannot tell a
+     * silent turn from a busy one, so the idle park stays disarmed there. That
+     * is the fail-safe direction — never park a goal the loop cannot judge.
+     */
+    const toolEventsSeen = new Map<string, number>();
+    /** Cap for both tracking maps so a long-lived host cannot grow unbounded. */
+    const OBSERVATION_LIMIT = 500;
     // Shared deps builder so idle ticks, failure rearms, and startup resume all
     // use one sender. Why one builder: a second copy could drift and let a wake
     // or a retry send twice under the same lane.
@@ -991,6 +1012,26 @@ export default Plugin.define({
           }
         },
         hasStopFile,
+        // Start watching a new assistant turn: the continuation message id is
+        // its identity, so a replayed observation can never be scored twice.
+        onContinuationSent: (messageId: string) => {
+          try {
+            if (
+              turnObservations.size > OBSERVATION_LIMIT &&
+              !turnObservations.has(rawID)
+            ) {
+              const oldest = turnObservations.keys().next();
+              if (!oldest.done) turnObservations.delete(oldest.value);
+            }
+            turnObservations.set(rawID, {
+              turnId: messageId,
+              usedTool: false,
+              askedQuestion: false,
+            });
+          } catch {
+            // Observation bookkeeping is best-effort; the turn already sent.
+          }
+        },
         // Settle hook: success clears the watchdog, failure re-arms it.
         onTurnSettled: (r: { ok: boolean; deadlineMs: number | null }) => {
           try {
@@ -1023,14 +1064,16 @@ export default Plugin.define({
           signal: controller.signal,
         }) as AsyncIterable<{
           type?: unknown;
-          data?: { sessionID?: unknown };
+          data?: { sessionID?: unknown; name?: unknown };
           properties?: { sessionID?: unknown };
         }>;
         for await (const event of stream) {
           try {
             if (event === null || typeof event !== 'object') continue;
             const evType = (event as { type?: unknown }).type;
-            const data = (event as { data?: { sessionID?: unknown } }).data;
+            const data = (
+              event as { data?: { sessionID?: unknown; name?: unknown } }
+            ).data;
             const props = (event as { properties?: { sessionID?: unknown } })
               .properties;
             // Failure events (error / execution.failed / execution.interrupted)
@@ -1079,6 +1122,37 @@ export default Plugin.define({
                 .catch(() => undefined);
               continue;
             }
+            // Tool events are the only agent-side progress signal the loop can
+            // see: record the invocation for the lane's current turn. The tool
+            // name lives on input.started, and `question` is the explicit
+            // human-gate hint the idle park honours on the next tick.
+            if (
+              evType === 'session.tool.input.started' ||
+              evType === 'session.tool.called'
+            ) {
+              const toolID = data?.sessionID ?? props?.sessionID;
+              if (typeof toolID !== 'string' || toolID.length === 0) continue;
+              if (
+                toolEventsSeen.size > OBSERVATION_LIMIT &&
+                !toolEventsSeen.has(toolID)
+              ) {
+                const oldest = toolEventsSeen.keys().next();
+                if (!oldest.done) toolEventsSeen.delete(oldest.value);
+              }
+              toolEventsSeen.set(toolID, (toolEventsSeen.get(toolID) ?? 0) + 1);
+              const turn = turnObservations.get(toolID);
+              if (turn !== undefined) {
+                // `question` is the explicit human gate; any other tool is
+                // ordinary progress. The rule lives in the pure loop module.
+                const toolName =
+                  typeof data?.name === 'string' ? data.name : null;
+                turnObservations.set(
+                  toolID,
+                  observeToolCall(turn, toolName) ?? turn,
+                );
+              }
+              continue;
+            }
             if (evType !== 'session.idle') continue;
             const rawID = data?.sessionID ?? props?.sessionID;
             if (typeof rawID !== 'string' || rawID.length === 0) continue;
@@ -1095,6 +1169,13 @@ export default Plugin.define({
                 projectDir,
                 lastMessageId: typeof lastMsgId === 'string' ? lastMsgId : null,
                 sessionId: rawID,
+                // Hand over the observation only once the host has proven it
+                // reports tool activity: a silent host must never park a goal
+                // by looking idle when the loop simply cannot see its work.
+                lastTurn:
+                  (toolEventsSeen.get(rawID) ?? 0) > 0
+                    ? (turnObservations.get(rawID) ?? null)
+                    : null,
               },
               buildIdleDeps(rawID),
             );
diff --git a/src/loop.ts b/src/loop.ts
index c38efcc..fe32413 100644
--- a/src/loop.ts
+++ b/src/loop.ts
@@ -66,6 +66,13 @@ export interface IdleContext {
    * sessions in one project proceed independently.
    */
   sessionId?: string | null;
+  /**
+   * Observation of the assistant turn our last continuation started.
+   * Why optional exists: only the host wiring can see tool events, and older
+   * callers (plus hosts that never report tool activity) pass nothing. An
+   * absent observation is never scored, so the park latch cannot fire blind.
+   */
+  lastTurn?: TurnObservation | null;
 }
 
 /** Discriminated result of one send attempt. */
@@ -96,6 +103,13 @@ export interface IdleDeps {
     prompt: string,
   ) => Promise<SendResult | { messageId: string; tokenSpend?: number }>;
   hasStopFile: () => Promise<boolean>;
+  /**
+   * Optional hook fired after a continuation prompt was sent.
+   * Why this exists: the host wiring tracks the turn that continuation starts
+   * (tool calls, the `question` tool) and cannot know when the next turn begins
+   * without this signal. A send failure never fires it.
+   */
+  onContinuationSent?: (messageId: string) => void;
   /**
    * Optional hook fired after a turn ends, success or failure.
    * Why this exists: the host clears the watchdog on success and re-arms it on
@@ -168,6 +182,182 @@ function safeSpend(v: unknown): number {
  */
 export const DEFAULT_MAX_TURN_MS = 90000;
 
+/**
+ * Consecutive no-progress continuation turns before the loop parks for input.
+ * Why 2: one empty turn is a normal end-of-turn (a summary, a status line), so
+ * parking on it would punish a productive loop; two in a row means the agent is
+ * waiting on something the loop cannot supply. The task allows 2-3, and the
+ * park message itself is recoverable with one `goal_resume` or `goal_set`.
+ */
+export const IDLE_PARK_THRESHOLD = 2;
+
+/**
+ * Observation of the assistant turn started by one continuation prompt.
+ * Why this shape exists: the pure loop cannot see the host event stream, so the
+ * wiring reports what it observed and this module decides. `turnId` is the
+ * continuation message id, which makes scoring idempotent: a replayed
+ * observation for a turn already scored no longer matches the current
+ * continuation and is ignored.
+ */
+export interface TurnObservation {
+  /** Continuation message id that started the observed turn. */
+  turnId: string;
+  /** True when the turn invoked at least one tool. */
+  usedTool: boolean;
+  /** True when the turn asked the human a question (the `question` tool). */
+  askedQuestion: boolean;
+}
+
+/** Result of folding one observation into the no-progress streak. */
+export interface TurnScore {
+  /** True when the observation belonged to the current continuation. */
+  scored: boolean;
+  /** True when the turn did real work (a tool call or a state change). */
+  productive: boolean;
+  /** Consecutive no-progress turns after this score. */
+  noProgressTurns: number;
+  /** True when the scored turn asked the human a question. */
+  questionAsked: boolean;
+  /** True when the loop should stop and post its one idle message. */
+  parkRequested: boolean;
+}
+
+/**
+ * Stamp of the fields only a real transition writes.
+ * Why this list: loop bookkeeping (iteration count is written by the loop
+ * itself, so it is stamped from the saved state) must never look like progress,
+ * while any tool or slash mutation changes at least one field here. Claim and
+ * send timestamps are excluded on purpose because a skipped tick rewrites them.
+ * @param state goal state to stamp
+ */
+export function progressKey(state: GoalState): string {
+  return [
+    state.objective,
+    String(state.createdAtMs),
+    state.status,
+    String(state.iterationCount),
+    String(state.recoveryEpoch),
+    state.lastSummary,
+    String(state.revisionCount),
+    String(state.wrapupSent),
+    String(state.pendingVerification),
+    state.verificationFailReason ?? '',
+    state.evidenceHash ?? '',
+  ].join('|');
+}
+
+/**
+ * Fold one turn observation into the consecutive no-progress streak.
+ * Why pure: the park decision must be testable without a host, a clock, or disk.
+ * Rules: an observation for any turn other than the current continuation is
+ * ignored (idempotent replay); a tool call or a state change resets the streak;
+ * the `question` tool parks on the next tick regardless of the threshold,
+ * because asking the human is the explicit human gate.
+ * @param state current goal state
+ * @param turn observation reported by the host wiring, null when unknown
+ */
+export function scoreContinuationTurn(
+  state: GoalState,
+  turn: TurnObservation | null | undefined,
+): TurnScore {
+  const unchanged: TurnScore = {
+    scored: false,
+    productive: false,
+    noProgressTurns: state.noProgressTurns,
+    questionAsked: false,
+    // Keep an existing latch: no observation must never silently unpark.
+    parkRequested: state.idleParked === true,
+  };
+  if (turn === null || turn === undefined) return unchanged;
+  if (typeof turn.turnId !== 'string' || turn.turnId.length === 0) {
+    return unchanged;
+  }
+  // Only the turn our last continuation started may be scored. Anything else is
+  // a stale replay or a human-initiated turn the loop must not judge.
+  if (state.lastContinuedMessageId === '') return unchanged;
+  if (turn.turnId !== state.lastContinuedMessageId) return unchanged;
+  // Already scored: a parked goal sends no new continuation, so the host keeps
+  // replaying the same observation. Scoring it twice would re-park the goal in
+  // the tick that a human answer just unparked.
+  if (state.lastScoredTurnId !== '' && turn.turnId === state.lastScoredTurnId) {
+    return unchanged;
+  }
+  const stateChanged =
+    state.lastTurnKey !== '' && progressKey(state) !== state.lastTurnKey;
+  const productive = turn.usedTool === true || stateChanged;
+  const questionAsked = turn.askedQuestion === true;
+  if (productive) {
+    return {
+      scored: true,
+      productive: true,
+      noProgressTurns: 0,
+      questionAsked,
+      // A question tool is an explicit human gate even when the turn did real
+      // work: the agent is asking, not progressing, so the loop must park.
+      parkRequested: questionAsked,
+    };
+  }
+  const count = state.noProgressTurns + 1;
+  return {
+    scored: true,
+    productive: false,
+    noProgressTurns: count,
+    questionAsked,
+    parkRequested: questionAsked || count >= IDLE_PARK_THRESHOLD,
+  };
+}
+
+/**
+ * Fold one host tool event into the pending turn observation.
+ * Why this helper exists: the wiring must decide whether the running turn used
+ * a tool and whether it asked the human a question, and that rule belongs next
+ * to the park policy instead of inside the event loop. It never invents a turn:
+ * without a continuation to attach to, the event is ignored.
+ * @param turn pending observation for the lane, null when no turn is watched
+ * @param toolName tool name reported by the host event, when the host sends one
+ */
+export function observeToolCall(
+  turn: TurnObservation | null | undefined,
+  toolName?: string | null,
+): TurnObservation | null {
+  if (turn === null || turn === undefined) return null;
+  return {
+    ...turn,
+    usedTool: true,
+    askedQuestion: turn.askedQuestion === true || toolName === 'question',
+  };
+}
+
+/**
+ * Build the one message posted when the loop parks for human input.
+ * Why it names the verbs: the operator has exactly two useful moves, answer the
+ * open question or park the goal explicitly, and a vague notice leaves the goal
+ * burning turns anyway. It never claims a new status; the goal stays active.
+ * @param state active goal state the loop parked on
+ * @param noProgressTurns consecutive unproductive turns that tripped the park
+ * @param questionAsked true when the turn asked the human a direct question
+ */
+export function buildIdleParkPrompt(
+  state: GoalState,
+  noProgressTurns: number,
+  questionAsked = false,
+): string {
+  const why = questionAsked
+    ? 'the last turn asked for a decision and no answer has arrived.'
+    : String(noProgressTurns) +
+      ' consecutive turn(s) ended with no tool call and no goal state change.';
+  return (
+    'Goal idle awaiting input: "' +
+    state.objective +
+    '"\n' +
+    'The auto-continue loop paused: ' +
+    why +
+    '\n' +
+    'Answer the open question, or call goal_block <reason> to park the goal explicitly. ' +
+    'Call goal_resume to revive this loop later.'
+  );
+}
+
 /**
  * Build or extend a pending continuation attempt after a failed turn.
  * Why this helper exists: retry state must be explicit and persisted so the
@@ -442,6 +632,136 @@ async function settleFailedSend(
   return { decision: 'stopped', reason: 'send-failed' };
 }
 
+/**
+ * Send one stop message exactly once, under the file lease.
+ * Why shared: the budget wrap-up and the idle park both mean "claim, send once,
+ * persist the latch, settle". A second copy of that sequence would sooner or
+ * later drift and let one path send twice or skip the retry bookkeeping.
+ * A failed send never flips the latch: the pending attempt is persisted so the
+ * watchdog can wake the loop and the message is retried.
+ * @param args state path, state at claim time, deps, prompt, reason, latch writer
+ */
+async function sendOneShotStop(args: {
+  statePath: string;
+  state: GoalState;
+  deps: IdleDeps;
+  prompt: string;
+  successReason: string;
+  mark: (state: GoalState) => GoalState;
+}): Promise<IdleDecision> {
+  const { statePath, state, deps, prompt, successReason, mark } = args;
+  // Claim the lease so the one-shot send stays single-flight like any turn.
+  let claimed: { claimed: boolean; state: GoalState | null } | null = null;
+  try {
+    claimed = await deps.tryClaim(
+      statePath,
+      deps.ownerId,
+      LEASE_TTL_MS,
+      deps.clock,
+    );
+  } catch {
+    claimed = null;
+  }
+  // Lease not held: skip this tick without flipping the latch so the message can
+  // still be posted later. A lost lease must not consume the one shot.
+  if (claimed === null || !claimed.claimed) {
+    return { decision: 'skipped', reason: 'lease-held' };
+  }
+  const now = deps.clock.nowMs();
+  let sentOk = false;
+  try {
+    sentOk = normalizeSendResult(await deps.sendPrompt(prompt)).success;
+  } catch {
+    // A thrown send is a failure: do not flip the latch.
+    sentOk = false;
+  }
+  if (sentOk) {
+    try {
+      await deps.saveState(statePath, {
+        ...mark(state),
+        leaseOwner: null,
+        leaseExpiresAtMs: 0,
+        updatedAtMs: now,
+      });
+    } catch {
+      // Bookkeeping failure never changes the terminal verdict.
+    }
+    // A delivered stop message clears any watchdog: the lane is settled.
+    try {
+      deps.onTurnSettled?.({ ok: true, deadlineMs: null });
+    } catch {
+      // Settle hook is best-effort.
+    }
+    return { decision: 'stopped', reason: successReason };
+  }
+  // Send failed: record a retry attempt and stop without flipping the latch.
+  const pending = buildPendingAttempt(state, 'provider-error', now);
+  try {
+    await deps.saveState(statePath, {
+      ...state,
+      pendingAttempt: pending,
+      failureCount: state.failureCount + 1,
+      leaseOwner: null,
+      leaseExpiresAtMs: 0,
+      updatedAtMs: now,
+    });
+  } catch {
+    // Cleanup failure keeps the send failure as the reported reason.
+  }
+  // A failed stop send re-arms the watchdog so it can be retried.
+  try {
+    deps.onTurnSettled?.({ ok: false, deadlineMs: pending.deadlineMs });
+  } catch {
+    // Settle hook is best-effort.
+  }
+  return { decision: 'stopped', reason: 'send-failed' };
+}
+
+/**
+ * Clear the idle park latch because a human message arrived after the park.
+ * Why a claim: this is a real state write and must not race an idle tick or a
+ * tool mutation. A lost lease leaves the latch for the next tick to clear.
+ * @param statePath absolute goal state path
+ * @param state parked state at load time
+ * @param deps injected clock plus storage
+ */
+async function unparkOnHumanInput(
+  statePath: string,
+  state: GoalState,
+  deps: IdleDeps,
+): Promise<{ ok: boolean; state: GoalState | null }> {
+  let claimed: { claimed: boolean; state: GoalState | null };
+  try {
+    claimed = await deps.tryClaim(
+      statePath,
+      deps.ownerId,
+      LEASE_TTL_MS,
+      deps.clock,
+    );
+  } catch {
+    return { ok: false, state: null };
+  }
+  if (!claimed.claimed) return { ok: false, state: null };
+  const now = deps.clock.nowMs();
+  // Prefer the claimant's snapshot: the pre-claim load may be stale.
+  const base = claimed.state ?? state;
+  const next: GoalState = {
+    ...base,
+    idleParked: false,
+    noProgressTurns: 0,
+    leaseOwner: null,
+    leaseExpiresAtMs: 0,
+    updatedAtMs: now,
+  };
+  try {
+    await deps.saveState(statePath, next);
+  } catch {
+    // The TTL reclaims the lease this claim took: report the tick as skipped.
+    return { ok: false, state: null };
+  }
+  return { ok: true, state: next };
+}
+
 /**
  * Build the one-time wrap-up prompt sent when a budget is exhausted.
  * Why this exists: the loop must tell the agent to stop cleanly instead of
@@ -467,14 +787,15 @@ export function buildWrapupPrompt(state: GoalState, reason: string): string {
  * @param nowMs injected now in epoch ms
  * @param lastMessageId last observed session message id
  * @param limits active limits
- * @param opts stopRequested is true when STOP_GOAL exists
+ * @param opts stopRequested is true when STOP_GOAL exists; humanSpoke is true
+ * when a message newer than our last continuation arrived after the park
  */
 export function shouldContinue(
   state: GoalState | null,
   nowMs: number,
   lastMessageId: string | null,
   limits: Limits,
-  opts?: { stopRequested?: boolean },
+  opts?: { stopRequested?: boolean; humanSpoke?: boolean },
 ): { ok: boolean; reason: string } {
   if (state === null) return { ok: false, reason: 'no-state' };
   if (state.status !== 'active')
@@ -485,6 +806,12 @@ export function shouldContinue(
   if (state.pendingVerification === true)
     return { ok: false, reason: 'verification-pending' };
   if (opts?.stopRequested === true) return { ok: false, reason: 'stop-file' };
+  // Idle park: the loop already posted its one message for this human gate, so
+  // no further turn is spent until the human answers or an explicit resume
+  // clears the latch. The goal itself stays active throughout.
+  if (state.idleParked === true && opts?.humanSpoke !== true) {
+    return { ok: false, reason: 'idle-awaiting-input' };
+  }
   // A message id that moved past our last continuation means the human spoke: yield.
   if (
     state.lastContinuedMessageId !== '' &&
@@ -664,7 +991,7 @@ export async function handleSessionIdle(
     } catch {
       return { decision: 'stopped', reason: 'corrupt-state' };
     }
-    const now = deps.clock.nowMs();
+    let now = deps.clock.nowMs();
     let stopRequested = false;
     try {
       stopRequested = await deps.hasStopFile();
@@ -672,12 +999,87 @@ export async function handleSessionIdle(
       // Fail closed: a filesystem error must not silently ignore STOP_GOAL.
       return { decision: 'stopped', reason: 'stop-check-failed' };
     }
+    // A message id newer than our last continuation means someone else spoke
+    // after the loop parked. This is the same signal the human-message guard
+    // already trusts, reused so the answer to the gate can revive the loop.
+    const humanSpoke =
+      current !== null &&
+      current.lastContinuedMessageId !== '' &&
+      ctx.lastMessageId !== null &&
+      ctx.lastMessageId !== undefined &&
+      ctx.lastMessageId !== current.lastContinuedMessageId;
+    // Score the turn our last continuation started. Without an observation the
+    // streak is never scored, so a host that does not report tool activity can
+    // never park a productive goal by accident.
+    let effective: GoalState | null = current;
+    let score: TurnScore | null =
+      effective === null
+        ? null
+        : scoreContinuationTurn(effective, ctx.lastTurn ?? null);
+    if (
+      effective !== null &&
+      effective.status === 'active' &&
+      effective.idleParked === true &&
+      humanSpoke
+    ) {
+      // The answer arrived: clear the latch once so the loop can run again.
+      const cleared = await unparkOnHumanInput(statePath, effective, deps);
+      if (!cleared.ok) return { decision: 'skipped', reason: 'lease-held' };
+      if (cleared.state !== null) {
+        effective = cleared.state;
+        score = scoreContinuationTurn(effective, ctx.lastTurn ?? null);
+      }
+      now = deps.clock.nowMs();
+    }
+    const budget =
+      effective === null ? null : checkBudget(effective, now, deps.limits);
+    // Idle park: the streak tripped, or the turn asked the human a question.
+    // Budget exhaustion keeps precedence so the wrap-up path stays the owner of
+    // that case, and STOP_GOAL always wins over a notice.
+    const wantsPark =
+      effective !== null &&
+      score !== null &&
+      score.scored &&
+      score.parkRequested &&
+      effective.status === 'active' &&
+      effective.idleParked !== true &&
+      effective.pendingVerification !== true &&
+      effective.wrapupSent !== true &&
+      stopRequested !== true &&
+      (budget === null || budget.ok);
+    if (wantsPark && effective !== null && score !== null) {
+      // One-shot park through the same plumbing as the budget wrap. No status is
+      // invented: the goal stays active, so goal_block is callable right away
+      // and goal_resume is the single-call way back.
+      const parked = score;
+      // Remember which turn this verdict was scored from so the replayed
+      // observation cannot fire a second park after a human answer.
+      const scoredTurnId =
+        typeof ctx.lastTurn?.turnId === 'string' ? ctx.lastTurn.turnId : '';
+      return sendOneShotStop({
+        statePath,
+        state: effective,
+        deps,
+        prompt: buildIdleParkPrompt(
+          effective,
+          parked.noProgressTurns,
+          parked.questionAsked,
+        ),
+        successReason: 'idle-awaiting-input',
+        mark: (s: GoalState): GoalState => ({
+          ...s,
+          idleParked: true,
+          noProgressTurns: parked.noProgressTurns,
+          lastScoredTurnId: scoredTurnId,
+        }),
+      });
+    }
     const gate = shouldContinue(
-      current,
+      effective,
       now,
       ctx.lastMessageId ?? null,
       deps.limits,
-      { stopRequested },
+      { stopRequested, humanSpoke },
     );
     if (!gate.ok) {
       // No-goal and finished goals stop the loop; cooldown and contention only skip one tick.
@@ -687,88 +1089,23 @@ export async function handleSessionIdle(
         gate.reason === 'max-turns' ||
         gate.reason === 'wall-time' ||
         gate.reason === 'wrapped-up' ||
-        gate.reason === 'stop-file';
+        gate.reason === 'stop-file' ||
+        gate.reason === 'idle-awaiting-input';
       // Wrap-up-once: on the first budget hit send one final wrap prompt, mark
       // the persisted flag, then every later hit stops without another send.
       if (
         (gate.reason === 'max-turns' || gate.reason === 'wall-time') &&
-        current !== null &&
-        (current as GoalState).wrapupSent !== true
+        effective !== null &&
+        effective.wrapupSent !== true
       ) {
-        const cur = current as GoalState;
-        // Claim the lease so the wrap send stays single-flight like any turn.
-        let wrapClaimed: { claimed: boolean; state: GoalState | null } | null =
-          null;
-        try {
-          wrapClaimed = await deps.tryClaim(
-            statePath,
-            deps.ownerId,
-            LEASE_TTL_MS,
-            deps.clock,
-          );
-        } catch {
-          wrapClaimed = null;
-        }
-        // Lease not held: skip this tick without flipping the flag so the wrap
-        // can still be sent later. A lost lease must not consume the one wrap.
-        if (wrapClaimed === null || !wrapClaimed.claimed) {
-          return { decision: 'skipped', reason: 'lease-held' };
-        }
-        let wrapOk = false;
-        try {
-          const raw = await deps.sendPrompt(
-            buildWrapupPrompt(cur, gate.reason),
-          );
-          wrapOk = normalizeSendResult(raw).success;
-        } catch {
-          // A thrown wrap send is a failure: do not flip the flag.
-          wrapOk = false;
-        }
-        // Only a real successful wrap marks the goal wrapped.
-        if (wrapOk) {
-          try {
-            await deps.saveState(statePath, {
-              ...cur,
-              wrapupSent: true,
-              leaseOwner: null,
-              leaseExpiresAtMs: 0,
-              updatedAtMs: now,
-            });
-          } catch {
-            // Bookkeeping failure never changes the terminal verdict.
-          }
-          // A completed wrap clears any watchdog: the goal is terminal.
-          try {
-            deps.onTurnSettled?.({ ok: true, deadlineMs: null });
-          } catch {
-            // Settle hook is best-effort.
-          }
-          return { decision: 'stopped', reason: gate.reason };
-        }
-        // Send failed: record a retry attempt and stop without flipping.
-        const wrapPending = buildPendingAttempt(cur, 'provider-error', now);
-        try {
-          await deps.saveState(statePath, {
-            ...cur,
-            pendingAttempt: wrapPending,
-            failureCount: cur.failureCount + 1,
-            leaseOwner: null,
-            leaseExpiresAtMs: 0,
-            updatedAtMs: now,
-          });
-        } catch {
-          // Cleanup failure keeps the send failure as the reported reason.
-        }
-        // A failed wrap re-arms the watchdog so the wrap can be retried.
-        try {
-          deps.onTurnSettled?.({
-            ok: false,
-            deadlineMs: wrapPending.deadlineMs,
-          });
-        } catch {
-          // Settle hook is best-effort.
-        }
-        return { decision: 'stopped', reason: 'send-failed' };
+        return sendOneShotStop({
+          statePath,
+          state: effective,
+          deps,
+          prompt: buildWrapupPrompt(effective, gate.reason),
+          successReason: gate.reason,
+          mark: (s: GoalState): GoalState => ({ ...s, wrapupSent: true }),
+        });
       }
       return {
         decision: terminal ? 'stopped' : 'skipped',
@@ -832,7 +1169,7 @@ export async function handleSessionIdle(
     }
     // Post-send timestamp: slow sends must not shorten the real cooldown.
     const afterSend = deps.clock.nowMs();
-    const next: GoalState = {
+    const base: GoalState = {
       ...claimed.state,
       iterationCount: claimed.state.iterationCount + 1,
       lastTurnAtMs: afterSend,
@@ -845,9 +1182,29 @@ export async function handleSessionIdle(
       failureCount: 0,
       // Remember the real session so a restart can rearm the right lane.
       lastSessionId: sessionPart,
+      // A send means the loop is running again, and the streak stored here is
+      // the score of the turn that just ended (0 after a productive turn).
+      noProgressTurns:
+        score !== null && score.scored
+          ? score.noProgressTurns
+          : claimed.state.noProgressTurns,
+      idleParked: false,
       leaseOwner: null,
       leaseExpiresAtMs: 0,
     };
+    // Stamp the saved shape, not the pre-save one: the loop's own increment must
+    // never look like a foreign mutation on the next tick. The scored turn id
+    // records that this observation was consumed, so a replay cannot count twice.
+    const next: GoalState = {
+      ...base,
+      lastTurnKey: progressKey(base),
+      lastScoredTurnId:
+        score !== null &&
+        score.scored &&
+        typeof ctx.lastTurn?.turnId === 'string'
+          ? ctx.lastTurn.turnId
+          : claimed.state.lastScoredTurnId,
+    };
     try {
       await deps.saveState(statePath, next);
     } catch {
@@ -859,6 +1216,12 @@ export async function handleSessionIdle(
     } catch {
       // Cooldown bookkeeping never blocks a successful send.
     }
+    // Tell the wiring which turn identity to watch for progress signals.
+    try {
+      deps.onContinuationSent?.(sent.messageId);
+    } catch {
+      // Observation bookkeeping is best-effort; the loop still sent its turn.
+    }
     // A successful turn clears any watchdog: no stale wake should fire.
     try {
       deps.onTurnSettled?.({ ok: true, deadlineMs: null });
diff --git a/src/state.ts b/src/state.ts
index 8010d8b..eba67e0 100644
--- a/src/state.ts
+++ b/src/state.ts
@@ -88,6 +88,35 @@ export interface GoalState {
    * Empty means unknown, so no watchdog is armed until a real event arrives.
    */
   lastSessionId: string;
+  /**
+   * Consecutive auto-continue turns that ended with no tool invocation and no
+   * goal state change. Why this field exists: a loop that keeps sending
+   * continuations while the agent waits on a human burns the entire turn budget
+   * restating the same status. Reset to zero by any productive turn.
+   */
+  noProgressTurns: number;
+  /**
+   * Loop-level park latch for a human gate.
+   * Why not a status: the goal is still live work, so no lifecycle value is
+   * invented — only the auto-continue loop pauses, and the existing verbs
+   * (`goal_block`, `goal_resume`, `goal_set`) stay callable.
+   */
+  idleParked: boolean;
+  /**
+   * Progress stamp of the state exactly as the loop last saved it.
+   * Why this field exists: every other writer (a goal tool, a slash command, a
+   * failure park) changes one of the stamped fields, so a mismatch proves the
+   * continuation turn mutated the goal even when it made no tool call.
+   */
+  lastTurnKey: string;
+  /**
+   * Continuation message id of the last turn already folded into the streak.
+   * Why this field exists: an observation is replayed by the host until the next
+   * continuation is sent, and a parked goal sends none. Without this marker the
+   * stale observation would re-park the goal in the very tick that a human
+   * answer cleared the latch.
+   */
+  lastScoredTurnId: string;
 }
 
 export const STATE_FILENAME = 'goal-state.json';
@@ -239,6 +268,10 @@ export function initialState(
     failureCount: 0,
     recoveryEpoch: 0,
     lastSessionId: '',
+    noProgressTurns: 0,
+    idleParked: false,
+    lastTurnKey: '',
+    lastScoredTurnId: '',
   };
 }
 
@@ -331,6 +364,13 @@ function isValidState(value: unknown): value is GoalState {
     return false;
   if ('lastSessionId' in v && typeof v['lastSessionId'] !== 'string')
     return false;
+  // Idle-park fields stay optional so older files load, then normalize fills them.
+  if ('noProgressTurns' in v && typeof v['noProgressTurns'] !== 'number')
+    return false;
+  if ('idleParked' in v && typeof v['idleParked'] !== 'boolean') return false;
+  if ('lastTurnKey' in v && typeof v['lastTurnKey'] !== 'string') return false;
+  if ('lastScoredTurnId' in v && typeof v['lastScoredTurnId'] !== 'string')
+    return false;
   return true;
 }
 
@@ -379,6 +419,26 @@ export function normalizeState(input: GoalState): GoalState {
         ? ((input as unknown as { lastSessionId: string })
             .lastSessionId as string)
         : '',
+    noProgressTurns:
+      typeof (input as unknown as { noProgressTurns?: unknown })
+        .noProgressTurns === 'number'
+        ? ((input as unknown as { noProgressTurns: number })
+            .noProgressTurns as number)
+        : 0,
+    // Loose boolean check: a numeric 0 would otherwise arm the latch wrongly.
+    idleParked:
+      (input as unknown as { idleParked?: unknown }).idleParked === true,
+    lastTurnKey:
+      typeof (input as unknown as { lastTurnKey?: unknown }).lastTurnKey ===
+      'string'
+        ? ((input as unknown as { lastTurnKey: string }).lastTurnKey as string)
+        : '',
+    lastScoredTurnId:
+      typeof (input as unknown as { lastScoredTurnId?: unknown })
+        .lastScoredTurnId === 'string'
+        ? ((input as unknown as { lastScoredTurnId: string })
+            .lastScoredTurnId as string)
+        : '',
   };
 }
 
diff --git a/src/tools.ts b/src/tools.ts
index 6d7590e..65a2a51 100644
--- a/src/tools.ts
+++ b/src/tools.ts
@@ -355,6 +355,21 @@ async function toolBlock(
   }
 }
 
+/**
+ * Message for recording evidence against a goal that is not active.
+ * Why it names goal_set: after a completion the sidecar is closed for writes,
+ * and the bare status report left the agent with no next step — it retried the
+ * same call. The remedy is one call away, so the message says so.
+ * @param status current goal status, e.g. `complete`
+ */
+function inactiveGoalEvidenceMessage(status: string): string {
+  return (
+    'Only an active goal can record evidence. Current status: ' +
+    status +
+    '. Call goal_set first to start a new goal.'
+  );
+}
+
 /**
  * Record one evidence criterion for the active goal.
  * Why this function is exported: the slash lane calls it directly so both
@@ -477,11 +492,7 @@ export async function recordEvidence(
     return 'No goal set. Use /goal <objective> first.';
   }
   if (loaded.state.status !== 'active') {
-    return (
-      'Only an active goal can record evidence. Current status: ' +
-      loaded.state.status +
-      '.'
-    );
+    return inactiveGoalEvidenceMessage(loaded.state.status);
   }
   const owner = toolOwner(sessionID);
   const claimRes = await claimForTool(
@@ -501,11 +512,7 @@ export async function recordEvidence(
       return 'No goal set. Use /goal <objective> first.';
     }
     if (fresh.state.status !== 'active') {
-      return (
-        'Only an active goal can record evidence. Current status: ' +
-        fresh.state.status +
-        '.'
-      );
+      return inactiveGoalEvidenceMessage(fresh.state.status);
     }
     // Null sidecar (e.g. tool-lane set never seeded one) starts empty.
     // Scoped evidence: slash plus tool lanes never share citations.
diff --git a/src/verifier.ts b/src/verifier.ts
index 17f04dc..6995325 100644
--- a/src/verifier.ts
+++ b/src/verifier.ts
@@ -5,6 +5,7 @@
  * Local checks run first; an optional host subagent runs second. Any error keeps the goal active.
  */
 import { promises as fs } from 'node:fs';
+import type { Dirent } from 'node:fs';
 import path from 'node:path';
 import type { EvidenceCriterion, GoalEvidenceFile } from './evidence.js';
 import { validateEvidenceShape, hashEvidence } from './evidence.js';
@@ -63,6 +64,200 @@ export interface LocalVerifyResult {
   ok: boolean;
   reason: string;
   failures: string[];
+  /**
+   * Which project path satisfied each accepted file citation, in evidence order.
+   * Why this field exists: a citation that moved inside the project (a Kanban
+   * lane promotion, a rename) still proves the criterion, but the operator must
+   * be told which path actually answered it instead of guessing.
+   */
+  citations?: ResolvedCitation[];
+}
+
+/** One accepted file citation plus the project path that satisfied it. */
+export interface ResolvedCitation {
+  /** Criterion the citation belongs to. */
+  criterionId: string;
+  /** Path exactly as recorded in the evidence sidecar. */
+  cited: string;
+  /** Project-relative path (forward slashes) that satisfied the citation. */
+  resolved: string;
+  /** True when `resolved` differs from the recorded path (the file moved). */
+  moved: boolean;
+}
+
+/**
+ * Directory names a basename citation search never descends into.
+ * Why this list: build output and dependency trees are large, generated, and
+ * never the file a criterion cites, so skipping them keeps the search cheap on
+ * a big repository without weakening the guard (the search stays inside the
+ * project root either way).
+ */
+const BASENAME_SKIP_DIRS = new Set([
+  '.git',
+  '.opencode',
+  'node_modules',
+  'dist',
+  'build',
+  'coverage',
+  '.next',
+  '.venv',
+  'venv',
+  'target',
+  '__pycache__',
+]);
+
+/**
+ * Maximum directory entries one basename search examines before it gives up.
+ * Why a cap at all: completion must stay bounded on a huge repository, so a
+ * pathological tree cannot stall the proof pass. 50 000 entries comfortably
+ * covers a large source tree once dependency, virtualenv and build directories
+ * are skipped, and a deleted file still yields zero matches inside the cap,
+ * which is the fail-closed answer this feature must preserve.
+ */
+export const BASENAME_SCAN_LIMIT = 50000;
+
+/** Maximum directory depth one basename search descends. */
+const BASENAME_MAX_DEPTH = 12;
+
+/** Maximum matches collected before a search stops: enough to prove ambiguity. */
+const BASENAME_MATCH_LIMIT = 32;
+
+/** How many candidate paths an ambiguity failure names before summarizing. */
+export const AMBIGUOUS_CANDIDATE_LIMIT = 5;
+
+/**
+ * Render one absolute path as a project-relative, forward-slash path.
+ * Why normalize: failure strings and citations travel between platforms, so a
+ * Windows backslash must not make the same file look like a different one.
+ * @param base absolute project root
+ * @param absolute absolute path inside the project
+ */
+function toProjectRelative(base: string, absolute: string): string {
+  return path.relative(base, absolute).split(path.sep).join('/');
+}
+
+/**
+ * Find every file under the project whose basename matches exactly.
+ * Why basename only: a citation is a path, but the file's identity survives a
+ * move; the exact path is tried first and this search only runs after it missed.
+ * Deterministic order (sorted entries, depth first) so an ambiguity report is
+ * stable, and bounded by an entry cap plus a depth cap so a huge tree cannot
+ * stall completion. Symlinks are skipped so a cycle cannot loop forever.
+ * @param projectDir absolute project root
+ * @param basename file name to match, e.g. `16-foo.md`
+ */
+async function findFilesByBasename(
+  projectDir: string,
+  basename: string,
+): Promise<string[]> {
+  const base = path.resolve(projectDir);
+  const matches: string[] = [];
+  let seen = 0;
+  const walk = async (dir: string, depth: number): Promise<void> => {
+    if (depth > BASENAME_MAX_DEPTH || seen > BASENAME_SCAN_LIMIT) return;
+    if (matches.length >= BASENAME_MATCH_LIMIT) return;
+    let entries: Dirent[];
+    try {
+      entries = await fs.readdir(dir, { withFileTypes: true });
+    } catch {
+      // Unreadable directory: it simply contributes no match.
+      return;
+    }
+    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
+    for (const entry of entries) {
+      seen += 1;
+      if (seen > BASENAME_SCAN_LIMIT) return;
+      if (entry.isSymbolicLink()) continue;
+      if (entry.isDirectory()) {
+        if (BASENAME_SKIP_DIRS.has(entry.name)) continue;
+        await walk(path.join(dir, entry.name), depth + 1);
+        if (matches.length >= BASENAME_MATCH_LIMIT) return;
+        continue;
+      }
+      if (!entry.isFile()) continue;
+      if (entry.name !== basename) continue;
+      matches.push(toProjectRelative(base, path.join(dir, entry.name)));
+      if (matches.length >= BASENAME_MATCH_LIMIT) return;
+    }
+  };
+  await walk(base, 0);
+  return matches;
+}
+
+/**
+ * Resolve one citation to a real file without ever leaving the project.
+ * Why this order: an exact path is unambiguous, so it always wins and never
+ * costs a tree walk. Only a miss triggers the basename search, and that search
+ * accepts a hit only when it is unique — guessing between two same-named files
+ * would prove the wrong file, so ambiguity is reported as a failure that names
+ * the candidates. No match at all keeps the historical `missing-file`.
+ * @param projectDir absolute project root
+ * @param criterionId criterion the citation belongs to
+ * @param cited path exactly as recorded in the evidence sidecar
+ */
+async function resolveCitation(
+  projectDir: string,
+  criterionId: string,
+  cited: string,
+): Promise<{ citation: ResolvedCitation | null; failure: string | null }> {
+  const base = path.resolve(projectDir);
+  const target = path.isAbsolute(cited) ? cited : path.join(projectDir, cited);
+  try {
+    // Require a real file: directories and missing paths both fail proof.
+    const st = await fs.stat(target);
+    if (!st.isFile()) {
+      return {
+        citation: null,
+        failure: 'not-a-file:' + criterionId + ':' + cited,
+      };
+    }
+    return {
+      citation: {
+        criterionId,
+        cited,
+        resolved: toProjectRelative(base, target),
+        moved: false,
+      },
+      failure: null,
+    };
+  } catch {
+    // Missing exact path: try identity by basename before failing below.
+  }
+  const basename = path.basename(cited);
+  if (basename === '' || basename === '.' || basename === '..') {
+    return {
+      citation: null,
+      failure: 'missing-file:' + criterionId + ':' + cited,
+    };
+  }
+  const matches = await findFilesByBasename(projectDir, basename);
+  if (matches.length === 0) {
+    return {
+      citation: null,
+      failure: 'missing-file:' + criterionId + ':' + cited,
+    };
+  }
+  if (matches.length === 1) {
+    return {
+      citation: {
+        criterionId,
+        cited,
+        resolved: matches[0],
+        moved: true,
+      },
+      failure: null,
+    };
+  }
+  const named = matches.slice(0, AMBIGUOUS_CANDIDATE_LIMIT).join(',');
+  const more =
+    matches.length > AMBIGUOUS_CANDIDATE_LIMIT
+      ? '(+' + String(matches.length - AMBIGUOUS_CANDIDATE_LIMIT) + ' more)'
+      : '';
+  return {
+    citation: null,
+    failure:
+      'ambiguous-citation:' + criterionId + ':' + cited + ':' + named + more,
+  };
 }
 
 /**
@@ -177,6 +372,9 @@ export async function verifyLocal(
   if (!shape.ok)
     return { ok: false, reason: shape.reason, failures: [shape.reason] };
   const failures: string[] = [];
+  const citations: ResolvedCitation[] = [];
+  // Spot-moved citations so the success path can name the path that proved them.
+  const movedCitations: string[] = [];
   // Shared command budget across all criteria for this verification pass.
   const executed = { count: 0 };
   // One deadline per pass so a padded sidecar cannot run for hours.
@@ -189,15 +387,20 @@ export async function verifyLocal(
         failures.push('traversal-escape:' + c.id + ':' + String(f));
         continue;
       }
-      try {
-        // Require a real file: directories and missing paths both fail proof.
-        const p = path.isAbsolute(f) ? f : path.join(projectDir, f);
-        const st = await fs.stat(p);
-        if (!st.isFile()) {
-          failures.push('not-a-file:' + c.id + ':' + String(f));
+      // Exact path first, then a unique basename hit; ambiguity and no match
+      // both stay failures so a deleted file can never pass as a move.
+      const resolved = await resolveCitation(projectDir, c.id, String(f));
+      if (resolved.failure !== null) {
+        failures.push(resolved.failure);
+        continue;
+      }
+      if (resolved.citation !== null) {
+        citations.push(resolved.citation);
+        if (resolved.citation.moved) {
+          movedCitations.push(
+            resolved.citation.cited + '->' + resolved.citation.resolved,
+          );
         }
-      } catch {
-        failures.push('missing-file:' + c.id + ':' + String(f));
       }
     }
     if (opts?.runTests === true) {
@@ -222,8 +425,19 @@ export async function verifyLocal(
     }
   }
   if (failures.length > 0)
-    return { ok: false, reason: 'evidence-invalid', failures };
-  return { ok: true, reason: 'ok:' + hashEvidence(evidence), failures: [] };
+    return { ok: false, reason: 'evidence-invalid', failures, citations };
+  // Name every moved citation on the success path: the proof is accepted, but
+  // the operator still learns which path answered a citation that had moved.
+  const movedNote =
+    movedCitations.length === 0
+      ? ''
+      : ' moved-citations:' + movedCitations.join(', ');
+  return {
+    ok: true,
+    reason: 'ok:' + hashEvidence(evidence) + movedNote,
+    failures: [],
+    citations,
+  };
 }
 
 /**
@@ -264,6 +478,7 @@ export async function verifyCompletion(args: {
         ok: true,
         reason: 'subagent-pass:' + local.reason,
         failures: [],
+        citations: local.citations,
       };
     return {
       ok: false,
diff --git a/tests/idle-park.test.ts b/tests/idle-park.test.ts
new file mode 100644
index 0000000..9733c5d
--- /dev/null
+++ b/tests/idle-park.test.ts
@@ -0,0 +1,425 @@
+/**
+ * Idle human-gate park tests.
+ * Why these tests exist: the auto-continue loop used to keep spending turns
+ * while the agent was correctly parked waiting for a human answer, so a single
+ * unresolved gate could burn the entire turn budget restating the same status.
+ * These tests pin the streak, the one-shot message, the `question` hint, and the
+ * resume path that turns the loop back on.
+ */
+import { beforeEach, describe, expect, it } from 'vitest';
+import {
+  IDLE_PARK_THRESHOLD,
+  _resetIdleInFlightForTests,
+  buildIdleParkPrompt,
+  handleSessionIdle,
+  observeToolCall,
+  progressKey,
+  scoreContinuationTurn,
+  shouldContinue,
+} from '../src/loop.js';
+import type { IdleDeps, TurnObservation } from '../src/loop.js';
+import { DEFAULT_LIMITS } from '../src/limits.js';
+import { initialState } from '../src/state.js';
+import type { Clock, GoalState } from '../src/state.js';
+import { blockGoal, resumeGoal } from '../src/goal.js';
+
+/** Fixed clock with mutable now so cooldowns can be travelled. */
+class FakeClock implements Clock {
+  constructor(public now: number) {}
+  nowMs(): number {
+    return this.now;
+  }
+}
+
+const T0 = 1700000000000;
+
+/** Active state stamped exactly as the loop saves it. */
+function active(clock: FakeClock, over: Partial<GoalState> = {}): GoalState {
+  const base = {
+    ...initialState('ship the human gate', clock, '2.0.29'),
+    ...over,
+  };
+  // The stamp must match the state, or the first tick reads a foreign mutation.
+  return { ...base, lastTurnKey: progressKey(base) };
+}
+
+/** In-memory deps with a controllable store and captured prompts. */
+function makeDeps(
+  store: { state: GoalState | null },
+  clock: FakeClock,
+  sent: string[],
+  extra: Partial<IdleDeps> = {},
+): IdleDeps {
+  return {
+    clock,
+    limits: DEFAULT_LIMITS,
+    ownerId: 'owner-park',
+    loadState: async () => store.state,
+    saveState: async (_p, s) => {
+      store.state = s;
+    },
+    tryClaim: async (_p, owner, ttl, c) => {
+      const now = c.nowMs();
+      if (store.state === null) return { claimed: false, state: null };
+      const held =
+        store.state.leaseOwner !== null &&
+        store.state.leaseExpiresAtMs > now &&
+        store.state.leaseOwner !== owner;
+      if (held) return { claimed: false, state: store.state };
+      store.state = {
+        ...store.state,
+        leaseOwner: owner,
+        leaseExpiresAtMs: now + ttl,
+      };
+      return { claimed: true, state: store.state };
+    },
+    sendPrompt: async (prompt: string) => {
+      sent.push(prompt);
+      return { messageId: 'msg-' + String(sent.length), tokenSpend: 1 };
+    },
+    hasStopFile: async () => false,
+    ...extra,
+  };
+}
+
+/** One idle tick for the same lane, with an optional turn observation. */
+function tick(
+  deps: IdleDeps,
+  lastTurn: TurnObservation | null,
+  lastMessageId: string | null = null,
+): Promise<{ decision: string; reason: string }> {
+  return handleSessionIdle(
+    {
+      projectDir: '/tmp/idle-park',
+      lastMessageId,
+      sessionId: 'sess-park',
+      lastTurn,
+    },
+    deps,
+  );
+}
+
+beforeEach(() => {
+  _resetIdleInFlightForTests();
+});
+
+describe('scoreContinuationTurn', () => {
+  it('keeps the park threshold inside the designed 2-3 tick window', () => {
+    // Acceptance: a parked goal stops within at most three ticks.
+    expect(IDLE_PARK_THRESHOLD).toBeGreaterThanOrEqual(2);
+    expect(IDLE_PARK_THRESHOLD).toBeLessThanOrEqual(3);
+  });
+
+  it('counts an empty turn and ignores a stale observation', () => {
+    const clock = new FakeClock(T0);
+    const state = active(clock, { lastContinuedMessageId: 'turn-1' });
+    const empty = scoreContinuationTurn(state, {
+      turnId: 'turn-1',
+      usedTool: false,
+      askedQuestion: false,
+    });
+    expect(empty.scored).toBe(true);
+    expect(empty.productive).toBe(false);
+    expect(empty.noProgressTurns).toBe(1);
+    expect(empty.parkRequested).toBe(false);
+
+    // A different turn id is not ours to judge: nothing is counted.
+    const stale = scoreContinuationTurn(state, {
+      turnId: 'turn-other',
+      usedTool: false,
+      askedQuestion: false,
+    });
+    expect(stale.scored).toBe(false);
+    expect(stale.noProgressTurns).toBe(0);
+  });
+
+  it('parks on the threshold, and on a question even before it', () => {
+    const clock = new FakeClock(T0);
+    const atThreshold = active(clock, {
+      lastContinuedMessageId: 'turn-2',
+      noProgressTurns: IDLE_PARK_THRESHOLD - 1,
+    });
+    const tripped = scoreContinuationTurn(atThreshold, {
+      turnId: 'turn-2',
+      usedTool: false,
+      askedQuestion: false,
+    });
+    expect(tripped.noProgressTurns).toBe(IDLE_PARK_THRESHOLD);
+    expect(tripped.parkRequested).toBe(true);
+
+    // A question parks on the very next tick, even after a productive turn.
+    const fresh = active(clock, { lastContinuedMessageId: 'turn-q' });
+    const asked = scoreContinuationTurn(fresh, {
+      turnId: 'turn-q',
+      usedTool: true,
+      askedQuestion: true,
+    });
+    expect(asked.productive).toBe(true);
+    expect(asked.questionAsked).toBe(true);
+    expect(asked.parkRequested).toBe(true);
+  });
+
+  it('resets the streak on a tool call and on a foreign state change', () => {
+    const clock = new FakeClock(T0);
+    const stale = active(clock, {
+      lastContinuedMessageId: 'turn-3',
+      noProgressTurns: 1,
+    });
+    const withTool = scoreContinuationTurn(stale, {
+      turnId: 'turn-3',
+      usedTool: true,
+      askedQuestion: false,
+    });
+    expect(withTool.productive).toBe(true);
+    expect(withTool.noProgressTurns).toBe(0);
+
+    // A mutation by another writer (a slash command, a tool) changes the stamp.
+    const changed = { ...stale, lastSummary: 'evidence recorded elsewhere' };
+    const mutated = scoreContinuationTurn(changed, {
+      turnId: 'turn-3',
+      usedTool: false,
+      askedQuestion: false,
+    });
+    expect(mutated.productive).toBe(true);
+    expect(mutated.noProgressTurns).toBe(0);
+  });
+});
+
+describe('shouldContinue idle park', () => {
+  it('stops a parked goal and lets a human message through', () => {
+    const clock = new FakeClock(T0);
+    const parked = active(clock, {
+      lastTurnAtMs: 0,
+      idleParked: true,
+      lastContinuedMessageId: 'turn-9',
+    });
+    expect(
+      shouldContinue(parked, clock.now, 'turn-9', DEFAULT_LIMITS).reason,
+    ).toBe('idle-awaiting-input');
+    // The answer path does not extend the park: the gate lets it through and
+    // the pre-existing human-message rule decides that tick.
+    const answered = shouldContinue(
+      parked,
+      clock.now,
+      'human-1',
+      DEFAULT_LIMITS,
+      {
+        humanSpoke: true,
+      },
+    );
+    expect(answered.reason).toBe('human-message');
+  });
+});
+
+describe('idle park end to end', () => {
+  it('parks after two empty turns and posts exactly one message', async () => {
+    const clock = new FakeClock(T0);
+    const store = {
+      state: active(clock, {
+        lastTurnAtMs: 0,
+        lastContinuedMessageId: 'seed-turn',
+      }) as GoalState | null,
+    };
+    const sent: string[] = [];
+    const deps = makeDeps(store, clock, sent);
+
+    // Turn one ended empty: it is counted, but a continuation still goes out.
+    const first = await tick(deps, {
+      turnId: 'seed-turn',
+      usedTool: false,
+      askedQuestion: false,
+    });
+    expect(first.decision).toBe('sent');
+    expect(store.state?.noProgressTurns).toBe(1);
+    expect(store.state?.idleParked).toBe(false);
+
+    // Turn two is empty too: the park replaces the continuation.
+    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
+    const second = await tick(deps, {
+      turnId: 'msg-1',
+      usedTool: false,
+      askedQuestion: false,
+    });
+    expect(second.decision).toBe('stopped');
+    expect(second.reason).toBe('idle-awaiting-input');
+    expect(store.state?.idleParked).toBe(true);
+    expect(sent.length).toBe(2);
+    expect(sent[1]).toContain('idle awaiting input');
+    expect(sent[1]).toContain('goal_block <reason>');
+
+    // A third tick stays silent: the one message was already posted.
+    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
+    const third = await tick(deps, {
+      turnId: 'msg-1',
+      usedTool: false,
+      askedQuestion: false,
+    });
+    expect(third.reason).toBe('idle-awaiting-input');
+    expect(sent.length).toBe(2);
+  });
+
+  it('a productive turn resets the streak instead of parking', async () => {
+    const clock = new FakeClock(T0);
+    const store = {
+      state: active(clock, {
+        lastTurnAtMs: 0,
+        lastContinuedMessageId: 'seed-turn',
+      }) as GoalState | null,
+    };
+    const sent: string[] = [];
+    const deps = makeDeps(store, clock, sent);
+
+    await tick(deps, {
+      turnId: 'seed-turn',
+      usedTool: false,
+      askedQuestion: false,
+    });
+    expect(store.state?.noProgressTurns).toBe(1);
+
+    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
+    const productive = await tick(deps, {
+      turnId: 'msg-1',
+      usedTool: true,
+      askedQuestion: false,
+    });
+    expect(productive.decision).toBe('sent');
+    expect(store.state?.noProgressTurns).toBe(0);
+
+    // The next empty turn starts over at one: no park on the third tick.
+    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
+    const after = await tick(deps, {
+      turnId: 'msg-2',
+      usedTool: false,
+      askedQuestion: false,
+    });
+    expect(after.decision).toBe('sent');
+    expect(store.state?.idleParked).toBe(false);
+    expect(sent.some((p) => p.includes('idle awaiting input'))).toBe(false);
+  });
+
+  it('the question tool parks the next tick', async () => {
+    const clock = new FakeClock(T0);
+    const store = {
+      state: active(clock, {
+        lastTurnAtMs: 0,
+        lastContinuedMessageId: 'seed-turn',
+      }) as GoalState | null,
+    };
+    const sent: string[] = [];
+    const deps = makeDeps(store, clock, sent);
+
+    const parked = await tick(deps, {
+      turnId: 'seed-turn',
+      usedTool: true,
+      askedQuestion: true,
+    });
+    expect(parked.reason).toBe('idle-awaiting-input');
+    expect(store.state?.idleParked).toBe(true);
+    expect(sent.length).toBe(1);
+    expect(sent[0]).toContain('asked for a decision');
+    expect(sent[0]).toContain('goal_block <reason>');
+  });
+
+  it('a human answer clears the latch and the loop can continue', async () => {
+    const clock = new FakeClock(T0);
+    const store = {
+      state: active(clock, {
+        lastTurnAtMs: 0,
+        lastContinuedMessageId: 'turn-7',
+        idleParked: true,
+        noProgressTurns: IDLE_PARK_THRESHOLD,
+        lastScoredTurnId: 'turn-7',
+      }) as GoalState | null,
+    };
+    const sent: string[] = [];
+    const deps = makeDeps(store, clock, sent);
+
+    // The host reports a message newer than our continuation: someone answered.
+    const answered = await tick(
+      deps,
+      { turnId: 'turn-7', usedTool: false, askedQuestion: false },
+      'human-answer-1',
+    );
+    expect(answered.reason).toBe('human-message');
+    expect(store.state?.idleParked).toBe(false);
+    expect(sent.length).toBe(0);
+
+    // Once the host reports our continuation again, the loop sends a new turn.
+    clock.now += DEFAULT_LIMITS.minDelayMs + 1000;
+    const resumed = await tick(
+      deps,
+      { turnId: 'turn-7', usedTool: false, askedQuestion: false },
+      'turn-7',
+    );
+    expect(resumed.decision).toBe('sent');
+    expect(sent.length).toBe(1);
+  });
+
+  it('never parks without an observation from the host', async () => {
+    // Fail-safe: the wiring withholds the observation on a host that reports no
+    // tool activity, and the loop must then keep working instead of guessing.
+    const clock = new FakeClock(T0);
+    const store = {
+      state: active(clock, {
+        lastTurnAtMs: 0,
+        lastContinuedMessageId: 'turn-x',
+        noProgressTurns: IDLE_PARK_THRESHOLD,
+      }) as GoalState | null,
+    };
+    const sent: string[] = [];
+    const deps = makeDeps(store, clock, sent);
+    const got = await tick(deps, null);
+    expect(got.decision).toBe('sent');
+    expect(store.state?.idleParked).toBe(false);
+    expect(sent.length).toBe(1);
+  });
+
+  it('goal_resume and goal_block both clear the latch', () => {
+    const clock = new FakeClock(T0);
+    const parked = active(clock, {
+      idleParked: true,
+      noProgressTurns: IDLE_PARK_THRESHOLD,
+      lastScoredTurnId: 'turn-5',
+    });
+    const resumed = resumeGoal(parked, clock);
+    expect(resumed.status).toBe('active');
+    expect(resumed.idleParked).toBe(false);
+    expect(resumed.noProgressTurns).toBe(0);
+    expect(resumed.lastScoredTurnId).toBe('');
+
+    const blocked = blockGoal(parked, 'waiting for the manager', clock);
+    expect(blocked.status).toBe('blocked');
+    expect(blocked.idleParked).toBe(false);
+    expect(blocked.noProgressTurns).toBe(0);
+  });
+});
+
+describe('observeToolCall', () => {
+  it('marks a tool call and detects the question tool', () => {
+    const base: TurnObservation = {
+      turnId: 'turn-1',
+      usedTool: false,
+      askedQuestion: false,
+    };
+    const plain = observeToolCall(base, 'bash');
+    expect(plain?.usedTool).toBe(true);
+    expect(plain?.askedQuestion).toBe(false);
+
+    const asked = observeToolCall(base, 'question');
+    expect(asked?.usedTool).toBe(true);
+    expect(asked?.askedQuestion).toBe(true);
+
+    // No watched turn means nothing to attach the event to.
+    expect(observeToolCall(null, 'bash')).toBeNull();
+  });
+});
+
+describe('buildIdleParkPrompt', () => {
+  it('names the objective and the explicit remedy', () => {
+    const clock = new FakeClock(T0);
+    const prompt = buildIdleParkPrompt(active(clock), 2);
+    expect(prompt).toContain('ship the human gate');
+    expect(prompt).toContain('2 consecutive turn(s)');
+    expect(prompt).toContain('goal_block <reason>');
+  });
+});
diff --git a/tests/tools.test.ts b/tests/tools.test.ts
index e6a71fc..81e2d47 100644
--- a/tests/tools.test.ts
+++ b/tests/tools.test.ts
@@ -881,3 +881,47 @@ describe('goal_set clears stale evidence', () => {
     expect(done.content).toBe('Goal marked complete.');
   });
 });
+
+describe('evidence after completion names the remedy', () => {
+  it('recording against a completed goal says call goal_set first', async () => {
+    // The observed dead end: after a completion the agent retried the same
+    // evidence call, and the bare status report gave it no way forward.
+    const { writeFileSync } = await import('node:fs');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-remedy-'));
+    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+    const defs: CapturedDef[] = [];
+    await registerGoalTools(fakeCtx(defs), dir, new FakeClock());
+    const byName = (name: string): CapturedDef => {
+      const found = defs.find((d) => d.name === name);
+      if (!found) throw new Error('missing tool ' + name);
+      return found;
+    };
+    const session = { sessionID: 'sess-remedy' };
+    await byName('goal_set').execute({ title: 'done already' }, session);
+    await byName('goal_evidence').execute(
+      {
+        id: 'e1',
+        claim: 'proof',
+        files: ['proof.txt'],
+        tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
+      },
+      session,
+    );
+    expect((await byName('goal_complete').execute({}, session)).content).toBe(
+      'Goal marked complete.',
+    );
+    const late = await byName('goal_evidence').execute(
+      {
+        id: 'e2',
+        claim: 'late proof',
+        files: ['proof.txt'],
+        tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
+      },
+      session,
+    );
+    // Pinned wording: the exact dead end must name goal_set as the remedy.
+    expect(late.content).toBe(
+      'Only an active goal can record evidence. Current status: complete. Call goal_set first to start a new goal.',
+    );
+  });
+});
diff --git a/tests/verifier.test.ts b/tests/verifier.test.ts
index 4da9614..df7ca50 100644
--- a/tests/verifier.test.ts
+++ b/tests/verifier.test.ts
@@ -3,10 +3,27 @@
  * Why these tests exist: prove completion needs checked proof, never self-report.
  */
 import { describe, it, expect } from 'vitest';
-import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
+import { mkdtempSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
 import { tmpdir } from 'node:os';
 import { join, dirname } from 'node:path';
 import { verifyLocal, verifyCompletion } from '../src/verifier.js';
+import type { GoalEvidenceFile } from '../src/evidence.js';
+
+/** Evidence with one criterion citing the given paths and a declared pass. */
+function evidenceFor(files: string[]): GoalEvidenceFile {
+  return {
+    version: 1,
+    updatedAtMs: 1,
+    criteria: [
+      {
+        id: 'c1',
+        claim: 'the cited file exists',
+        files,
+        tests: [{ command: 'npm test', exitCode: 0 }],
+      },
+    ],
+  };
+}
 
 /** Scratch project dir with the given relative files. */
 function proj(files: Record<string, string>): string {
@@ -178,3 +195,65 @@ describe('verifier', () => {
     );
   });
 });
+
+describe('movable citations', () => {
+  it('accepts a citation whose file moved to another lane and names it', async () => {
+    // A Kanban promotion is normal workflow: the work was correct, only the
+    // location changed, so the criterion must still prove.
+    const d = proj({ 'tasks/qa/x.md': '# task' });
+    mkdirSync(join(d, 'tasks/completed'), { recursive: true });
+    renameSync(join(d, 'tasks/qa/x.md'), join(d, 'tasks/completed/x.md'));
+    const got = await verifyLocal(d, evidenceFor(['tasks/qa/x.md']));
+    expect(got.ok).toBe(true);
+    expect(got.citations).toEqual([
+      {
+        criterionId: 'c1',
+        cited: 'tasks/qa/x.md',
+        resolved: 'tasks/completed/x.md',
+        moved: true,
+      },
+    ]);
+    // The report states which path actually satisfied the citation.
+    expect(got.reason).toContain('tasks/completed/x.md');
+  });
+
+  it('prefers the exact path over a same-named file elsewhere', async () => {
+    const d = proj({ 'a/x.md': 'a', 'b/x.md': 'b' });
+    const got = await verifyLocal(d, evidenceFor(['a/x.md']));
+    expect(got.ok).toBe(true);
+    expect(got.citations?.[0].resolved).toBe('a/x.md');
+    expect(got.citations?.[0].moved).toBe(false);
+  });
+
+  it('fails an ambiguous basename hit and names both candidates', async () => {
+    // Two files share the name: guessing would prove the wrong file, so the
+    // criterion fails with the candidates visible instead of a silent pick.
+    const d = proj({ 'a/x.md': 'a', 'b/x.md': 'b' });
+    const got = await verifyLocal(d, evidenceFor(['tasks/qa/x.md']));
+    expect(got.ok).toBe(false);
+    const ambiguous = got.failures.find((f) =>
+      f.startsWith('ambiguous-citation:c1:tasks/qa/x.md'),
+    );
+    expect(ambiguous).toBeDefined();
+    expect(ambiguous).toContain('a/x.md');
+    expect(ambiguous).toContain('b/x.md');
+    expect(got.failures.join(' ')).not.toContain('missing-file');
+  });
+
+  it('keeps missing-file when nothing matches by basename', async () => {
+    // Guard against silent verification weakening: a deleted file must never
+    // pass as a move.
+    const d = proj({ 'src/a.ts': 'x' });
+    const got = await verifyLocal(d, evidenceFor(['tasks/qa/gone.md']));
+    expect(got.ok).toBe(false);
+    expect(got.failures).toEqual(['missing-file:c1:tasks/qa/gone.md']);
+  });
+
+  it('keeps not-a-file for a cited directory', async () => {
+    const d = proj({ 'src/a.ts': 'x' });
+    mkdirSync(join(d, 'docs'), { recursive: true });
+    const got = await verifyLocal(d, evidenceFor(['docs']));
+    expect(got.ok).toBe(false);
+    expect(got.failures).toEqual(['not-a-file:c1:docs']);
+  });
+});
```
<!-- END_GIT_DIFF -->
