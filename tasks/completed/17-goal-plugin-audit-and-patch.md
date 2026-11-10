# Task 17: Audit the goal plugin against one long session, and fix the three defects it proves

**File:** `tasks/completed/17-goal-plugin-audit-and-patch.md`
**Source:** manager (2026-11-10, after a session where a goal was completed at 07:10 and roughly four hours of later objectives ran with no goal set at all, while the persisted session state showed every counter at zero)
**Type:** bugfix
**Status:** closed
**Finished:** 2026-11-10T11:53:22Z
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Host:** opencode v2.0.29

## Goal

Answer "does the goal plugin need an update?" with evidence, and patch only what is provably wrong. Three defects are provable with failing tests, and each one explains part of the observed session:

1. A goal set late in a long session was over the wall budget on arrival, so the loop sent one wrap-up and never auto-continued it.
2. The `session.error` recovery path rearmed the watchdog from the legacy state path, so the protection for "no `session.idle` ever arrives" never armed for per-session lanes.
3. A one-shot stop wrote the state it had loaded before claiming the lease, so a `goal_set` landing in that window was overwritten by the old goal plus the stop latch.

Everything else in the audit is a documented non-change.

## Audit Findings (five checks)

### 1. Stale state after completion — PASS (no change)

`completeGoal` (`src/goal.ts:414`) spreads the current state, applies `clearIdlePark()` (`src/goal.ts:375`: `idleParked=false`, `noProgressTurns=0`, `lastTurnKey=''`, `lastScoredTurnId=''`), clears both lease fields, and sets `status='complete'`. It leaves `wrapupSent`, `pendingAttempt`, `pendingVerification`, `verificationFailReason` and `lastSummary` as they were.

None of those can mislead a later read, because every consumer gates on `status === 'active'` before touching them: `shouldContinue` (`src/loop.ts:820-823`), `rearmFromState` (`src/watchdog.ts:115`), `handleSessionFailure` (`src/loop.ts:508`), the context/compaction hooks (`src/index.ts:1283`, `src/index.ts:1311`), and `buildContinuationPrompt`/`progressKey`, which only ever run for an active goal. A completed goal is not continued, not injected, and not rearmed.

`lastSummary` cannot describe a *previous* objective: `setObjective` builds a fresh `initialState` (`src/goal.ts:352`, `src/state.ts:269` sets `lastSummary: ''`), so the field always belongs to the current generation. Clearing it on completion would delete the only audit note of the goal that just finished; keeping it is the honest option and is now pinned by a test.

Test pin: **none existed** (only `status` was asserted). Added `tests/goal.test.ts` "completion clears the lease plus the park latch and keeps the last note".

### 2. Metrics accounting — PARTIAL: loop-only is correct, `wallTimeMs` had no writer at all (documented)

- `iterationCount` advances only on a successful continuation send (`src/loop.ts:1196`). The persisted zeros are therefore **correct scope**, not a broken counter: the observed session had no auto-continue send at all after the goal finished, and a goal set and completed by the agent's own turns never sends one.
- `tokenSpend` advances from `sent.tokenSpend` (`src/loop.ts:1199`), which the wiring only sets when the host returns a number (`src/index.ts:999-1001`), otherwise `0`. Best-effort by design.
- `noProgressTurns` / `lastTurnKey` / `lastScoredTurnId` likewise only move on a scored continuation (`src/loop.ts:1209-1215`).
- `wallTimeMs` is different: the only writer is `recordTurnResult` (`src/loop.ts:886`), which **no lane calls**. The wall budget uses `now - createdAtMs` (`src/limits.ts:98`), not this field. So it is declared-but-never-populated telemetry, not "loop-only".

Action: no code change (deleting the field would break the on-disk shape that `isValidState` requires). Added field docstrings in `src/state.ts` saying plainly that the counters are loop-only (zeros are normal) and that `wallTimeMs` is reserved and unadvanced, and marked `recordTurnResult` `@deprecated`/unwired.

### 3. Session isolation — PASS for scoped files, one wrong-path read found and fixed

The documented rule holds: `resolveStatePath`/`sanitizeSessionId` (`src/state.ts:149-196`), `loadGoalStateWithFallback` (`src/state.ts:204-224`), `resolveEvidencePath`/`loadEvidence` (`src/evidence.ts:88-100`, `227-253`), with tests in `tests/session-isolation.test.ts` (slash status, idle tick, evidence, migration, first-write lock, traversal).

No code reads or clears another session's **scoped** goal. The startup rearm scan (`src/index.ts:1234-1251`) reads every scoped file, but each one is rearmed into its own lane (`src/index.ts:1240-1246`), which is the documented per-lane recovery.

The one wrong-path read was the failure listener: it saved the retry to the failing session's scoped file (`src/loop.ts:490`) and then rearmed from `resolveStatePath(projectDir)` — the legacy path — at `src/index.ts:1112`. For a scoped lane that read returns null, so ADR-007's watchdog never armed; where a legacy file existed it could arm another session's legacy goal inside the failing lane. Fixed to `resolveStatePath(projectDir, failID)` at `src/index.ts:1116`.

### 4. Evidence gate and `goal_complete` with zero criteria — PASS, intended

Zero criteria cannot complete. A seeded empty sidecar fails `validateEvidenceShape` (`src/evidence.ts:126`, `evidence-empty`), `loadEvidence` returns null, and `verifyLocal` returns `missing-evidence` (`src/verifier.ts:365-370`), which `tryCompleteWithEvidence` maps to `evidence-required` (`src/verifier.ts:527-529`). Both complete lanes share that helper (`src/index.ts:372`, `src/tools.ts:612`). This matches README ("needs evidence … with file citations plus passing test proof"). No contradiction between code and docs; no change.

### 5. Real bugs demonstrated with a failing test before fixing — three

Each test was written first and observed RED on the unpatched code (see Verification Evidence), then turned GREEN by the fix.

## Problem

**P1 — the wall budget was inherited across objectives.** `setObjective` kept the previous goal's `createdAtMs` while `checkBudget` measures `now - createdAtMs`. The turn budget restarted per objective, the wall budget did not. A goal set more than `maxWallMs` (2 h) after the first goal of a session was over budget before its first tick: the loop sent `Goal budget reached (wall-time) … Stop starting new work` for a brand-new objective, set `wrapupSent`, and every later tick returned `wrapped-up`. The first goal of a long session worked; every later one was dead on arrival.

**P2 — the provider-error rearm read the wrong file.** See finding 3.

**P3 — a one-shot stop could resurrect a replaced goal.** `sendOneShotStop` claimed the lease and then saved `mark(state)` from the pre-claim snapshot (`src/loop.ts:700`, now `mark(fresh)` from the claim snapshot at `src/loop.ts:674`). A `goal_set` between the tick's load and the claim was replaced by the old objective carrying `wrapupSent`/`idleParked`.

## Local TODOs

- [x] Create the task file (id 17 free; checked `tasks/backlog/0001-opencode-goal-plugin.md` and `tasks/in-progress/05-goal-plugin-v2-export.md`)
- [x] Write the three failing tests and capture the RED run
- [x] Fix P1: `setObjective` returns a fresh state (no `createdAtMs` inheritance)
- [x] Fix P2: failure rearm loads the failing session's scoped path
- [x] Fix P3: one-shot stop bases its send and write on the claim snapshot
- [x] Document the metrics fields and deprecate the unwired `recordTurnResult`
- [x] Docs: root `DECISIONS.md` ADR-017/ADR-018, `src/DECISIONS.md`, `src/README.md`, `README.md`, `CHANGELOG.md`
- [x] Bump to 0.2.1 (`package.json` + `PLUGIN_VERSION`)
- [ ] Manager review of the working-tree diff (staging withheld, see Factual Git Diff)

## Acceptance Criteria

- [x] A goal set after `maxWallMs` from the previous goal passes the gate (`shouldContinue` reason `ok`), and `resume` never refreshes the wall clock.
- [x] A `session.error` on a per-session lane arms exactly one watchdog, and no continuation prompt is sent for the failed turn.
- [x] A one-shot stop whose claim snapshot is a different objective sends nothing, reports `state-changed`, leaves the new objective and `wrapupSent=false`, and releases the lease.
- [x] Completion clears the lease and the park latch, and keeps the current generation's `lastSummary` (pinned by test).
- [x] No behaviour change to the evidence gate, the per-session path rule, or the legacy read fallback.
- [x] `npm run typecheck`, `npm test`, `npx prettier --check src tests`, `npm run compile` all clean.
- [x] Docs and decision records updated in the same change (root ADR-017, ADR-018; src README invariant 12; CHANGELOG).

## Verification Evidence

**Pre-fix RED run** (`npx vitest run --no-color tests/goal.test.ts tests/loop.test.ts tests/v2-entry.test.ts`, exit 1):

```
FAIL tests/goal.test.ts > transitions > a new objective starts a fresh wall clock
AssertionError: expected 1700000000000 to be 1700007200001
FAIL tests/loop.test.ts > handleSessionIdle hardening > a one-shot stop never overwrites a goal replaced before the claim
AssertionError: expected 'stopped' to be 'skipped'
FAIL tests/v2-entry.test.ts > v2 setup wiring > a provider error rearms the watchdog from the failing session state
AssertionError: expected +0 to be 1
 Test Files  3 failed (3)
      Tests  3 failed | 37 passed (40)
```

**Full suite after the fixes** (`npm test`, exit 0):

```
 Test Files  19 passed (19)
      Tests  217 passed (217)
   Duration  10.76s
```

(212 before this task; +5 new tests: budget restart, resume keeps the clock, completion-state pin, claim-snapshot stop, provider-error rearm.)

**Typecheck** (`npm run typecheck`, exit 0):

```
> opencode-goal-plugin@0.2.1 typecheck
> tsc --noEmit
```

**Format** (`npx prettier --check src tests`, exit 0):

```
Checking formatting...
All matched files use Prettier code style!
```

**Build** (`npm run compile`, exit 0):

```
ESM dist/index.js 106.47 KB
ESM ⚡️ Build success in 126ms
DTS ⚡️ Build success in 8718ms
```

**Flake check for the async wiring test** (5 consecutive runs of `tests/v2-entry.test.ts`, each exit 0):

```
run 1: Test Files 1 passed (1)  Tests 3 passed (3)
run 2: Test Files 1 passed (1)  Tests 3 passed (3)
run 3: Test Files 1 passed (1)  Tests 3 passed (3)
run 4: Test Files 1 passed (1)  Tests 3 passed (3)
run 5: Test Files 1 passed (1)  Tests 3 passed (3)
```

**Skill-load record:** no local skills exist in this repo (`AGENTS.md` skill table says none), and no project stack skill matches a plain Node/TS plugin, so none were loaded. MCP memory tools (`search_memory`/`list_namespaces`) are not present in this subagent's toolset; the repo's own `DECISIONS.md`, `src/DECISIONS.md`, `src/README.md` and `docs/conventions.md` were read instead.

## Definition of Done

- Three provable defects fixed with a test each, written RED first.
- Every audit check answered with `file:line` evidence, including the checks that needed no change.
- Docs, decision records, and CHANGELOG in sync; version 0.2.1 recorded.
- Working tree verified: full suite, typecheck, format, build all green.
- Task handed to the Manager for approval; no commit and no push.

## Risk & Rollback

- Risk (P1, low): a session can now get a fresh 2 h window per objective. The turn budget already reset per objective, and a new session always reset both clocks, so this does not add a capability the agent did not already have.
- Risk (P2, low): the failure listener now re-arms the watchdog for the lane that failed instead of doing nothing for scoped lanes. Worst case is the retry tick the idle path already performs.
- Risk (P3, low): a stop verdict can now be dropped (`state-changed`) instead of written. It only drops when the objective or status changed under it, i.e. when writing would have destroyed newer state.
- Rollback: revert `setObjective` to the `createdAtMs` inheritance, restore `mark(state)` plus the legacy-path load, and drop the new tests. No state-file shape changed, so old files keep loading.

## Execution Log & Reasoning

- Read `AGENTS.md` (Absent-File Policy applied: `DESIGN.md`, `docs/architecture.md`, `docs/data_model.md` absent here; `docs/conventions.md` read), `README.md`, root `DECISIONS.md`, `src/README.md`, `src/DECISIONS.md`, `docs/conventions.md`, then the sources (`state.ts`, `goal.ts`, `loop.ts`, `index.ts`, `tools.ts`, `verifier.ts`, `evidence.ts`, `limits.ts`, `watchdog.ts`, `compaction.ts`) and the relevant tests.
- Traced the observed zeros: `iterationCount`/`tokenSpend` are written only by the send path, so zeros mean "no continuation ran", which is exactly the observed session. `wallTimeMs` is never written by any lane; documented instead of silently trusted.
- Traced the observed "new objectives never auto-continued": not only "no goal was set" — a goal set would also have been born over budget. That is P1 and it is fixed.
- Wrote the three tests, ran them, captured the RED output above, then fixed one defect at a time and re-ran the focused files.
- Docs: root ADR-017 (per-goal budgets) and ADR-018 (stop/retry writes follow the claimed state and the failing lane), `src/DECISIONS.md` index rows, `src/README.md` invariant 12, README sentence on budgets, CHANGELOG entries appended under `[Unreleased]` (Parse-Then-Append: existing entries untouched).
- Completion-state decision: no change, with a pin test. `lastSummary` is generation-scoped by construction, and clearing it on completion would drop the only note describing the finished goal; every stale-looking field is gated by `status === 'active'` before use.
- Staging/injection: withheld. The audit mandate for this task forbids `git add` (and `git commit`/`push`), so `stage_and_inject_diff` was not called and the diff stays in the working tree for the Manager. The task file is untracked, so it was moved with `mv` rather than `git mv`.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `9537e79784841b1c6b56170c22a89916fd03890f`
<!-- END_GIT_DIFF -->
