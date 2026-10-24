# Task 12: Tool-lane goal_set must clear stale evidence

**File:** `tasks/completed/12-tool-set-clears-stale-evidence.md`
**Status:** closed
**Source:** manager
**Type:** bugfix
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Priority:** High

## Goal

Make `goal_set` reset the session evidence sidecar, so criteria recorded for a previous goal can never gate the next one.

## Problem

The slash lane seeds a fresh empty sidecar on every `/goal <objective>` (`src/index.ts:855-861`), but the tool lane's `toolSet` only saves state (`src/tools.ts:236`). `goal_evidence` appends to whatever the file already holds (`src/tools.ts:474-494`), and the completion gate validates and executes every criterion in it (`src/verifier.ts:184-225`, observation on by default through `tryCompleteWithEvidence`).

Consequence, reproduced live: one session's sidecar accumulated six criteria from three finished goals, one of which recorded `rtk test uv run --project mcp-context-server --with pytest --with pyyaml python -m pytest tests/ -q`. That command now exits 1, so every later `goal_complete` returned `Complete blocked: evidence-invalid` after re-running the historical commands (89s), with no way to see which criterion failed. Duplicate-id rejection (`src/tools.ts:476-478`) also makes a stale entry impossible to correct in place.

## Acceptance Criteria

- [x] `goal_set` writes a fresh empty evidence sidecar for the caller's storage session.
- [x] A criterion recorded for goal A is absent from the sidecar after `goal_set` starts goal B in the same session.
- [x] Completion succeeds for goal B with only goal B's evidence, even when goal A's recorded command fails.
- [x] Slash and tool lanes agree: both reset evidence on set.
- [x] Regression tests cover the stale-criteria path.
- [x] `tsc --noEmit` clean, full suite green, `prettier --check src tests` clean.
- [x] Docs updated: `docs/AGENT-TOOLS.md`, `src/README.md`, root `DECISIONS.md` ADR-012.

## Local TODOs

- [x] Create task file and move to in-progress
- [x] Fix `toolSet` to seed empty evidence under the same storage session
- [x] Add regression tests for stale-criterion removal and completion after a re-set
- [x] Sync docs plus ADR-012 plus CHANGELOG
- [x] Verify, stage, QA, closure

## Execution Log & Reasoning

**Diagnosis (confirmed before any edit).** The installed plugin copy at `~/.cache/opencode/npm/git-opencode-goal-plugin-19cea11cebac/1792709155348/node_modules/opencode-goal-plugin` is byte-identical to local `HEAD` (`24a04b2`) for both `src/tools.ts` and `src/index.ts`, so the live failure reproduces from this source, not from a stale build. The session sidecar under `../../cognitive-lead-hq/.opencode/goals/` held six criteria from three goals; one of them, `task-328-closure`, records `rtk test uv run --project mcp-context-server --with pytest --with pyyaml python -m pytest tests/ -q`, which today exits 1. `goal_complete` re-ran it in observed mode and returned `Complete blocked: evidence-invalid` after 89s measured.

**Root cause.** `toolSet` saved state and nothing else. The slash lane seeds `saveEvidence(projectDir, emptyEvidence(clock.nowMs()), storage)` right after `saveGoalState`; the tool lane did not. `goal_evidence` appends to the sidecar it finds, and `tryCompleteWithEvidence` validates and executes every criterion in it, so criteria outlive the goal that produced them and a finished goal's failing command gates every later goal.

**Fix.** One seed call in `toolSet` after `saveGoalState`, using the same `storage` value already computed for the state path, so scoped and legacy lanes stay aligned with the slash lane. Best-effort by design, matching the slash lane: the goal is already saved, and a failed seed leaves the old criteria rather than undoing the set. Nothing in `evidence.ts`, `verifier.ts`, or `proof.ts` changed, so evidence shape, sole-writer rule, and observed proof semantics are untouched.

**Assumption A1.** The seed is `emptyEvidence(clock.nowMs())`, not a deletion. Deleting would also work, but the two lanes would then differ on disk, and the parity test compares on-disk state. Reason: parity is the invariant the tool lane exists to preserve (ADR-008).

**Assumption A2.** Stale-criterion cleanup is limited to the set lane. `goal_complete` and `goal_clear` are unchanged. Reason: a clear or complete ends a goal but leaves its audit trail; re-set is the point where the criteria stop belonging to anything.

**Known limitation, deliberately out of scope.** `goal_evidence` still rejects a reused id, so correcting a wrong criterion inside the same goal needs a new id. Widening this task would change evidence semantics, which the acceptance criteria exclude. Recorded in ADR-012.

**Test-side consequence.** Four pre-existing tests asserted "no write" as `existsSync(evidencePath) === false`. A seeded empty sidecar makes that file exist, so those assertions now read the criteria array on disk instead, which is the contract they actually guard: no criterion was appended. A shared `readCriteria` helper does the raw read because `loadEvidence` maps an empty sidecar to `null` (`evidence-empty` is a shape failure), so it cannot report the seeded file at all.

**Docs.** `docs/AGENT-TOOLS.md` gained the reset rule under Tool 1 and in hard constraint 1. `src/README.md` gained invariant 7. Root `DECISIONS.md` gained ADR-012 and `src/DECISIONS.md` gained its index row. `CHANGELOG.md` gained one `### Fixed` bullet.

**Deployment note for the Manager.** The running OpenCode process loads the cached GitHub copy of this plugin, not this worktree. The fix reaches the live plugin only after this commit is pushed to `github:mokhtarabadi/opencode-goal-plugin` and OpenCode is restarted.

**Closure authorization.** The Manager pre-authorized closure in the same request that opened this task ("create a task inside the repo and fix the bug and auto approve for closure it"), so the Kanban close ran without a separate review turn. No QA or review verdict is claimed here; the recorded evidence is the command output above.

**Lint note.** `lint_task_file` reports `File path mismatch` for this file because it compares the header literal against the absolute path it resolves. Every task file in this repository, including the closed ones from 01 through 11, uses the same relative `**File:**` header and produces the same single warning, so the header follows repo convention rather than the linter's absolute-path expectation.

**Prettier scope note.** `prettier --check src tests` is the gate and it is clean. The task file itself is not prettier-stable once the injected diff block lands, because diffs of Markdown docs contain triple-backtick lines that end the injected fence; tasks 10 and 11 are in the same state. The file was prettier-clean before injection and its prose was checked again after the final edits by inspection.

## Verification Evidence

- Command: `rtk test ./node_modules/.bin/vitest run tests/tools.test.ts` | Expected: all tools tests pass | Actual: 36 passed (33 existing plus 3 new) | Exit: 0.
- Command: `rtk test npm test` | Expected: full suite green | Actual: 17 files, 175 tests passed | Exit: 0.
- Command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: no output, exit 0 | Exit: 0.
- Command: `./node_modules/.bin/prettier --check src tests` | Expected: clean | Actual: all matched files use Prettier code style | Exit: 0.
- Command: `npx prettier --check docs/AGENT-TOOLS.md DECISIONS.md CHANGELOG.md src/README.md src/DECISIONS.md` | Expected: clean | Actual: all matched files use Prettier code style | Exit: 0.

Regression coverage added in `tests/tools.test.ts` under `goal_set clears stale evidence`:

1. `drops criteria recorded for the previous goal` — records a criterion whose command exits 1, re-sets the goal, asserts the criteria list is empty on disk, then reuses the freed id successfully.
2. `completes a new goal even when the old goal recorded a failing command` — the exact live failure: old goal records an exit-1 command, new goal records an exit-0 command, `goal_complete` returns `Goal marked complete.`
3. `slash set and tool set leave the same evidence state` — both lanes leave an empty criteria list.

## Risk & Rollback

- Risk: a `goal_set` that replaces an active goal now also discards its recorded evidence. That is the intended contract and matches the slash lane; a caller that wants the proof keeps it by not re-setting.
- Risk: the seed write is best-effort, so a failed write leaves the old criteria. Same failure mode as the slash lane; the verifier still fails closed rather than passing on missing proof.
- Rollback: delete the seed block in `toolSet`; state behavior is untouched and the slash lane is unaffected.

## Factual Git Diff

- Injected below via `custom_context_stage_and_inject_diff`.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `e3d05af367abf8ce7406d1fb357a94646b639aa2`
<!-- END_GIT_DIFF -->
