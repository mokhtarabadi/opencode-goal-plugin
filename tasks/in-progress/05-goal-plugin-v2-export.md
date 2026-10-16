# Task 05: Goal Plugin V2 Export Shape

**File:** `tasks/in-progress/05-goal-plugin-v2-export.md`
**Status:** in-progress
**Source:** manager
**Type:** bug
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin

## Goal

Host loads the plugin: default export becomes Plugin.define with id plus setup, wiring slash goal plus idle plus compaction to the V2 context. Fixes host LoadError for missing default id.

## Lite Justification

Single-entry rewrite following the proven in-repo sibling pattern (smart-compact, rate-limit-rescue) plus goal-loop V2 wiring. Host error dictates the exact shape. No Brain round needed.

## Acceptance Criteria

- [x] Default export passes host schema with id plus setup
- [x] Slash goal works through V2 command
- [x] Idle auto-continue works through event subscribe
- [x] Compaction restore works through session hook
- [x] All prior tests still green plus new wiring tests

## Local TODOs

- [x] Rewrite entry to Plugin.define shape
- [x] Typecheck plus tests plus dist schema check
- [x] User push plus host restart plus log verification

## Risk & Rollback

Host API drift is the risk, contained by defensive casts plus fail-closed probes. Rollback is revert of the entry commit; pure modules untouched.

## Execution Log & Reasoning

- Host LoadError named the exact defect: default export lacked id. Siblings plus goal-loop gave the proven Plugin.define shape.
- Rewrote src/index.ts entry only, kept all pure modules. Added @opencode/plugin dependency. Dropped CJS because the plugin package ships no require entry.
- Fix note: first wiring test stub lacked session, source correctly skipped prompt. Completed stub, all green.

## Verification Evidence

- Command: cd ~/Develop/Projects/opencode-goal-plugin && npm run typecheck | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && rtk test npm test | Expected: all pass | Actual: 12 files 76 tests passed (74 existing plus 2 new) | Exit: 0.
- Command: node import dist | Expected: id plus setup function | Actual: id opencode-goal-plugin plus setup function | Exit: 0.
- Live: user pushed, host installed fresh from git, zero load failures in new run.
- Live: smoke test on installed copy passes shape plus command plus state plus prompt.
- Live: work instruction fired in the user session on a real /goal call.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
<!-- END_GIT_DIFF -->
