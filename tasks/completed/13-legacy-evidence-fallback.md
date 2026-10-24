# Task 13: A seeded empty sidecar must not fall back to the legacy evidence file

**File:** `tasks/completed/13-legacy-evidence-fallback.md`
**Status:** closed
**Source:** manager
**Type:** bugfix
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Priority:** High

## Goal

Make a session's own evidence sidecar authoritative once it exists, so the empty file both set lanes seed is respected and the pre-isolation legacy sidecar can never resurrect the criteria a set just discarded.

## Problem

Task 12 made `goal_set` seed a fresh empty sidecar, matching the slash lane. That seed does not survive the next write on a machine that still has the pre-isolation file `.opencode/goal-evidence.json`.

Chain, reproduced live after installing the task 12 build:

1. `goal_set` writes `.opencode/goals/<sid>.evidence.json` with `criteria: []`.
2. `validateEvidenceShape` rejects an empty list as `evidence-empty`, so `loadEvidence` maps the seeded file to `null`.
3. `loadEvidence` then falls back to the legacy sidecar, which still holds four criteria from finished goals.
4. `recordEvidence` appends the new criterion to that legacy list and writes the union back to the scoped file.

Net effect: `goal_complete` returned `Complete blocked: evidence-invalid` after an 82s proof pass, and the scoped sidecar held the four stale criteria again plus the new one. The fallback exists so a session without its own file can read the legacy one once (ADR-010); it must stop the moment the session has a file, empty or not.

## Acceptance Criteria

- [x] `loadEvidence` treats an existing scoped sidecar as authoritative, including when it is empty or fails shape validation.
- [x] A session with no scoped sidecar still reads the legacy one once.
- [x] The legacy sidecar can no longer re-inject criteria after either set lane seeds a scoped sidecar.
- [x] Regression tests cover the fallback boundary and the full legacy-poisoning chain.
- [x] `tsc --noEmit` clean, full suite green, `prettier --check src tests` clean.
- [x] Docs updated: `src/README.md` invariant, root `DECISIONS.md` ADR-013, `CHANGELOG.md`.

## Local TODOs

- [x] Create the task file in `tasks/in-progress/`
- [x] Guard the legacy fallback on scoped-file existence
- [x] Add the fallback-boundary test plus the end-to-end legacy-poisoning test
- [x] Sync docs, ADR-013, CHANGELOG
- [x] Verify, stage, QA, closure

## Execution Log & Reasoning

**Discovery.** The live scoped sidecar `.opencode/goals/ses_<id>.evidence.json` in the HQ repo held the four criteria that task 12 was supposed to discard (`task-328-closure`, `task-328-tests`, `task-329-impl`, `task-329-suite`) plus the criterion this session recorded. The legacy `.opencode/goal-evidence.json` holds exactly those four, which identifies the source.

**Root cause.** `loadEvidence` reads the scoped path, and on `null` falls back to legacy. It cannot tell "no scoped file" from "scoped file that parses to nothing", because an empty criteria list is a shape failure by design (`validateEvidenceShape` returns `evidence-empty`, which the completion gate wants). So the empty file that both set lanes write is indistinguishable from an absent file, and the legacy fallback undoes the reset.

**Fix.** Presence on disk decides: when the scoped path exists, `loadEvidence` reads it and returns its result (valid file, or `null` for an empty or invalid one) without consulting legacy. A session with no scoped file still migrates from legacy once, which is what ADR-010 promised. This is a smaller change than deleting the legacy file on set, keeps other sessions' legacy data intact, and fixes the slash lane as well, since both lanes share `loadEvidence`.

**Assumption A3.** No deletion of legacy runtime state. Reason: the plugin's own rule forbids file-tool writes to goal state, and a delete is the same class of interference; the read-side guard makes the delete unnecessary.

**Assumption A4.** Closure approval from the earlier instruction ("auto approve for closure it") covers this task, because it is the same bug surfaced on a second path rather than new scope. Recorded here so the Kanban close is auditable.

**Deployment note.** The running plugin still carries the pre-fix `loadEvidence`, so this session's goal stays blocked until the Manager pushes this commit and reinstalls. The installed copy that shipped task 12 was verified to still contain the fallback, which is why the poisoning reproduced after that install.

## Verification Evidence

- Command: `rtk test ./node_modules/.bin/vitest run tests/evidence.test.ts tests/tools.test.ts tests/session-isolation.test.ts` | Expected: all pass | Actual: 3 files, 49 tests passed | Exit: 0.
- Command: `rtk test npm test` | Expected: full suite green | Actual: 17 files, 178 tests passed | Exit: 0.
- Command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: no output | Exit: 0.
- Command: `./node_modules/.bin/prettier --check src tests` | Expected: clean | Actual: all matched files use Prettier code style | Exit: 0.
- Command: `npx prettier --check docs/AGENT-TOOLS.md DECISIONS.md CHANGELOG.md src/README.md src/DECISIONS.md tasks/in-progress/13-legacy-evidence-fallback.md` | Expected: clean | Actual: clean | Exit: 0.

Live reproduction before the fix, recorded for the record: after installing the task 12 build, `goal_set` left `.opencode/goals/<sid>.evidence.json` with `criteria: []`, and the next `goal_evidence` wrote back five criteria (the four legacy ones plus the new one). `goal_complete` then ran an 82s proof pass and returned `Complete blocked: evidence-invalid`.

Regression coverage:

1. `tests/evidence.test.ts` — `reads legacy only until the session owns a file`: legacy readable once for a session with no scoped file, then a seeded empty scoped file returns `null` and the legacy bucket stays untouched for legacy-only readers.
2. `tests/evidence.test.ts` — `a scoped file decides even when it is invalid`: an invalid scoped file fails closed instead of borrowing legacy proof.
3. `tests/tools.test.ts` — `legacy sidecar cannot re-inject stale criteria after a set`: a legacy file holding a failing criterion is present, `goal_set` seeds, one criterion is recorded, the scoped file holds exactly that one, and `goal_complete` returns `Goal marked complete.`

## Risk & Rollback

- Risk: a corrupt scoped sidecar now fails closed instead of borrowing legacy criteria. That matches ADR-010's state rule (corrupt scoped never falls back) and is the safe direction for proof.
- Risk: a session that seeded an empty sidecar and then expected to inherit legacy criteria no longer does. That inheritance is the bug, not a contract.
- Rollback: revert the existence guard in `loadEvidence`; nothing else changes.

## Factual Git Diff

- Injected below via `custom_context_stage_and_inject_diff`.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `8b73e978b60f68f2273b9e5201bc263192372981`
<!-- END_GIT_DIFF -->
