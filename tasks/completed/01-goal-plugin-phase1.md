# Task 01: Goal Plugin Phase 1 Scaffold

**File:** `tasks/completed/01-goal-plugin-phase1.md`
**Status:** closed
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
- Review: Code Reviewer technical approval PO_REVIEW_PENDING (strengths S1-S4, 3 low issues I1-I3 tracked for Phase 2). File stays in tasks/qa pending explicit closure word.
- Closure: Manager approval quoted Approved for closure on 2026-10-16. QA_PASSED plus PO_REVIEW_PENDING both verified present.

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

## Closure

Manager approval: Approved for closure on 2026-10-16.
Closure scope: move to completed without code changes.
Closure note: file moved from tasks/qa to tasks/completed with status closed and no code changes. File header reads tasks/completed/01-goal-plugin-phase1.md.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `7df40a7378d1c6d26447ab65167b2594303065e2`
<!-- END_GIT_DIFF -->
