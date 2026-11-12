# Task 18: Stale goal garbage collection and startup rearm guard

**File:** `tasks/in-progress/18-stale-goal-gc-and-rearm-guard.md`
**Source:** manager
**Type:** improvement
**Status:** open

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

- [ ] Add an age threshold for a stale goal state and a GC pass over the per-session goal files
- [ ] Guard the startup rearm so only a recent pending attempt re-arms the watchdog
- [ ] Ensure the state lease is released on every lane exit path
- [ ] Keep the idle park on a human gate intact and covered by a test
- [ ] Add tests for GC, the rearm guard, and lease release
- [ ] Update `CHANGELOG.md` via Parse-Then-Append
- [ ] Update sibling `src/README.md` and `src/DECISIONS.md` where the contract changed
- [ ] Verify the typecheck and the full test suite pass with exit code 0

## Acceptance Criteria

- [ ] A goal file older than the stale threshold is not eligible for the startup rearm
- [ ] A goal file older than the stale threshold is collected by the GC pass and the collection is logged
- [ ] A recent pending attempt still re-arms the watchdog exactly as before
- [ ] The idle park on a human gate still fires after two unproductive turns
- [ ] A `question` tool call still parks the goal on the next tick
- [ ] No lane exit path leaves a lease held past its TTL without an explicit release
- [ ] GC never touches a goal whose status is `active` for the current session
- [ ] Typecheck and the full test suite pass with exit code 0

## Verification Evidence

- **Test command:** rtk test npm test
- **Expected result:** all tests pass with exit code 0
- **Actual result:** _(The Hands fill this during execution)_
- **Exit code:** _(The Hands fill this during execution)_
- **Test command:** rtk test npm run typecheck
- **Expected result:** `tsc --noEmit` reports no error, exit code 0
- **Actual result:** _(The Hands fill this during execution)_
- **Exit code:** _(The Hands fill this during execution)_

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true:

- [ ] Build/Test/Lint pass with exit code 0
- [ ] `lint_task_file` passes on the active task file
- [ ] `CHANGELOG.md` updated via Parse-Then-Append
- [ ] `testing-verification` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** An over-aggressive GC threshold could collect a goal the operator still wants, losing the objective text and the evidence sidecar.
- **Rollback plan:** GC only collects files that are already past the stale threshold and never touches a current-session active goal. The GC threshold is a single named constant, so lowering it restores the previous behavior in one edit. The collection is logged with the file path so a wrongly collected goal is recoverable from the git history of the workspace.

---

## Execution Log & Reasoning

_(The Hands: Manually log your technical changes, file edits, and architectural reasoning here BEFORE calling the MCP tool)_

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->

_(Git diff will be automatically injected here by the MCP tool. Do not edit this block manually)_

<!-- END_GIT_DIFF -->
