# Task 02: Goal Plugin Phase 2 Idle Loop

**File:** `tasks/completed/02-goal-plugin-phase2.md`
**Status:** closed
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

## Closure

Night Work delegated closure: close on reviewer technical approval with own commits, never batched (Brain Project Planner ruling plus manager delegation to decide and close for clean git).
Closure scope: Phase 2 idle loop with budgets, technically approved, 46 of 46 tests green.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `594148b299dffa3f1ab2fa0ceae275bce6b3740a`
<!-- END_GIT_DIFF -->
