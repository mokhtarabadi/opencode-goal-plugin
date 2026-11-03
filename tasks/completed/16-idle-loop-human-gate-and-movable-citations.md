# Task 16: stop the idle loop from spending turns on a human gate, and unbreak evidence when a cited file moves

**File:** `tasks/completed/16-idle-loop-human-gate-and-movable-citations.md`
**Source:** manager (2026-11-03, after one long session where the plugin fired repeated continuation prompts while the agent was correctly parked waiting for a manager decision, and where completion was blocked three times because a cited task file had moved lanes)
**Type:** improvement
**Status:** closed
**Finished:** 2026-11-03T19:04:39Z

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
- **Closure (2026-11-03):** manager answered the relayed PO question with "Approved for closure (both)", naming this task and the smart-compact task together. Moved to `tasks/completed/`, status closed. Committed through the MCP closure path only; no direct git commands were used.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `da090989bc6fcd8c826d1503caaee80e8a65c44a`
<!-- END_GIT_DIFF -->
