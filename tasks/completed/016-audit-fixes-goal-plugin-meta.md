# Task 016: Audit fixes for opencode-goal-plugin (meta)

**File:** `tasks/completed/016-audit-fixes-goal-plugin-meta.md`
**Source:** manager
**Type:** improvement
**Status:** closed
**Finished:** 2026-10-31T06:40:32Z
**Meta:** true

## Source Context

## Supersedes

[016] (standalone audit fix task, no source tasks bundled)

## Bundled Checklist (All-or-Nothing)

- [ ] Fix package.json version range ^2.0.19 → ^2.0.28 (no 2.0.19 published)
- [ ] Add try-catch around ctx.command.transform() in setup()
- [ ] Add try-catch around session.hook() calls in setup()
- [ ] Return cleanup function from setup() (clear watchdog timers)
- [ ] Add outer error boundary in hook callback bodies
- [ ] Run full test suite after all fixes
- [ ] Brain QA + review

## Goal

Fix all MEDIUM and LOW severity findings from the OpenCode V2 plugin audit of `opencode-goal-plugin`. The audit cross-referenced every plugin API call in `src/index.ts` against the latest `@opencode/plugin` SDK contract (v2.2.5) and official documentation.

## Manager's Notes

Audit verdict: PASS_WITH_WARNINGS. Key issues:
- MEDIUM: package.json declares ^2.0.19 but npm has no 2.0.19 (jumps 2.0.18→2.0.25). Resolves to untested 2.2.5.
- MEDIUM: setup() has no try-catch around ctx.command.transform() and session.hook() — crashes if any fails
- MEDIUM: No cleanup function returned from setup() — watchdog timers may leak on unload
- LOW: session.hook() promise has .catch() but outer hook callback has no error boundary
- LOW: ctx.storage not used (file-based state by design) — already documented in code

## Local TODOs

- [ ] Fix package.json version range
- [ ] Add try-catch around ctx.command.transform() in setup()
- [ ] Add try-catch around session.hook() calls in setup()
- [ ] Return cleanup function from setup()
- [ ] Add outer error boundary in hook callbacks
- [ ] Run full test suite after all fixes
- [ ] Brain QA + review

## Acceptance Criteria

- [ ] All MEDIUM findings resolved or documented with rationale
- [ ] All LOW findings resolved or documented with rationale
- [ ] Full test suite passes (npm test)
- [ ] No regression in existing goal behavior
- [ ] Brain QA passes and Code Reviewer approves

## Verification Evidence

- **Test command:** `npm run typecheck && npm test`
- **Expected result:** All tests pass, exit 0
- **Actual result:** tsc --noEmit clean; 18 test files, 193 tests passed
- **Exit code:** 0

## Execution Log & Reasoning

- Changed package.json dependency `@opencode/plugin` from `^2.0.19` to `^2.0.28`.
- Added `clearAllWatchdogs()` to src/watchdog.ts and exported it; `_resetWatchdogsForTests()` now delegates.
- Imported `clearAllWatchdogs` in src/index.ts and invoked it inside the setup() cleanup return so watchdog timers are cleared on unload.
- Verified try-catch already surrounds `ctx.command.transform()` and `session.hook()` registration; hook callback bodies already have outer try-catch plus promise `.catch()`.
- Typecheck and full suite pass (193/193).

## Risk & Rollback

- Changes are isolated to src/index.ts and package.json
- Rollback: `git checkout -- src/index.ts package.json`
- No external dependencies changed
- Plugin remains backward-compatible (same hook contract)

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `9e3b5a4ee6b6771eb6ede1a618a39615512903c0`
<!-- END_GIT_DIFF -->