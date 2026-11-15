# Task 18: Stale goal garbage collection and startup rearm guard

**File:** `tasks/completed/18-stale-goal-gc-and-rearm-guard.md`
**Source:** manager
**Type:** improvement
**Status:** closed
**Submitted:** 2026-11-15T08:32:10Z
**Finished:** 2026-11-15T08:43:03Z

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
- Closure 2026-11-15: Manager accept quote `Approved for closure`; header synced to completed with Status closed.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `2662fe62fbfbb2811c83a0b42949b5a8bacf126f`
<!-- END_GIT_DIFF -->
