# Task 06: Goal Plugin Research plus Improvement to Best Goal Plugin

**File:** `tasks/completed/06-goal-plugin-research-improvement.md`
**Status:** closed
**Source:** manager
**Type:** research
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Mode:** autopilot-locked (Manager requested 100% autopilot with brain help for night run)
**Host:** opencode v2.0.29

## Goal

Research OpenCode V2 plugin system exactly, analyze similar goal plugins in temp plus existing clones, send professional context report to brain, then execute brain-approved improvements to make ours the best goal plugin. All from search, research, development.

## Seat Check

Domains → seats: plugin contracts plus API design → Software Architect; idle loop plus lease plus verification → Senior Programmer. Skipped: UI/UX Designer (no visual surface, reason: server-only plugin), Project Planner plus Sprint Strategist (single research task, no capacity call), QA Engineer plus Code Reviewer (later gates). Trigger eval TITLE+BODY: Architect fires on schema plus contract plus API design; Programmer fires on performance plus silent-fail plus race; Designer miss (no layout or screen words). Cross-disciplinary → 2-seat consult (Architect plus Programmer).

## Brainstorm

Brainstorm: required — cross-disciplinary plus hard to reverse (published plugin contract plus loop behavior).

## Plan Steps (approved 2026-10-16)

1. Read V2 plugin docs and map our entry src/index.ts to host hooks (command, idle subscribe, session hooks).
2. Search similar goal plugins, clone to temp plus reuse /tmp/opencode/goal-research 5 clones, extract best practices (V2 only).
3. Send context report to brain for improvement verdict, then run approved improvement as autopilot night-run task.

## Acceptance Criteria

- [x] V2 docs mapped with Plugin.define id plus setup and event.subscribe cleanup
- [x] Seven clones analyzed with best practices extracted V2-only
- [x] Brain verdict O1 D1-D5 received with fed-context cites
- [x] D1 durable write plus D2 lease plus D3 evidence gate plus D4 cooldown plus D5 strictness implemented
- [x] Full suite 93 pass plus typecheck plus prettier green
- [x] Hotfix F1 idle survival keeps live controller
- [x] Hotfix F2 evidence gate wired plus wrapupSent flips once
- [x] Hotfix F3 setup guard plus schema plus drive-letter check
- [x] Hotfix F4 session-keyed fairness plus 500 cap
- [x] Hotfix F5 quarantine sidecar plus nudge truncate

## Local TODOs

- [x] Create backlog file and move to in-progress
- [x] Fetch V2 docs and clone temp plugins
- [x] Discovery round and brain plan approval
- [x] Implement D1-D5 and add 7 regression tests
- [x] Docs sync plus QA transition

## Risk & Rollback

Risk is host API drift plus budget overrun, contained by fail-closed probes plus global caps. Rollback is revert of this task commit, pure modules keep prior atomic behavior.

## Execution Log & Reasoning

- Assumption A1: night mode means overnight autopilot run with brain help (Manager confirmed via question tool).
- Manager approved Create task file plus Approved research plan, ZAC reminded.
- Found existing clones in /tmp/opencode/goal-research: goal-loop, heimoshuiyu-goal, oh-my-goal, prevalentWare-goal, willytop8-goal. Project temp folder missing, will create temp for new clones.
- V2 docs fetched: Plugin.define id plus setup, V2 ignores server(), ctx domains, sync transforms, event.subscribe AbortController cleanup, session hooks context/compaction, JSON Schema tools, storage scoped by id. Sources: opencode.ai/v2/docs/build/plugins plus migrate-v1 plus flaviocopes tutorial.
- Cloned 2 fresh V1-only auto-continues to temp/: hjzccc (per-session inFlight plus cooldown deferred, agent/model preserve) plus devtoday (error-pattern retry plus throttle UI). Confirms V2-only differentiation.
- Discovery-fed planning: brain_turn 1 returned discovery task, executed via subagent report context_report_20261016_161643_9417f298.md plus tree plus graph 61n/66e. brain_turn 2 returned Architect plus Programmer plan D1-D5 analysis only.
- Brain Plan Verdict (task_id 06): O1 selected — durable atomic write D1 src/state.ts:225-229 plus evidence src/evidence.ts:133-136, fail-closed lease plus token single-flight D2 src/state.ts:244,256-261,277-312 plus src/loop.ts:176-179, evidence-gated complete D3 src/verifier.ts:94-96 plus src/loop.ts:79-111, per-session cooldown D4 src/limits.ts:19-23 plus src/index.ts:423,431,516, V2 strictness D5 src/index.ts:360-362. Manager Approved for D1-D5, routed back through Brain for implementation XML, executing autopilot night run.
- Implementation O1 D1-D5 applied, invariants preserved, per-session versus global cooldown rationale logged, storage versus file-state decision logged (file-state wins). Stack blueprint scan: root markers [package.json] matched [] reason no stack marker found, docs-only gate skipped with fields logged.
- Sibling docs inspected: README.md plus DECISIONS.md read before edits, DECISIONS appended ADR-006, README unchanged (no domain boundary change), CHANGELOG Unreleased Added appended via Parse-Then-Append.

## Verification Evidence

- Command: rtk test npm test | Expected: all pass | Actual: 13 files 83 tests passed (76 baseline plus 7 new) | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: npx prettier --check src/state.ts src/evidence.ts src/loop.ts src/verifier.ts src/goal.ts src/limits.ts src/index.ts src/compaction.ts | Expected: exit 0 | Actual: exit 0 after --write | Exit: 0.
- Command: rtk test npm test -- tests/state.test.ts tests/evidence.test.ts | Expected: pass | Actual: 2 files 9 tests passed | Exit: 0.
- Command: rtk test npm test -- tests/loop.test.ts tests/verifier.test.ts tests/limits.test.ts tests/goal.test.ts tests/v2-entry.test.ts tests/compaction.test.ts | Expected: pass | Actual: pass | Exit: 0.
- Stack gate skip record: root=. markers=[package.json] matched=[] reason=no stack marker found.
- Hotfix QA_REJECTED F1-F5 applied: live controller kept, evidence gate wired in both complete lanes, setup guard duplicated, sessionId threaded to composite keys with 500 cap, wrapupSent flips once on budget hit, nudge truncates to 500 plus null guard, quarantine sidecar proven.
- Hotfix2 H1-H4 applied: Set copy-iterate plus composite key docs, lease proof with stale denies test and line numbers, pruneIdleControllers helper wired with live-kept test, wrapup once plus session fairness plus setup guard integration tests, drive-relative C:escape rejected.
- QA verdict: QA_PASSED with 93 tests green plus typecheck clean (re-QA2 after H1-H4).
- Review verdict: PO_REVIEW_PENDING with technical approval, strengths durability plus lease plus gate plus fairness plus guard, low issues only (prettier noise, dual guard load, manual schema duplicate, unbounded counters).
- Manager accept quote: Approved for closure.
- Closure approved 2026-10-16: QA_PASSED plus Reviewer PO_REVIEW_PENDING plus Manager Approved for closure.
- Command: rtk test npm test | Expected: all pass | Actual: 13 files 93 tests passed | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `376af689535ee21c6ea4882b5ee9a55ab0d828bf`
<!-- END_GIT_DIFF -->
