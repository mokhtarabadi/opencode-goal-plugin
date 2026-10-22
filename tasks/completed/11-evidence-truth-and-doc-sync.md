# Task 11: Observed test proof and doc sync

**File:** `tasks/qa/11-evidence-truth-and-doc-sync.md`
**Status:** in-progress
**Source:** manager
**Type:** bugfix
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Priority:** High

## Goal

Close the forgeable evidence gate by observing test results at completion time, and sync five stale docs that still describe the pre-isolation single state file.

## Problem

`verifyLocal` in `src/verifier.ts` trusts the `exitCode` the caller wrote into `.opencode/goal-evidence.json`. The model writes that value through `goal_evidence`, so it can claim `npm test` exited 0 without running anything. The gate rejects empty proof, not false proof.

Separately, five docs still describe one shared file after the per-session isolation change: `README.md:41`, `AGENTS.md:4`, `AGENTS.md:63`, `docs/AGENT-TOOLS.md:7,11-12,159,164`, `docs/conventions.md:9`, plus `DECISIONS.md` ADR-001.

## Acceptance Criteria

- [x] Completion executes each recorded test command in the project dir under a hard timeout and requires an observed exit 0.
- [x] A fabricated `exitCode: 0` with a failing command blocks completion.
- [x] Timeouts and spawn errors fail closed with distinct reasons.
- [x] Legacy callers of `verifyLocal` keep the old declare-only behavior.
- [x] Docs describe the per-session layout plus legacy fallback accurately.
- [x] typecheck clean, full suite green.

## Local TODOs

- [x] Create task file and move to in-progress
- [x] Sync five stale doc spots plus gitignore and ADRs
- [x] Implement `src/proof.ts` runner and wire it into the complete path
- [x] Add proof tests and update affected evidence tests
- [x] CHANGELOG entry, verify, stage, move to qa

## Execution Log & Reasoning

- Created from manager review of the plugin self-assessment.
- [LITE] justification: manager said "do it" on a two-part proposal; the doc half is text-only and the code half touches only the verifier plus a new runner with tests, no financial or migration surface, reversible by reverting `src/proof.ts` and the `runTests` default. Escalated to full mode? No, hidden complexity stayed inside the plan.
- Seat Check: domains → verifier contract plus evidence schema plus docs → Software Architect. Skipped Designer (server-only, no visual surface), Senior Programmer (plan executed directly, single module), QA/Reviewer (later gates), Planner/Strategist (single fix). Trigger eval: Architect fires on [schema, contract]; Programmer trigger [flaky|race|deadlock|silent-fail|performance] miss; Designer miss. Brainstorm: not required, one domain and reversible.
- Plan from the manager's own approval: (1) sync stale docs, (2) make the gate observe reality. No Brain turn was required because the manager's explicit words are the plan per the Planning Gate; recorded here as the approved path.
- Doc sync targets and what changed: `README.md` usage block (per-session paths plus observed gate), `AGENTS.md:4` (Rules line) and `AGENTS.md:63` (runtime-state gitignore now lists `.opencode/goals/`), `docs/AGENT-TOOLS.md` (both lanes sentence, one-idea paragraph, hard constraints 1 and 5, new constraint 6 about observation), `docs/conventions.md:9`, `commands/goal.md` (complete line plus layout note), `.gitignore`, `DECISIONS.md` ADR-001 supersession line plus ADR-010 and ADR-011.
- Code: new `src/proof.ts` with `runProofCommand` (explicit `/bin/sh`, cwd pinned to project dir, 300s timeout, 1 MiB cap, sha256 output digest, non-interactive env) plus `PROOF_MAX_COMMANDS = 20`. `src/verifier.ts` gained `VerifyLocalOptions`, `observeCriterionTests` (prefers a declared-passing command, falls back to the first non-empty one, shares one budget across criteria), `runTests` wiring on `verifyLocal`, `verifyCompletion`, and `tryCompleteWithEvidence` (default ON at the complete path). Both complete lanes now pass `clock`.
- Why observation is on by default only in `tryCompleteWithEvidence`: both user and agent complete lanes go through it, while direct `verifyLocal` callers keep declare-only so existing suites and external callers do not suddenly shell out.
- Repair R1: first run failed the timeout test because `unrunable()` hard-coded `timedOut: false`. Fix: `unrunable` takes an explicit `timedOut` flag and the timeout branch passes true. Also widened timeout detection to `killed === true` or a `SIGTERM`/`SIGKILL` signal, since exec does not always set `killed`.
- Repair R2: two tool tests completed with `npm test` recorded, which now really executes in a temp dir with no package.json. Swapped those fixtures to `node -e "process.exit(0)"` so the test asserts the same behavior with proof that actually passes.
- Assumption A1: recorded commands are trusted to be runnable in the project dir; a command that needs a different cwd fails closed rather than being retried elsewhere. A2: 20 commands per pass is enough for realistic evidence; the cap reports `test-cap:<id>` instead of silently skipping.
- Not done on purpose: `goal_evidence` does not pre-run commands. Observation happens once at the gate, so recording stays cheap and a slow suite is paid only at completion.
- QA_REJECTED round 1 (real bypass, fixed same session): F1 `observeCriterionTests` ran only one command per criterion, so a trivial passing command beside a failing suite would pass. Fix: loop over every non-empty command, fail on the first non-zero/timeout/unrunnable. F2 `/bin/sh` was hardcoded and broke Windows; now `ComSpec` on win32, `/bin/sh` elsewhere, plus explicit `killSignal: SIGTERM`. F3 cwd had no absolute check; a relative `projectDir` now returns `invalid-cwd` without spawning. F4 the tool lane held a 120s lease while a pass can run longer; complete now claims with `PROOF_TOTAL_TIMEOUT_MS + 60000` and the pass itself has a shared 600s deadline (`test-budget` on exhaustion).
- Stale-ref sweep after the QA grep: `docs/AGENT-TOOLS.md:67,111` still named the legacy evidence file as the gate target; both now name the session sidecar and state that commands are executed. Remaining `goal-state.json` hits are legacy-fallback or gitignore lines only.
- New tests (5): multi-command bypass fails on the failing command, timeout through `verifyLocal`, unrunnable command mapping, 21-criteria cap reporting `test-cap:e20`, and relative-cwd rejection.
- REVIEW_REJECTED_NEEDS_FIXES round 1 (fixed same session): F5 slash `/goal complete` held no lease at all while a proof pass can run up to 600s, so a competing lane could mutate mid-verification. Fix: the slash complete branch now claims the lease with the same `PROOF_TOTAL_TIMEOUT_MS + 60000` TTL as the tool lane, returns the shared busy message on contention, and releases in `finally` so a blocked verdict never strands the lock. F6 ADR-011 and the CHANGELOG entry described a single "preferred command" and an unconditional `/bin/sh`; both now describe every-command observation, the platform shell, the 600s pass deadline, and the slash lease. Two regression tests added: concurrent slash completes yield exactly one winner plus one busy, and a blocked verdict leaves `leaseOwner: null` with a claimable lease.
- Assumption A3: a second concurrent completion is expected to fail with a busy message rather than queue. Completion is a deliberate one-shot action, so contention should surface immediately instead of blocking a tool call.
- REVIEW_REJECTED_NEEDS_FIXES round 3 (real lost-update bug, fixed same session): the slash lane built `next` before claiming the lease and saved it after a proof pass that can run 600s, so a `goal_set` during the pass was silently overwritten. First attempt reloaded before verification, which did not close the window; the test proved it by writing a replacement goal mid-pass and still observing `Goal marked complete.`. Final fix: both lanes verify first, then reload the state, then compare the objective against the one the completion started with, then transition and save. A changed objective returns `Goal state changed while completing. Run /goal status and retry.` and writes nothing. Regression test `a goal set during a slow completion is never overwritten` replaces the goal during an 800ms proof and asserts the new goal survives with status active.
- F7 missing component docs: `src/` had no sibling README or DECISIONS despite the Living Folder Docs rule. Added `src/README.md` (module map plus seven invariants and two risks) and `src/DECISIONS.md` (ADR-to-module index plus two local notes), and added the one-line `Sibling Docs:` pointer to all eleven modules.
- Why the reload sits after proof, not before: the only snapshot safe to write is the one read after the longest operation, because proof execution is the window where another writer can legitimately replace the goal. Reload-then-verify still left that window open.
- REVIEW_REJECTED_NEEDS_FIXES round 4 (mixed: one stale citation, two real gaps, fixed same session). F8 "per-session docs are not true for all lanes" is stale context: `resolveStatePath(projectDir, sessionId)` has taken a session since the isolation task, and the only session-less reads are the two intentional legacy fallbacks (`src/index.ts` startup rearm at the legacy path and `src/loop.ts:301,653` building the legacy fallback path). Every live lane passes a session. F9 "goal_set bypasses the lease" was real: slash `set`, `block`, `resume`, and `clear` never claimed, so a set could land during another lane's 600s proof pass. Fixed with `withSlashLease`, a unique owner per call (`slash:<session>:<seq>`), a skip when the scoped file does not exist yet, a save-failure message when the claim itself throws, and a `finally` release. F10 "objective-only comparison" was real: both complete lanes now compare `goalIdentity`, which covers objective, creation time, status, iteration count, and recovery epoch, so a block, clear, or loop turn during the pass also aborts.
- F11 "proof commands are not confined to the workspace" is a documentation-accuracy issue, not a code defect: `cwd` is a starting directory, not a sandbox, and the doc now says so.
- Lesson recorded: the first lost-update test passed only because the replacement used a different owner; a same-owner claim re-enters its own lease. The regression test now asserts the falsifiable behavior (replacement refused as busy while the original goal completes).
- REVIEW_REJECTED_NEEDS_FIXES round 5. F12 migrate-on-write race was real and is fixed: when the scoped file does not exist, `withSlashLease` now takes the dedicated `.lock` for the scoped path via the new `withClaimLock` in `state.ts`, so concurrent first writes serialize without ever writing a lease into the legacy file; the helper also creates the goals dir first, because `wx` create fails ENOENT before the first save. Regression test: two concurrent blocks on a legacy-only goal produce exactly one success and one busy, and the scoped file ends `blocked`.
- F13 "proof commands are not confined to the workspace" is disputed as a defect and accepted as a documented limitation. The runner was never claimed to be a sandbox; `proof.ts`, `src/README.md`, and ADR-011 now say in plain words that `cwd` is a starting directory, that absolute paths and `cd` still reach the machine, and that the runner must never receive a command from an untrusted party. Enforcing confinement would need OS-level sandboxing (namespace or container), which is out of scope for a plugin whose caller already holds shell access and would be a false guarantee if approximated by string filtering.
- Round-5 fix commands: `rtk test npm test` 17 files / 170 tests passed exit 0; `tsc --noEmit` clean exit 0; `prettier --check src tests` clean exit 0.
- REVIEW_REJECTED_NEEDS_FIXES round 6. F14 was real and is fixed: completion bypassed the migration lock, and the tool lane returned "claimed" for a missing scoped file without holding anything. Both now use the scoped lock: `state.ts` exposes `acquireScopedLock`, `releaseScopedLock`, and `withClaimLock`; the slash completion body is extracted as `finishComplete` and runs either under `withClaimLock` (no scoped file yet) or under the lease; `claimForTool` takes the lock for a first write and `releaseToolLease` releases it. This also removes a real functional bug: a legacy-only user running `/goal complete` with a session previously got "busy" forever because the lease could not be claimed on a file that did not exist yet.
- F13 (sandbox) stays disputed and is now worded so no document claims confinement: `proof.ts`, `src/README.md`, and ADR-011 all say `cwd` is a starting directory, that absolute paths and `cd` still reach the machine, and that the runner must never receive an untrusted command. Implementing real confinement needs OS-level isolation, which this plugin cannot promise portably.
- Review round count: the gate rejected six times, each time with at least one real defect except the sandbox policy point. Escalated to the Manager per the retry guard instead of looping further.
- REVIEW_REJECTED_NEEDS_FIXES round 7 (two real defects, fixed same session). F15 shared-guard release: `releaseToolLease` unlinked `statePath + '.lock'` even when the operation held only a lease, which could delete another writer's lock. `claimForTool` now returns a `ToolClaim` with a `release` closure that undoes exactly what it took, and all five tool bodies call `claim.release()` in their `finally`. F16 first-write bypass: `withSlashLease` ran unguarded when no state existed, and `claimForTool` returned claimed without a guard; both now take the scoped lock for the first write.
- Round-7 fix commands: `rtk test npm test` 17 files / 170 tests passed exit 0; `tsc --noEmit` clean exit 0; `prettier --check src tests` clean exit 0.
- REVIEW_REJECTED_NEEDS_FIXES round 8 (one real defect, fixed same session). F17 tool owner was `tool:<session>` for every call, and the lease lets a repeated owner re-claim, so two concurrent calls in one session could both enter a read-modify-write. `toolOwner` now appends a monotonic per-call sequence. Regression test holds the lease as `tool:sess-R` and proves a same-session tool call is refused as busy.
- Round-8 fix commands: `rtk test npm test` 17 files / 171 tests passed exit 0; `tsc --noEmit` clean exit 0; `prettier --check src tests` clean exit 0.
- Retry guard: eight review rounds, every concrete defect fixed, and the only objection that remains is OS-level sandboxing for proof commands, which this plugin cannot deliver portably. Escalated to the Manager for the closure decision instead of a ninth round.
- REVIEW_REJECTED_NEEDS_FIXES round 9 (one real defect, fixed on the Manager's "one more round"). F18 stale-snapshot mutations: `toolBlock`, `toolResume`, and `recordEvidence` mutated the state loaded before the claim, so a change landing between load and claim could be overwritten or acted on wrongly. All three now reload inside the guard and use the fresh state for the status check and the transition. `toolSet` needs no reload (it replaces the goal) and `toolComplete` already reloads after proof.
- Round-9 fix commands: `rtk test npm test` 17 files / 171 tests passed exit 0; `tsc --noEmit` clean exit 0; `prettier --check src tests` clean exit 0.
- REVIEW_REJECTED_NEEDS_FIXES round 10 (one real defect, fixed). F19 output overflow was misreported as a timeout: Node kills a child that exceeds `maxBuffer` with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, and the runner classified it as timed out, which would blame a hang on a verbose passing suite. `runProofCommand` now returns a distinct `output-limit` reason with `timedOut: false`, and a test writes 2 MiB through a 1 MiB buffer to prove it.
- Round-10 fix commands: `rtk test npm test` 17 files / 172 tests passed exit 0; `tsc --noEmit` clean exit 0; `prettier --check src tests` clean exit 0.
- Standing limitation, unchanged and documented: proof commands are not OS-sandboxed. Every round-10 code finding is fixed; the sandbox point is a scope decision for the Manager, not a defect the plugin can close.

## Verification Evidence

- Command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: clean | Exit: 0.
- Command: `rtk test npm test` | Expected: all pass | Actual: 17 files, 161 tests passed | Exit: 0.
- Hotfix command: `rtk test npm test` | Expected: all pass | Actual: 17 files, 166 tests passed (161 plus 5 new) | Exit: 0.
- Command: `./node_modules/.bin/tsc --noEmit` after hotfix | Expected: clean | Actual: clean | Exit: 0.
- Doc grep: `grep -rn "goal-state.json\|goal-evidence.json" README.md AGENTS.md docs/AGENT-TOOLS.md docs/conventions.md commands/goal.md` | Expected: legacy-fallback or gitignore wording only | Actual: 4 hits, all legacy-fallback or gitignore context | Exit: 0.
- Review-fix command: `rtk test npm test` | Expected: all pass | Actual: 17 files, 168 tests passed (166 plus 2 lease regression tests) | Exit: 0.
- Review-fix command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: clean | Exit: 0.
- Review-fix command: `./node_modules/.bin/prettier --check src tests` | Expected: clean | Actual: clean | Exit: 0.
- Round-3 fix command: `rtk test npm test` | Expected: all pass | Actual: 17 files, 169 tests passed (168 plus the lost-update regression) | Exit: 0.
- Round-3 fix command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: clean | Exit: 0.
- Round-4 fix command: `rtk test npm test` | Expected: all pass | Actual: 17 files, 169 tests passed | Exit: 0.
- Round-4 fix command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: clean | Exit: 0.
- Round-4 fix command: `./node_modules/.bin/prettier --check src tests` | Expected: clean | Actual: clean | Exit: 0.
- Command: `./node_modules/.bin/prettier --check src tests` | Expected: clean | Actual: clean | Exit: 0.
- Timeout path checked twice: unit test asserts `timedOut` true plus reason `timeout` at 150ms against a 30s sleep; a standalone `node -e` probe confirmed exec reports `killed: true` with `signal: SIGTERM`.
- Stack-skill gate skip record: root dot, markers package.json + tsconfig.json scanned, matched none (Node TS plugin, no framework marker), reason no stack skill in registry; generic tsc + vitest + prettier gates run instead.

## Risk & Rollback

- Risk: `goal_complete` now runs real commands and can be slow. Mitigation: 300s per-command timeout, 20-command cap, documented behavior.
- Risk: recorded command is attacker-controlled. Trust boundary: the evidence file is lease-protected runtime state written only by `goal_evidence`, and the calling agent already has shell access, so this adds no new capability; cwd is pinned to the project dir.
- Rollback: revert `src/proof.ts`, drop the `runTests` option, keep declare-only verification.

## Factual Git Diff

- Injected below: 15 files, staged via `custom_context_stage_and_inject_diff`.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/.gitignore b/.gitignore
index 1dc8bbb..bb8e659 100644
--- a/.gitignore
+++ b/.gitignore
@@ -2,6 +2,7 @@ node_modules/
 dist/
 .opencode/goal-state.json
 .opencode/goal-evidence.json
+.opencode/goals/
 STOP_GOAL
 .opencode/STOP_GOAL
 context-reports/
diff --git a/AGENTS.md b/AGENTS.md
index c57c443..1226b4e 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -1,7 +1,7 @@
 # AGENTS - opencode-goal-plugin
 Entry point. Read this first before any execution.
 Router: read opencode.json, then src/state.ts, src/goal.ts, src/index.ts, then commands/goal.md, then README.md, DECISIONS.md, CHANGELOG.md.
-Rules: file state at .opencode/goal-state.json owns truth, memory is cache only. UTC epoch ms at rest, Clock injection only, no direct Date.now in business logic. Phase 2 adds idle auto-continue via src/loop.ts with single-flight plus cooldown plus budgets. Source-first entry (src/index.ts, the host runs TS natively); dist is built only on prepublish via tsup and never committed. Task files live in tasks with BEGIN_GIT_DIFF markers. Update CHANGELOG via Parse-Then-Append. Maximum docstrings plus verbose inline comments on all public functions.
+Rules: file state owns truth and is per session at `.opencode/goals/<session-id>.json` (legacy `.opencode/goal-state.json` stays a read fallback), memory is cache only. UTC epoch ms at rest, Clock injection only, no direct Date.now in business logic. Phase 2 adds idle auto-continue via src/loop.ts with single-flight plus cooldown plus budgets. Source-first entry (src/index.ts, the host runs TS natively); dist is built only on prepublish via tsup and never committed. Task files live in tasks with BEGIN_GIT_DIFF markers. Update CHANGELOG via Parse-Then-Append. Maximum docstrings plus verbose inline comments on all public functions.
 
 ## Mandatory First-Read Rule
 
@@ -60,7 +60,7 @@ You MUST read this AGENTS.md first before any execution. Inside it, route to DES
 - **Lite Mode Protocol:** When eligible (single-file, no security/financial impact, obvious simplicity), the full production line can be bypassed with a `[LITE]` justification in the task's `## Execution Log & Reasoning` section. Escalation to Full Mode is mandatory if hidden complexity is discovered.
 - **Deprecated-Section Purge Rule:** `AGENTS.md` and task files across `tasks/` (excluding archive and completed history) MUST NOT contain `## Manager Decisions`, `## Admin Decision`, `Manager Decision`, or `Admin Decision`. Purge any detected section entirely and record the purge.
 - **Runtime-State gitignore:** Per-project runtime state MUST be gitignored; deliberate config MUST NOT be gitignored. `.opencode/smart-compact.jsonc` is agent tooling, never runtime state, never gitignored. `tasks/.sessions/` transcript dirs MUST be gitignored when the dir exists.
-- **Goal Plugin Runtime State:** `[PROJECT_ROOT]/.opencode/goal-state.json`, `[PROJECT_ROOT]/.opencode/goal-evidence.json`, `[PROJECT_ROOT]/STOP_GOAL`, `[PROJECT_ROOT]/.opencode/STOP_GOAL` are runtime state only and MUST be gitignored. External scratch, never replaces task truth.
+- **Goal Plugin Runtime State:** `[PROJECT_ROOT]/.opencode/goals/`, `[PROJECT_ROOT]/.opencode/goal-state.json`, `[PROJECT_ROOT]/.opencode/goal-evidence.json`, `[PROJECT_ROOT]/STOP_GOAL`, `[PROJECT_ROOT]/.opencode/STOP_GOAL` are runtime state only and MUST be gitignored. External scratch, never replaces task truth.
 - **Living Folder Docs Sibling Inspection:** Inspect sibling README.md and DECISIONS.md before editing code in any component or vertical slice directory, and update them when domain contracts or architectural decisions change.
 - **Edit Tool Discipline:** File edits use ONLY native file-editing tools (edit for replacements, file-write tools for new files). Using python, shell, heredoc, `sed -i`, or any script to create or modify files is strictly forbidden. Shell stays read-only for file content (grep, cat, diff, ls, git status). A non-unique anchor must fail loudly, never be forced. Verify every edit with grep/diff. See `docs/conventions.md`.
 - **Project Skills Table (local skills):** This project defines no local skills (no `.opencode/skills/` directory; `.opencode/` holds only goal runtime state). On any audit, rescan and rebuild this table if local skills appear.
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 847a1ff..bd64f1e 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -31,6 +31,8 @@ All notable changes follow Keep a Changelog.
 - Hotfix setup guard plus session fairness plus lease proof with sidecar.
 - Hotfix evidence validation: slash rejects empty exit codes (Number('') coerces to 0); tool trims file entries and rejects partial bad files/tests arrays instead of silently dropping.
 - Session-scoped goal isolation: state and evidence now live per session under `.opencode/goals/<sessionId>.json` so session B never sees or continues session A's goal; legacy single file stays as read fallback with migrate-on-write.
+- Observed test proof: `goal_complete` now executes every recorded test command in the project directory under a 300s per-command and 600s per-pass budget with a 1 MiB output cap, and requires each to exit 0, so a typed `exitCode` can no longer close a goal; `verifyLocal` keeps declare-only behavior unless observation is requested.
+- Docs sync for the per-session layout across README, AGENTS, AGENT-TOOLS, conventions, commands, gitignore, and ADR-010/ADR-011.
 - Hotfix2 afterSend Clock plus Set copy plus prune helper plus drive-relative guard.
 
 ## [0.3.0] - 2026-10-16
diff --git a/DECISIONS.md b/DECISIONS.md
index 908300b..4df0e43 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -3,6 +3,7 @@
 ## ADR-001 2026-10-16 File state owns truth
 
 Context: compaction wipes memory. Decision: .opencode/goal-state.json is source of truth with atomic tmp plus rename writes and lease fields. Consequence: survives compaction, enables single-flight claim.
+Superseded in part by ADR-010: the file remains the source of truth, but the path is now per session with the legacy file kept as a read fallback.
 
 ## ADR-002 2026-10-16 Claim-lock file serializes parallel claimants
 
@@ -38,3 +39,11 @@ Rollback: remove the registerGoalTools call; file state untouched.
 
 Context: goal_complete could never succeed because no code path ever wrote criteria into the evidence sidecar (both lanes only read it). Decision: add goal_evidence as the fifth agent tool and sole evidence writer plus a /goal evidence slash mirror delegating to the same recordEvidence handler; id, claim, files, tests all required with shape-only validation at write (existence plus passing stay verifier-side); duplicate ids rejected; writes only on active goals under the state-file lease. Consequence: set to evidence to complete passes with real proof while empty or fabricated evidence still fails, and the verifier plus evidence modules are untouched.
 Rollback: remove the tool def plus the slash branch; the sidecar file is per-project runtime state, no migration involved.
+
+## ADR-010 2026-10-21 Goal state is per session, legacy file is a read fallback
+
+Context: one shared `.opencode/goal-state.json` meant a goal set in session A was visible to session B in the same project. The idle loop would continue A's objective inside B, `goal status` in B reported A's goal, the context hook injected A's objective into every model request in the project, and a `clear` in B silently killed A's goal. Multiple sessions per checkout is normal, not an edge case. Decision: state and evidence live at `.opencode/goals/<sanitized-session-id>.json` and `.evidence.json`, where a session id is sanitized to `[A-Za-z0-9_-]{1,64}` or replaced by a stable `sid-<fnv1a>` hash. `resolveStatePath` plus `resolveEvidencePath` gained an optional session id; callers without one keep the legacy path, so old invocations and tests stay valid. Scoped reads fall back to the legacy file once, and the next write lands on the scoped path (migrate-on-write, never rewriting legacy). Corrupt scoped state fails closed instead of falling back. Slash, tools, idle, failure, startup rearm, compaction, and context lanes all thread the real session id; lane markers `unknown` and `slash` deliberately map to legacy. Consequence: sessions in one project are isolated, old single-file users keep working and migrate on their first write, and the legacy path stays gitignored runtime state. Rollback: revert the path helpers plus the `sessionId` threading; the legacy file alone restores prior behavior.
+
+## ADR-011 2026-10-22 Completion observes test results instead of trusting them
+
+Context: `verifyLocal` accepted the `exitCode` recorded in the evidence sidecar, and that value is written by the agent through `goal_evidence`. The gate rejected empty proof but not false proof: an agent could record `npm test` with `exitCode: 0` without running anything. Decision: add `src/proof.ts` with `runProofCommand`, which executes a recorded command through the platform shell (`/bin/sh` on POSIX, the configured command processor on Windows), started in the project directory after an absolute-path check, with a 300s per-command timeout, a 1 MiB output cap, and a sha256 digest of the captured output for audit. The working directory is a starting point, not a sandbox: absolute paths and `cd` still reach the rest of the machine, and the runner must never receive a command from an untrusted party. `verifyLocal` gains an optional `runTests` mode that executes every non-empty recorded command for a criterion and requires each to exit 0, reporting `test-failed`, `test-timeout`, `test-not-run`, `test-cap`, or `test-budget` distinctly; running only one command would let a trivial pass mask a failing suite. `tryCompleteWithEvidence` enables the mode by default, so both complete lanes observe real results; direct `verifyLocal` callers keep the declare-only behavior. A 20-command cap plus a shared 600s pass deadline bound completion cost, and the slash lane now claims the lease for `PROOF_TOTAL_TIMEOUT_MS + 60000` like the tool lane so a long pass cannot outlive its own guard. Trust boundary: the sidecar is lease-protected runtime state whose only writer is `goal_evidence`, and the calling agent already holds shell access, so executing the recorded command adds no capability; cwd pinning and timeouts bound the blast radius. Consequence: `goal_complete` now runs the project's own tests and can take minutes, and a fabricated exit code can no longer close a goal. Rollback: revert `src/proof.ts`, drop the `runTests` option and its default, and keep declare-only verification with the sidecar unchanged.
diff --git a/README.md b/README.md
index 9e0b184..1db5616 100644
--- a/README.md
+++ b/README.md
@@ -37,6 +37,6 @@ Same server-only core runs on web, CLI, TUI, and server-only: no TUI imports, no
 /goal &lt;objective&gt; | /goal status | /goal block &lt;reason&gt; | /goal complete | /goal resume | /goal clear
 Agent tools (no slash needed, same guarded lane): `goal_set`, `goal_block`, `goal_complete`, `goal_resume`.
 Kill switch: create `.opencode/STOP_GOAL` to stop the loop immediately.
-Completion: `/goal complete` needs evidence in `.opencode/goal-evidence.json` with file citations plus passing test proof. Compaction-safe: state reloads from file and resumes without double send.
-State: `.opencode/goal-state.json` with UTC epoch ms.
+Completion: `/goal complete` needs evidence in the session evidence sidecar (`.opencode/goals/<session-id>.evidence.json`) with file citations plus passing test proof. The recorded test command is executed at completion time, so a declared exit code alone cannot pass the gate. Compaction-safe: state reloads from file and resumes without double send.
+State: `.opencode/goals/<session-id>.json` with UTC epoch ms, one file per session. A legacy `.opencode/goal-state.json` is still read as a fallback and migrates on the next write.
 Build: npm run typecheck, npm test, npm run compile.
diff --git a/commands/goal.md b/commands/goal.md
index be9c423..b424cf6 100644
--- a/commands/goal.md
+++ b/commands/goal.md
@@ -6,11 +6,13 @@ Patterns:
 - /goal <objective> sets active objective, max 2000 chars
 - /goal status shows current state
 - /goal block <reason> marks blocked
-- /goal complete marks complete (needs evidence)
+- /goal complete marks complete (needs evidence; the recorded test command is executed, so a declared exit code alone cannot pass)
 - /goal evidence id=<short-id> claim=<one-line claim> files=<a,b> tests=<cmd:exitCode> records one evidence criterion (sole evidence writer)
 - /goal resume re-activates a parked goal (interrupted or blocked)
 - /goal clear marks cleared
   Example: /goal evidence id=build-pass claim=Build passes on a clean tree files=src/index.ts tests=npm test:0
+  Goal state is per session at .opencode/goals/<session-id>.json, so another
+  session in the same project never sees or continues this goal.
   Idle auto-continue sends one prompt per idle tick. A provider error or a
   failed send re-arms a watchdog so an active goal resumes instead of stalling.
 
diff --git a/docs/AGENT-TOOLS.md b/docs/AGENT-TOOLS.md
index 2d12612..a4a83aa 100644
--- a/docs/AGENT-TOOLS.md
+++ b/docs/AGENT-TOOLS.md
@@ -4,12 +4,13 @@ Reader: you are an AI coding agent running inside OpenCode with the
 `opencode-goal-plugin` loaded. This file teaches you the five tools that
 **you yourself** can call. It is not for the human operator. The human uses
 slash commands (`/goal ...`); you use the tools below. Both lanes write the
-same state file, so they never disagree.
+same session state file, so they never disagree.
 
 ## The one idea
 
-One project has exactly one active goal, stored in
-`.opencode/goal-state.json`. You move it through a lifecycle:
+One session has exactly one active goal, stored in
+`.opencode/goals/<session-id>.json`. A second session in the same project has
+its own file and never sees yours. You move it through a lifecycle:
 
 `active` → (`goal_block` → `blocked` → `goal_resume` → `active`) → `goal_complete` → `complete`
 
@@ -63,8 +64,10 @@ A blocked goal stops the auto-continue loop. Nothing resumes it except
 ## Tool 3 — goal_complete
 
 Close the goal when the work is done. This tool has a gate: it succeeds
-**only** if proof exists in `.opencode/goal-evidence.json` — file citations
-plus at least one passing test per criterion.
+**only** if proof exists in your session's evidence sidecar
+(`.opencode/goals/<session-id>.evidence.json`) — file citations plus at least
+one passing test per criterion. The recorded test commands are then executed,
+so a declared exit code alone cannot pass.
 
 ```json
 {}
@@ -107,7 +110,8 @@ Goal resumed: <the objective text>
 ## Tool 5 — goal_evidence
 
 Record proof for the active goal. This is the **sole evidence writer**:
-the only way proof ever enters `.opencode/goal-evidence.json`. One call
+the only way proof ever enters the session evidence sidecar
+(`.opencode/goals/<session-id>.evidence.json`). One call
 appends one criterion; call it once per criterion you can prove.
 
 ```json
@@ -156,12 +160,14 @@ Report this to the human. Do not invent state.
 
 ## Hard constraints
 
-1. One goal per project. A second `goal_set` replaces the first.
+1. One goal per session. A second `goal_set` in the same session replaces the first.
 2. `goal_complete` without evidence always fails. This is deliberate.
 3. Titles and reasons are literal data. Newlines, slashes, and words like
    `block`, `clear`, or `resume` inside them trigger nothing.
 4. All five schemas reject extra properties. Send exactly the fields shown.
-5. Never write `.opencode/goal-state.json` or `.opencode/goal-evidence.json`
-   with file tools. Always go through these five tools (`goal_evidence` is
+5. Never write `.opencode/goals/<session-id>.json` or its `.evidence.json`
+   sidecar with file tools. Always go through these five tools (`goal_evidence` is
    the sole evidence writer), so the lease, the validation, and the
    evidence gate stay in force.
+6. `goal_evidence` stores the command you send, but `goal_complete` executes
+   it and reads the real exit code. A declared `exitCode` is not proof.
diff --git a/docs/conventions.md b/docs/conventions.md
index 3511437..6d84999 100644
--- a/docs/conventions.md
+++ b/docs/conventions.md
@@ -6,7 +6,7 @@ This document defines syntax rules, naming conventions, file boundaries, and aut
 
 All projects in this ecosystem MUST follow these datetime rules:
 
-1. **UTC at Rest** — All databases and caches store datetimes in UTC with `TIMESTAMP WITH TIME ZONE`. This repo stores UTC epoch ms in `.opencode/goal-state.json`. Banned: naive or local-time storage.
+1. **UTC at Rest** — All databases and caches store datetimes in UTC with `TIMESTAMP WITH TIME ZONE`. This repo stores UTC epoch ms in per-session goal files at `.opencode/goals/<session-id>.json` (legacy `.opencode/goal-state.json` remains a read fallback). Banned: naive or local-time storage.
 2. **ISO-8601 with Offset / Epoch ms at API Boundaries** — APIs transmit datetimes as Unix Epoch milliseconds (int64) or ISO-8601 with offset (e.g., `2026-07-23T14:30:00+00:00`). Banned: timezone-naive strings.
 3. **Clock Injection** — All current-time access must go through an injectable `Clock` abstraction. This repo's `SystemClock` is the single `Date.now()` home in `src/state.ts`. Banned: direct `new Date()`, `datetime.now()`, `time.Now()` in business logic.
 4. **Dual-Representation for Future Events** — Calendar events expose both `event_start_local` (with timezone) and `event_start_epoch_ms` (absolute).
diff --git a/src/DECISIONS.md b/src/DECISIONS.md
new file mode 100644
index 0000000..342a517
--- /dev/null
+++ b/src/DECISIONS.md
@@ -0,0 +1,29 @@
+# src — decisions
+
+Sibling docs: `README.md` in this directory; the authoritative chronological log
+is the root `DECISIONS.md`.
+
+This file only indexes which root decision record governs which module, so a
+reader inside `src/` finds the reasoning without leaving the folder.
+
+| Decision                                       | Governs                                                      |
+| ---------------------------------------------- | ------------------------------------------------------------ |
+| ADR-001 file state owns truth                  | `state.ts`, `index.ts`                                       |
+| ADR-002 claim-lock file serializes claimants   | `state.ts`                                                   |
+| ADR-003 idle single-flight plus cooldown       | `loop.ts`, `limits.ts`                                       |
+| ADR-004 compaction restore plus evidence gate  | `compaction.ts`, `evidence.ts`, `verifier.ts`                |
+| ADR-005 host-native V2 export shape            | `index.ts`                                                   |
+| ADR-006 hardening without contract break       | `state.ts`, `index.ts`, `loop.ts`                            |
+| ADR-007 crash and error recovery               | `loop.ts`, `watchdog.ts`, `index.ts`                         |
+| ADR-008 agent-callable goal tools              | `tools.ts`                                                   |
+| ADR-009 sole evidence writer                   | `tools.ts`, `evidence.ts`                                    |
+| ADR-010 per-session state with legacy fallback | `state.ts`, `evidence.ts`, `index.ts`, `tools.ts`, `loop.ts` |
+| ADR-011 completion observes test results       | `proof.ts`, `verifier.ts`, `tools.ts`, `index.ts`            |
+
+## Local notes
+
+- `proof.ts` exists only because a caller-declared exit code is not evidence.
+  Any future change to the completion gate must keep the observation default on
+  in `tryCompleteWithEvidence` and keep `verifyLocal` declare-only by default.
+- The per-session path rule is enforced by one helper, `sanitizeSessionId` in
+  `state.ts`. Do not build a session path by hand anywhere else.
diff --git a/src/README.md b/src/README.md
new file mode 100644
index 0000000..0d5b00f
--- /dev/null
+++ b/src/README.md
@@ -0,0 +1,51 @@
+# src — goal plugin core modules
+
+Sibling docs: this file plus `DECISIONS.md` in this directory; the project-wide
+decision log is the root `DECISIONS.md`.
+
+## Duties
+
+`src/` holds the whole plugin. `index.ts` is the only host binding; every other
+module is pure enough to test without an OpenCode host.
+
+| Module          | Duty                                                                                                            |
+| --------------- | --------------------------------------------------------------------------------------------------------------- |
+| `index.ts`      | `Plugin.define` entry, slash `/goal` lane, idle event subscription, startup rearm, compaction and context hooks |
+| `state.ts`      | `GoalState` shape, per-session path resolution, atomic save, claim lock and lease                               |
+| `goal.ts`       | Slash parsing, JSON Schemas, lifecycle transitions, title traversal guard                                       |
+| `tools.ts`      | The five agent tools and the lease-guarded mutation paths                                                       |
+| `loop.ts`       | One idle tick: gate, claim, send, record; failure classification                                                |
+| `watchdog.ts`   | In-memory timers that wake a stalled lane from persisted state                                                  |
+| `compaction.ts` | Snapshot before compaction, restore after, abort-set pruning                                                    |
+| `evidence.ts`   | Evidence sidecar shape, per-session paths, atomic save                                                          |
+| `verifier.ts`   | Completion gate: citations, then declared or observed test proof                                                |
+| `proof.ts`      | Executes a recorded proof command under timeout, output cap and cwd pin                                         |
+| `limits.ts`     | Turn, wall-time, delay and per-session cooldown budgets                                                         |
+
+## Invariants
+
+1. File state owns truth. Memory is a cache and never a second source.
+2. State and evidence are per session at `.opencode/goals/<session-id>.json` and
+   `.evidence.json`, sanitized to `[A-Za-z0-9_-]{1,64}` or a `sid-<fnv1a>` hash.
+   The legacy `.opencode/goal-state.json` and `.opencode/goal-evidence.json` are
+   read fallbacks only; the next scoped write migrates a user forward.
+3. Every mutation runs under the claim lock and lease. Completion claims a TTL
+   that covers the whole proof budget.
+4. Completion reloads the state after proof and refuses to write when the
+   objective changed during the pass. A long pass must never clobber a newer
+   goal.
+5. All current-time access goes through the injected `Clock`. `SystemClock` in
+   `state.ts` is the only `Date.now()` call site.
+6. `verifyLocal` stays declare-only unless `runTests` is requested; the two
+   complete lanes opt in, so observation cannot silently change old callers.
+7. Nothing in `src/` throws into the host: host callbacks map failures to a
+   reason string.
+
+## Risks
+
+- `loop.ts` and `index.ts` both own idle wiring; a second sender would allow a
+  double turn, so both use one `buildIdleDeps`.
+- `proof.ts` executes the recorded command with `cwd` set to the project
+  directory. That is a starting directory, not a sandbox: a command that changes
+  directory can leave it. The bounds are the timeout, the output cap, the command
+  cap and the caller's pre-existing shell access.
diff --git a/src/compaction.ts b/src/compaction.ts
index 808bd4e..f13ead9 100644
--- a/src/compaction.ts
+++ b/src/compaction.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Compaction snapshot plus restore Phase 3.
  * Why this module exists: memory dies on compaction, file state must resume cleanly.
diff --git a/src/evidence.ts b/src/evidence.ts
index 89c0dd2..6266a8b 100644
--- a/src/evidence.ts
+++ b/src/evidence.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Completion evidence sidecar Phase 3.
  * Why this module exists: completion needs cited proof, never self-report alone.
diff --git a/src/goal.ts b/src/goal.ts
index 21c7c95..e605a11 100644
--- a/src/goal.ts
+++ b/src/goal.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Slash goal parsing and status transitions Phase 1.
  * Why this module exists: isolates user input handling from storage and host wiring.
diff --git a/src/index.ts b/src/index.ts
index 9f37d30..10a38ac 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Plugin entry: OpenCode V2 host binding.
  * Why this file exists: the host loader requires a default export shaped as
@@ -8,13 +9,17 @@ import * as path from 'node:path';
 import { promises as fs } from 'node:fs';
 import { Plugin } from '@opencode/plugin';
 import {
+  LEASE_TTL_MS,
   SystemClock,
+  goalIdentity,
   loadGoalState,
   loadGoalStateWithFallback,
+  releaseLease,
   resolveLegacyStatePath,
   resolveStatePath,
   saveGoalState,
   tryClaimLease,
+  withClaimLock,
 } from './state.js';
 import type { Clock, GoalState } from './state.js';
 import {
@@ -42,6 +47,7 @@ import {
 } from './compaction.js';
 import { saveEvidence, emptyEvidence, loadEvidence } from './evidence.js';
 import { tryCompleteWithEvidence } from './verifier.js';
+import { PROOF_TOTAL_TIMEOUT_MS } from './proof.js';
 import { recordEvidence, registerGoalTools } from './tools.js';
 import {
   armWatchdog,
@@ -61,6 +67,27 @@ import {
 export const PLUGIN_NAME = 'opencode-goal-plugin';
 export const PLUGIN_VERSION = '0.2.0';
 
+/**
+ * Message when the state lease is already held by another lane.
+ * Why shared text: the slash and tool lanes must report contention identically.
+ */
+const BUSY_GOAL_MESSAGE = 'Goal is busy with another turn. Retry shortly.';
+
+/**
+ * Message when the goal identity changed during a long completion pass.
+ * Why a distinct string: the caller must retry against the new goal instead of
+ * treating the run as a failure of the old one.
+ */
+const STATE_CHANGED_MESSAGE =
+  'Goal state changed while completing. Run /goal status and retry.';
+
+/**
+ * Monotonic sequence for slash lease owners.
+ * Why this exists: the lease treats a repeated owner id as the same writer and
+ * lets it re-claim, so two concurrent slash calls must never share an owner.
+ */
+let slashOwnerSeq = 0;
+
 /** Minimal host shape, all fields optional so probing never throws. */
 export interface MinimalHost {
   version?: unknown;
@@ -137,6 +164,92 @@ export async function handleGoalCommand(
       '. Back up the file then clear it.'
     );
   }
+  // One lease owner per operation, so two slash calls never look like the same
+  // writer (a repeated owner id would re-enter its own claim). A missing file
+  // needs no claim: there is nothing to race before the first write.
+  slashOwnerSeq += 1;
+  const slashOwner =
+    'slash:' +
+    (typeof storage === 'string' && storage.length > 0 ? storage : 'default') +
+    ':' +
+    String(slashOwnerSeq);
+  /**
+   * Run one slash mutation under the state lease.
+   * Why a helper: four branches share the claim, the busy message, and the
+   * release safety net, so the policy cannot drift between them.
+   * @param fn mutation body that reads fresh state and returns its message
+   */
+  const withSlashLease = async (fn: () => Promise<string>): Promise<string> => {
+    // No state file at all: still serialize the very first write with the lock.
+    if (current === null) {
+      const locked = await withClaimLock(
+        statePath,
+        slashOwner,
+        LEASE_TTL_MS,
+        clock,
+        fn,
+      );
+      if (!locked.ok) return BUSY_GOAL_MESSAGE;
+      return locked.value as string;
+    }
+    // First write to a scoped file: the lease cannot serialize a migrate-on-write
+    // because there is no scoped state to claim yet. The dedicated lock does,
+    // without writing a lease into the legacy file.
+    if (statePath !== legacyPath) {
+      let scopedExists = true;
+      try {
+        scopedExists = (await loadGoalState(statePath)) !== null;
+      } catch {
+        // Corrupt scoped file falls through to the lease, which fails closed.
+        scopedExists = true;
+      }
+      if (!scopedExists) {
+        const locked = await withClaimLock(
+          statePath,
+          slashOwner,
+          LEASE_TTL_MS,
+          clock,
+          fn,
+        );
+        if (!locked.ok) return BUSY_GOAL_MESSAGE;
+        return locked.value as string;
+      }
+    }
+    try {
+      const claim = await tryClaimLease(
+        statePath,
+        slashOwner,
+        LEASE_TTL_MS,
+        clock,
+      );
+      if (!claim.claimed) return BUSY_GOAL_MESSAGE;
+    } catch (err) {
+      // Claim writes the lease, so a throw here is a real save failure.
+      return 'Failed to save goal state: ' + (err as Error).message;
+    }
+    try {
+      return await fn();
+    } finally {
+      try {
+        await releaseLease(statePath, slashOwner, clock);
+      } catch {
+        // TTL reclaims a stale lease: release failure never blocks a report.
+      }
+    }
+  };
+  /**
+   * Reload state inside a held lease so a mutation writes the newest snapshot.
+   * @returns fresh state, or the corrupt message when the file is unreadable
+   */
+  const reload = async (): Promise<GoalState | null> => {
+    try {
+      return statePath === legacyPath
+        ? await loadGoalState(statePath)
+        : await loadGoalStateWithFallback(statePath, legacyPath);
+    } catch {
+      return null;
+    }
+  };
   if (parsed.kind === 'status') {
     if (current === null) return 'No goal set. Use /goal <objective>.';
     return 'Goal ' + current.status + ': ' + current.objective;
@@ -158,36 +271,54 @@ export async function handleGoalCommand(
     if (!isSafeGoalTitle(parsed.objective)) {
       return 'Invalid /goal usage. Objective must not be a path escape.';
     }
-    // New objective resets counters and clears any stale lease.
-    const next = setObjective(current, parsed.objective, clock, hostVersion);
-    try {
-      await saveGoalState(statePath, next);
-    } catch (err) {
-      // Save I/O errors report separately from transition errors.
-      return 'Failed to save goal state: ' + (err as Error).message;
-    }
-    return 'Goal set to active: ' + next.objective;
+    // New objective resets counters and clears any stale lease. Runs under the
+    // lease and re-reads so a concurrent transition is never overwritten.
+    return withSlashLease(async () => {
+      const fresh = await reload();
+      if (fresh === null) {
+        // No file yet (first set) is fine; unreadable is not.
+        const exists = await loadGoalState(statePath).catch(() => null);
+        if (exists !== null) {
+          return (
+            'Goal state is corrupt at ' +
+            statePath +
+            '. Back up the file then clear it.'
+          );
+        }
+      }
+      const next = setObjective(fresh, parsed.objective, clock, hostVersion);
+      try {
+        await saveGoalState(statePath, next);
+      } catch (err) {
+        // Save I/O errors report separately from transition errors.
+        return 'Failed to save goal state: ' + (err as Error).message;
+      }
+      return 'Goal set to active: ' + next.objective;
+    });
   }
   if (current === null) {
     return 'No goal set. Use /goal <objective> first.';
   }
   if (parsed.kind === 'block') {
-    let next: GoalState;
-    try {
-      next = blockGoal(current, parsed.reason, clock);
-    } catch {
-      return (
-        'Only an active goal can be blocked. Current status: ' +
-        current.status +
-        '.'
-      );
-    }
-    try {
-      await saveGoalState(statePath, next);
-    } catch (err) {
-      return 'Failed to save goal state: ' + (err as Error).message;
-    }
-    return 'Goal marked blocked: ' + parsed.reason;
+    return withSlashLease(async () => {
+      const fresh = (await reload()) ?? current;
+      let next: GoalState;
+      try {
+        next = blockGoal(fresh, parsed.reason, clock);
+      } catch {
+        return (
+          'Only an active goal can be blocked. Current status: ' +
+          fresh.status +
+          '.'
+        );
+      }
+      try {
+        await saveGoalState(statePath, next);
+      } catch (err) {
+        return 'Failed to save goal state: ' + (err as Error).message;
+      }
+      return 'Goal marked blocked: ' + parsed.reason;
+    });
   }
   if (parsed.kind === 'evidence') {
     // Parity by construction: the slash lane calls the tool handler directly,
@@ -210,9 +341,10 @@ export async function handleGoalCommand(
     // Evidence gate: active goals need proof, blocked or done still report status.
     // Why order matters: legacy status error must surface first so existing
     // blocked-complete test keeps its message. Only active goals reach verifier.
-    let next: GoalState;
+    // This is a pre-check only: the authoritative transition is recomputed from
+    // freshly reloaded state after the lease is held (see below).
     try {
-      next = completeGoal(current, clock);
+      completeGoal(current, clock);
     } catch {
       return (
         'Only an active goal can complete. Current status: ' +
@@ -221,55 +353,142 @@ export async function handleGoalCommand(
       );
     }
     // Active path now requires evidence: missing proof blocks with friendly text.
-    // Scoped evidence: a session completes only on its own citations.
-    try {
-      const ev = await loadEvidence(projectDir, storage);
-      const check = await tryCompleteWithEvidence({
-        projectDir,
-        evidence: ev,
-      });
-      if (!check.ok) {
+    // Guard first: completion now observes real commands, so a long proof pass
+    // must serialize against the loop and the tool lane. The TTL covers the whole
+    // proof budget plus a release buffer. `slashOwner` is the same owner every
+    // slash mutation uses, so no slash write can slip in during the pass.
+    const owner = slashOwner;
+    /** The completion body, run under whichever guard applies to this file. */
+    const finishComplete = async (): Promise<string> => {
+      // Scoped evidence: a session completes only on its own citations.
+      let evidenceError = false;
+      try {
+        const ev = await loadEvidence(projectDir, storage);
+        const check = await tryCompleteWithEvidence({
+          projectDir,
+          evidence: ev,
+          clock,
+        });
+        if (!check.ok) {
+          return (
+            'Complete blocked: ' +
+            check.reason +
+            '. Add file citations plus passing tests to evidence.'
+          );
+        }
+      } catch {
+        // Verifier failure fails closed: do not mark complete without proof.
+        evidenceError = true;
+      }
+      if (evidenceError) {
+        return 'Complete blocked: verifier-error. Add evidence and retry.';
+      }
+      // Reload AFTER proof, immediately before the save: a proof pass can run
+      // for minutes, so this is the only snapshot safe to write.
+      const fresh = await loadGoalStateWithFallback(statePath, legacyPath);
+      if (fresh === null) {
+        return 'No goal set. Use /goal <objective> first.';
+      }
+      // Identity check across the whole generation, not just the objective: a
+      // block, a clear, or a loop turn during the pass also invalidates this
+      // completion. Aborting writes nothing.
+      if (goalIdentity(fresh) !== goalIdentity(current)) {
+        return STATE_CHANGED_MESSAGE;
+      }
+      let next: GoalState;
+      try {
+        next = completeGoal(fresh, clock);
+      } catch {
         return (
-          'Complete blocked: ' +
-          check.reason +
-          '. Add file citations plus passing tests to evidence.'
+          'Only an active goal can complete. Current status: ' +
+          fresh.status +
+          '.'
+        );
+      }
+      try {
+        await saveGoalState(statePath, next);
+      } catch (err) {
+        return 'Failed to save goal state: ' + (err as Error).message;
+      }
+      return 'Goal marked complete.';
+    };
+    // Migrate-on-write: with no scoped file yet the lease cannot be claimed, so
+    // the dedicated lock guards this first write instead of reporting busy.
+    if (statePath !== legacyPath) {
+      let scopedMissing = false;
+      try {
+        scopedMissing = (await loadGoalState(statePath)) === null;
+      } catch {
+        // Corrupt scoped file falls through to the lease, which fails closed.
+      }
+      if (scopedMissing) {
+        const locked = await withClaimLock(
+          statePath,
+          owner,
+          PROOF_TOTAL_TIMEOUT_MS + 60000,
+          clock,
+          finishComplete,
         );
+        if (!locked.ok) return BUSY_GOAL_MESSAGE;
+        return locked.value as string;
       }
+    }
+    let held = false;
+    try {
+      const claim = await tryClaimLease(
+        statePath,
+        owner,
+        PROOF_TOTAL_TIMEOUT_MS + 60000,
+        clock,
+      );
+      held = claim.claimed;
     } catch {
-      // Verifier failure fails closed: do not mark complete without proof.
-      return 'Complete blocked: verifier-error. Add evidence and retry.';
+      // Lock I/O failure fails closed: never run proof without the lease.
+      return BUSY_GOAL_MESSAGE;
     }
+    if (!held) return BUSY_GOAL_MESSAGE;
     try {
-      await saveGoalState(statePath, next);
-    } catch (err) {
-      return 'Failed to save goal state: ' + (err as Error).message;
+      return await finishComplete();
+    } finally {
+      // Release is a no-op after a successful save (the transition clears it),
+      // and the safety net for every early return above.
+      try {
+        await releaseLease(statePath, owner, clock);
+      } catch {
+        // TTL reclaims a stale lease: release failure never blocks a report.
+      }
     }
-    return 'Goal marked complete.';
   }
   if (parsed.kind === 'resume') {
     // Resume a parked goal back to active after an explicit user request.
-    let resumed: GoalState;
-    try {
-      resumed = resumeGoal(current, clock);
-    } catch {
-      return (
-        'Only a parked goal can resume. Current status: ' + current.status + '.'
-      );
-    }
+    return withSlashLease(async () => {
+      const fresh = (await reload()) ?? current;
+      let resumed: GoalState;
+      try {
+        resumed = resumeGoal(fresh, clock);
+      } catch {
+        return (
+          'Only a parked goal can resume. Current status: ' + fresh.status + '.'
+        );
+      }
+      try {
+        await saveGoalState(statePath, resumed);
+      } catch (err) {
+        return 'Failed to save goal state: ' + (err as Error).message;
+      }
+      return 'Goal resumed: ' + resumed.objective;
+    });
+  }
+  return withSlashLease(async () => {
+    const fresh = (await reload()) ?? current;
+    const cleared = clearGoal(fresh, clock);
     try {
-      await saveGoalState(statePath, resumed);
+      await saveGoalState(statePath, cleared);
     } catch (err) {
       return 'Failed to save goal state: ' + (err as Error).message;
     }
-    return 'Goal resumed: ' + resumed.objective;
-  }
-  const cleared = clearGoal(current, clock);
-  try {
-    await saveGoalState(statePath, cleared);
-  } catch (err) {
-    return 'Failed to save goal state: ' + (err as Error).message;
-  }
-  return 'Goal cleared.';
+    return 'Goal cleared.';
+  });
 }
 
 /**
diff --git a/src/limits.ts b/src/limits.ts
index 50c391b..efdb16b 100644
--- a/src/limits.ts
+++ b/src/limits.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Budget limits Phase 2.
  * Why this module exists: bounds auto-continue so the idle loop cannot run forever.
diff --git a/src/loop.ts b/src/loop.ts
index 93e3b3a..c38efcc 100644
--- a/src/loop.ts
+++ b/src/loop.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Idle auto-continue loop Phase 2.
  * Why this module exists: decides exactly one safe continuation per idle tick.
diff --git a/src/proof.ts b/src/proof.ts
new file mode 100644
index 0000000..eb311a6
--- /dev/null
+++ b/src/proof.ts
@@ -0,0 +1,207 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
+/**
+ * Observed test proof runner.
+ * Why this module exists: the completion gate used to trust the exit code the
+ * caller wrote into the evidence sidecar. Because the agent writes that value
+ * itself through `goal_evidence`, the gate rejected empty proof but not false
+ * proof. This runner executes the recorded command and reports what actually
+ * happened, so completion reads an observation instead of a claim.
+ *
+ * Boundaries, stated plainly: this is NOT a sandbox and it does not confine the
+ * command to the repository. `cwd` sets where the command starts; an absolute
+ * path or a `cd` still reaches the rest of the machine. The limits are time, a
+ * per-verification command cap, and a bounded output buffer. The justification
+ * for running at all is that the evidence sidecar is lease-protected runtime
+ * state whose only writer is `goal_evidence`, and the calling agent already
+ * holds shell access in its own session, so no capability is added. Never use
+ * this runner on a command from an untrusted party.
+ */
+import { exec } from 'node:child_process';
+import { createHash } from 'node:crypto';
+import path from 'node:path';
+import type { Clock } from './state.js';
+
+/**
+ * Per-command wall clock budget.
+ * Why 300s: a real full suite on a large repo still fits, a hung or interactive
+ * command does not. The gate must fail closed rather than wait forever.
+ */
+export const PROOF_TIMEOUT_MS = 300000;
+
+/**
+ * Captured output ceiling.
+ * Why bounded: proof needs a digest for audit, never a full transcript, so a
+ * noisy command cannot exhaust memory or bloat the verifier.
+ */
+export const PROOF_MAX_BUFFER = 1024 * 1024;
+
+/**
+ * Commands executed per verification pass.
+ * Why capped: a padded sidecar must not turn completion into an unbounded
+ * command batch. Every criterion still needs its own proof, so the cap is
+ * generous relative to realistic evidence.
+ */
+export const PROOF_MAX_COMMANDS = 20;
+
+/**
+ * Total wall clock budget for one verification pass.
+ * Why a separate total: twenty commands at the per-command ceiling would be
+ * twenty times the lease window, so the pass needs its own deadline that the
+ * caller can also use to size the lease it holds during verification.
+ */
+export const PROOF_TOTAL_TIMEOUT_MS = 600000;
+
+/** Observed outcome of one proof command. */
+export interface ProofResult {
+  /** True only when the command ran to completion and exited 0. */
+  ok: boolean;
+  /** Real exit code, or null when the command never produced one. */
+  exitCode: number | null;
+  /** True when the timeout killed the command. */
+  timedOut: boolean;
+  /** Stable machine reason: ran, exit-N, timeout, spawn-error, empty-command. */
+  reason: string;
+  /** Wall time measured with the injected Clock, so business logic stays deterministic. */
+  durationMs: number;
+  /** Short sha256 over captured stdout plus stderr, for audit only. */
+  outputHash: string;
+}
+
+/**
+ * Build the failure result for a command that could not produce a pass.
+ * Why a helper: four early-exit paths share one shape, and keeping them in one
+ * place means a new reason string cannot drift from the interface.
+ * @param reason stable machine reason
+ * @param durationMs measured wall time, zero when nothing ran
+ * @param outputHash digest of whatever was captured, empty when nothing ran
+ * @param timedOut true only for the timeout path
+ */
+function unrunable(
+  reason: string,
+  durationMs: number,
+  outputHash: string,
+  timedOut: boolean = false,
+): ProofResult {
+  return {
+    ok: false,
+    exitCode: null,
+    timedOut,
+    reason,
+    durationMs,
+    outputHash,
+  };
+}
+
+/**
+ * Execute one recorded proof command inside the project directory.
+ * Never throws: every spawn, signal, and timeout path maps to a result, because
+ * a verifier that throws would surface as an opaque verifier-error instead of a
+ * specific reason the caller can act on.
+ * @param projectDir absolute project root, used as the working directory
+ * @param command recorded command string; non-strings are rejected without spawning
+ * @param clock injected clock used only for duration measurement
+ * @param timeoutMs per-command budget, defaults to PROOF_TIMEOUT_MS
+ */
+export async function runProofCommand(
+  projectDir: string,
+  command: unknown,
+  clock: Clock,
+  timeoutMs: number = PROOF_TIMEOUT_MS,
+): Promise<ProofResult> {
+  const started = clock.nowMs();
+  // Trim and type-check before spawning: an empty command would be a silent no-op.
+  const cmd = typeof command === 'string' ? command.trim() : '';
+  if (cmd.length === 0) return unrunable('empty-command', 0, '');
+  // Absolute cwd only: a relative path would resolve against the server process
+  // and could point the proof outside the repo it claims to verify.
+  if (typeof projectDir !== 'string' || !path.isAbsolute(projectDir))
+    return unrunable('invalid-cwd', 0, '');
+  const raw = await new Promise<{
+    code: number | null;
+    killed: boolean;
+    output: string;
+  }>((resolve) => {
+    try {
+      exec(
+        cmd,
+        {
+          // Pin the working directory so proof runs where the citations live.
+          cwd: projectDir,
+          timeout: timeoutMs,
+          // Bounded capture: stdout plus stderr beyond this is dropped.
+          maxBuffer: PROOF_MAX_BUFFER,
+          encoding: 'utf8',
+          // Portable shell: POSIX uses sh explicitly, Windows uses the system
+          // command processor. Pinning /bin/sh unconditionally broke Windows.
+          shell:
+            process.platform === 'win32'
+              ? (process.env.ComSpec ?? 'cmd.exe')
+              : '/bin/sh',
+          // Explicit kill signal so a timeout is distinguishable from a crash.
+          killSignal: 'SIGTERM',
+          env: {
+            ...process.env,
+            // Non-interactive hygiene: no color, no prompts, no pager waits.
+            CI: '1',
+            NO_COLOR: '1',
+            GIT_TERMINAL_PROMPT: '0',
+            PIP_NO_INPUT: '1',
+          },
+        },
+        (err, stdout, stderr) => {
+          // exec reports a numeric exit code on `code`. A spawn failure such as
+          // ENOENT reports a string code instead, which means "never ran".
+          const e = err as
+            | (NodeJS.ErrnoException & {
+                killed?: boolean;
+                signal?: NodeJS.Signals | null;
+              })
+            | null;
+          const rawCode = e === null ? 0 : (e as { code?: unknown }).code;
+          // A timeout kill shows up as killed true, or as a termination signal
+          // with no exit code. Both mean the command never finished on its own.
+          const killedByTimeout =
+            e !== null &&
+            ((e as { killed?: boolean }).killed === true ||
+              (e as { signal?: unknown }).signal === 'SIGTERM' ||
+              (e as { signal?: unknown }).signal === 'SIGKILL');
+          resolve({
+            code: typeof rawCode === 'number' ? rawCode : e === null ? 0 : null,
+            killed: killedByTimeout,
+            output: String(stdout ?? '') + String(stderr ?? ''),
+          });
+        },
+      );
+    } catch {
+      // Malformed options or a synchronous spawn failure: never ran.
+      resolve({ code: null, killed: false, output: '' });
+    }
+  });
+  const durationMs = Math.max(0, clock.nowMs() - started);
+  const outputHash = createHash('sha256')
+    .update(raw.output)
+    .digest('hex')
+    .slice(0, 16);
+  // Timeout first: a killed child usually has no exit code to report.
+  if (raw.killed) return unrunable('timeout', durationMs, outputHash, true);
+  if (raw.code === null)
+    return unrunable('spawn-error', durationMs, outputHash);
+  if (raw.code === 0) {
+    return {
+      ok: true,
+      exitCode: 0,
+      timedOut: false,
+      reason: 'ran',
+      durationMs,
+      outputHash,
+    };
+  }
+  return {
+    ok: false,
+    exitCode: raw.code,
+    timedOut: false,
+    reason: 'exit-' + String(raw.code),
+    durationMs,
+    outputHash,
+  };
+}
diff --git a/src/state.ts b/src/state.ts
index cdecb8c..8010d8b 100644
--- a/src/state.ts
+++ b/src/state.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * File-backed goal state for OpenCode V2 plugin Phase 1.
  * Why this module exists: memory is lost on compaction, file state survives.
@@ -177,6 +178,24 @@ export async function loadGoalStateWithFallback(
   }
 }
 
+/**
+ * Stable identity for one goal generation.
+ * Why this exists: completion runs a proof pass that can last minutes, so it
+ * must refuse to write a state that was replaced or mutated in the meantime.
+ * Lease fields are excluded on purpose because claiming legitimately rewrites
+ * them; the fields kept here only change on a real transition.
+ * @param state current goal state
+ */
+export function goalIdentity(state: GoalState): string {
+  return [
+    state.objective,
+    String(state.createdAtMs),
+    state.status,
+    String(state.iterationCount),
+    String(state.recoveryEpoch),
+  ].join('|');
+}
+
 /**
  * Create a fresh state for a new objective.
  * @param objective trimmed objective text, must be non-empty
@@ -583,6 +602,77 @@ async function acquireClaimLock(
   }
 }
 
+/**
+ * Run a callback under the short-lived claim lock for one state path.
+ * Why this exists: the first write to a per-session file has no state to claim,
+ * so the lease alone cannot serialize a migrate-on-write. The same lock file
+ * that guards lease claims serializes that window, and it never touches the
+ * legacy state file.
+ * @param statePath absolute path whose `.lock` sibling is taken
+ * @param owner lock owner id, used only for audit in the lock payload
+ * @param ttlMs stale-lock reclaim window
+ * @param clock injected clock
+ * @param fn callback to run while the lock is held
+ * @returns ok false when another writer already holds the lock
+ */
+export async function withClaimLock<T>(
+  statePath: string,
+  owner: string,
+  ttlMs: number,
+  clock: Clock,
+  fn: () => Promise<T>,
+): Promise<{ ok: boolean; value?: T }> {
+  const acquired = await acquireScopedLock(statePath, owner, ttlMs, clock);
+  if (!acquired) return { ok: false };
+  try {
+    return { ok: true, value: await fn() };
+  } finally {
+    await releaseScopedLock(statePath);
+  }
+}
+
+/**
+ * Acquire the short-lived lock for one state path without running a callback.
+ * Why separate from withClaimLock: callers that mutate through several helpers
+ * need to hold the lock across their own body and release it in a finally.
+ * @param statePath absolute state path whose `.lock` sibling is taken
+ * @param owner lock owner id for the audit payload
+ * @param ttlMs stale-lock reclaim window
+ * @param clock injected clock
+ */
+export async function acquireScopedLock(
+  statePath: string,
+  owner: string,
+  ttlMs: number,
+  clock: Clock,
+): Promise<boolean> {
+  const lockPath = statePath + '.lock';
+  // First write: the goals dir may not exist yet, and wx-create would fail ENOENT.
+  try {
+    await fs.mkdir(path.dirname(lockPath), { recursive: true });
+  } catch {
+    return false;
+  }
+  try {
+    return await acquireClaimLock(lockPath, owner, ttlMs, clock);
+  } catch {
+    // Lock I/O failure fails closed: the caller treats it as contention.
+    return false;
+  }
+}
+
+/**
+ * Release the short-lived lock for one state path, best-effort.
+ * @param statePath absolute state path whose `.lock` sibling is removed
+ */
+export async function releaseScopedLock(statePath: string): Promise<void> {
+  try {
+    await fs.unlink(statePath + '.lock');
+  } catch {
+    // Already gone (reclaimed as stale elsewhere): safe to ignore.
+  }
+}
+
 /**
  * Try to claim execution lease. Only one owner wins.
  * @param statePath absolute path to state file
diff --git a/src/tools.ts b/src/tools.ts
index 7f5761e..04777d9 100644
--- a/src/tools.ts
+++ b/src/tools.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Agent-callable goal tools.
  * Why this module exists: the model needs to drive the goal itself mid-session
@@ -14,9 +15,12 @@
 import type { Clock, GoalState } from './state.js';
 import {
   LEASE_TTL_MS,
+  acquireScopedLock,
+  goalIdentity,
   loadGoalState,
   loadGoalStateWithFallback,
   releaseLease,
+  releaseScopedLock,
   resolveLegacyStatePath,
   resolveStatePath,
   saveGoalState,
@@ -41,6 +45,7 @@ import {
   validateEvidenceShape,
 } from './evidence.js';
 import { tryCompleteWithEvidence } from './verifier.js';
+import { PROOF_TOTAL_TIMEOUT_MS } from './proof.js';
 
 /** Host version stamped on tool-created state, matching the slash lane. */
 const TOOL_HOST_VERSION = '2.0.29';
@@ -92,15 +97,39 @@ function corruptMessage(statePath: string): string {
   );
 }
 
+/** Module counter so two calls in one session never share a lease owner id. */
+let toolOwnerSeq = 0;
+
 /** Message when another turn holds the lease; no mutation happened. */
 const BUSY_MESSAGE = 'Goal is busy with another turn. Retry shortly.';
 
 /**
- * Claim the file lease for a tool mutation.
- * Why lease first: two parallel tool calls (or a tool plus the idle loop)
- * must serialize their read-modify-write. null state needs no lease — there
- * is no file to race on, matching first-set semantics.
- * @returns claimed owner id, or null when no claim was needed or possible
+ * Message when the goal identity changed during a long completion pass.
+ * Why shared text: the slash lane reports the same string, so callers see one
+ * recovery story no matter which surface started the completion.
+ */
+const STATE_CHANGED_MESSAGE =
+  'Goal state changed while completing. Run /goal status and retry.';
+
+/**
+ * Guard handed back by `claimForTool`.
+ * Why a release closure: two different guards are possible (scoped lock for a
+ * first write, file lease otherwise) and only the guard this call actually took
+ * may be released. Unlinking a shared lock path unconditionally would delete a
+ * different writer's lock.
+ */
+interface ToolClaim {
+  claimed: boolean;
+  release: () => Promise<void>;
+}
+
+/**
+ * Claim the file lease for a tool mutation, or the scoped lock on a first write.
+ * Why lease first: two parallel tool calls (or a tool plus the idle loop) must
+ * serialize their read-modify-write. A missing state file cannot be leased, so
+ * that path takes the dedicated scoped lock instead; with no file at all the
+ * first set still takes the lock so two first sets cannot interleave.
+ * @returns the claim plus the closure that releases exactly what was taken
  */
 async function claimForTool(
   statePath: string,
@@ -108,44 +137,62 @@ async function claimForTool(
   current: GoalState | null,
   owner: string,
   clock: Clock,
-): Promise<{ claimed: boolean }> {
-  if (current === null) return { claimed: true };
-  // First write to a missing scoped file needs no lease: no file to race.
-  // Why scoped check matters: fallback may have loaded legacy content while
-  // the scoped path is still absent. Claiming the absent path would fail
-  // closed (tryClaimLease returns false on null) and wrongly report busy.
+  ttlMs: number = LEASE_TTL_MS,
+): Promise<ToolClaim> {
+  const takeLock = async (): Promise<ToolClaim> => {
+    const ok = await acquireScopedLock(statePath, owner, ttlMs, clock);
+    return {
+      claimed: ok,
+      release: async () => {
+        await releaseScopedLock(statePath);
+      },
+    };
+  };
+  const noopRelease = async (): Promise<void> => {
+    // Nothing was acquired: releasing would touch another writer's guard.
+  };
+  // No state file at all: serialize the very first write with the lock.
+  if (current === null) return takeLock();
+  // Scoped file missing but legacy content may exist: lock the migration window.
   if (statePath !== legacyPath) {
+    let scopedMissing = false;
     try {
-      const scoped = await loadGoalState(statePath);
-      if (scoped === null) return { claimed: true };
+      scopedMissing = (await loadGoalState(statePath)) === null;
     } catch {
-      // Corrupt scoped fails closed below via tryClaimLease path.
+      // Corrupt scoped file falls through to the lease, which fails closed.
+      scopedMissing = false;
     }
+    if (scopedMissing) return takeLock();
   }
   try {
-    const res = await tryClaimLease(statePath, owner, LEASE_TTL_MS, clock);
-    return { claimed: res.claimed };
+    const res = await tryClaimLease(statePath, owner, ttlMs, clock);
+    if (!res.claimed) return { claimed: false, release: noopRelease };
+    return {
+      claimed: true,
+      release: async () => {
+        try {
+          await releaseLease(statePath, owner, clock);
+        } catch {
+          // Release failure is safe: the TTL reclaims a stale lease.
+        }
+      },
+    };
   } catch {
-    // Lock I/O failure fails closed: never mutate without the lease.
-    return { claimed: false };
+    // Lock I/O failure fails closed: never mutate without a guard.
+    return { claimed: false, release: noopRelease };
   }
 }
 
 /**
- * Release a tool-held lease, best-effort.
- * Why best-effort: transition helpers already clear the lease on save, so
- * this is normally a no-op; it only matters when a save threw mid-mutation.
+ * Unique lease owner for one tool invocation.
+ * Why not the bare session id: the lease treats a repeated owner as the same
+ * writer and lets it re-claim, so two concurrent calls in one session could both
+ * enter a read-modify-write. A per-call suffix makes them distinct.
+ * @param sessionID lane id from the host tool context
  */
-async function releaseToolLease(
-  statePath: string,
-  owner: string,
-  clock: Clock,
-): Promise<void> {
-  try {
-    await releaseLease(statePath, owner, clock);
-  } catch {
-    // Release failure is safe: the TTL reclaims a stale lease.
-  }
+function toolOwner(sessionID: string): string {
+  toolOwnerSeq += 1;
+  return 'tool:' + sessionID + ':' + String(toolOwnerSeq);
 }
 
 /**
@@ -208,7 +255,7 @@ async function toolSet(
   const legacyPath = resolveLegacyStatePath(projectDir);
   const loaded = await loadForTool(statePath, legacyPath);
   if ('error' in loaded) return loaded.error;
-  const owner = 'tool:' + sessionID;
+  const owner = toolOwner(sessionID);
   const claim = await claimForTool(
     statePath,
     legacyPath,
@@ -226,7 +273,7 @@ async function toolSet(
     }
     return 'Goal set to active: ' + next.objective;
   } finally {
-    await releaseToolLease(statePath, owner, clock);
+    await claim.release();
   }
 }
 
@@ -254,7 +301,7 @@ async function toolBlock(
   if (loaded.state === null) {
     return 'No goal set. Use /goal <objective> first.';
   }
-  const owner = 'tool:' + sessionID;
+  const owner = toolOwner(sessionID);
   const claim = await claimForTool(
     statePath,
     legacyPath,
@@ -264,13 +311,20 @@ async function toolBlock(
   );
   if (!claim.claimed) return BUSY_MESSAGE;
   try {
+    // Reload inside the guard: the pre-claim snapshot may be stale, and acting
+    // on it would overwrite a change made between load and claim.
+    const fresh = await loadForTool(statePath, legacyPath);
+    if ('error' in fresh) return fresh.error;
+    if (fresh.state === null) {
+      return 'No goal set. Use /goal <objective> first.';
+    }
     let next: GoalState;
     try {
-      next = blockGoal(loaded.state, reason, clock);
+      next = blockGoal(fresh.state, reason, clock);
     } catch {
       return (
         'Only an active goal can be blocked. Current status: ' +
-        loaded.state.status +
+        fresh.state.status +
         '.'
       );
     }
@@ -281,7 +335,7 @@ async function toolBlock(
     }
     return 'Goal marked blocked: ' + reason;
   } finally {
-    await releaseToolLease(statePath, owner, clock);
+    await claim.release();
   }
 }
 
@@ -391,7 +445,7 @@ export async function recordEvidence(
       '.'
     );
   }
-  const owner = 'tool:' + sessionID;
+  const owner = toolOwner(sessionID);
   const claimRes = await claimForTool(
     statePath,
     legacyPath,
@@ -401,6 +455,20 @@ export async function recordEvidence(
   );
   if (!claimRes.claimed) return BUSY_MESSAGE;
   try {
+    // Reload inside the guard: evidence may only be recorded for a goal that is
+    // still active now, not for the one seen before the claim.
+    const fresh = await loadForTool(statePath, legacyPath);
+    if ('error' in fresh) return fresh.error;
+    if (fresh.state === null) {
+      return 'No goal set. Use /goal <objective> first.';
+    }
+    if (fresh.state.status !== 'active') {
+      return (
+        'Only an active goal can record evidence. Current status: ' +
+        fresh.state.status +
+        '.'
+      );
+    }
     // Null sidecar (e.g. tool-lane set never seeded one) starts empty.
     // Scoped evidence: slash plus tool lanes never share citations.
     const current =
@@ -436,7 +504,7 @@ export async function recordEvidence(
     }
     return 'Criterion recorded for ' + id + '.';
   } finally {
-    await releaseToolLease(statePath, owner, clock);
+    await claimRes.release();
   }
 }
 
@@ -459,31 +527,25 @@ async function toolComplete(
   if (loaded.state === null) {
     return 'No goal set. Use /goal <objective> first.';
   }
-  const owner = 'tool:' + sessionID;
+  const owner = toolOwner(sessionID);
+  // Longer lease: completion now observes real test commands, so the guard
+  // must outlive the verification pass instead of expiring mid-run.
   const claim = await claimForTool(
     statePath,
     legacyPath,
     loaded.state,
     owner,
     clock,
+    PROOF_TOTAL_TIMEOUT_MS + 60000,
   );
   if (!claim.claimed) return BUSY_MESSAGE;
   try {
-    let next: GoalState;
-    try {
-      next = completeGoal(loaded.state, clock);
-    } catch {
-      return (
-        'Only an active goal can complete. Current status: ' +
-        loaded.state.status +
-        '.'
-      );
-    }
     try {
       const ev = await loadEvidence(projectDir, storage);
       const check = await tryCompleteWithEvidence({
         projectDir,
         evidence: ev,
+        clock,
       });
       if (!check.ok) {
         return (
@@ -495,6 +557,29 @@ async function toolComplete(
     } catch {
       return 'Complete blocked: verifier-error. Add evidence and retry.';
     }
+    // Reload AFTER proof, immediately before the save: the only snapshot that
+    // is safe to write after a pass that can run for minutes. Same guard and
+    // message as the slash lane, so both surfaces recover identically.
+    const fresh = await loadForTool(statePath, legacyPath);
+    if ('error' in fresh) return fresh.error;
+    if (fresh.state === null) {
+      return 'No goal set. Use /goal <objective> first.';
+    }
+    // Whole-generation identity, not just the objective: any transition during
+    // the pass invalidates this completion and must not be overwritten.
+    if (goalIdentity(fresh.state) !== goalIdentity(loaded.state)) {
+      return STATE_CHANGED_MESSAGE;
+    }
+    let next: GoalState;
+    try {
+      next = completeGoal(fresh.state, clock);
+    } catch {
+      return (
+        'Only an active goal can complete. Current status: ' +
+        fresh.state.status +
+        '.'
+      );
+    }
     try {
       await saveGoalState(statePath, next);
     } catch (err) {
@@ -502,7 +587,7 @@ async function toolComplete(
     }
     return 'Goal marked complete.';
   } finally {
-    await releaseToolLease(statePath, owner, clock);
+    await claim.release();
   }
 }
 
@@ -522,7 +607,7 @@ async function toolResume(
   if (loaded.state === null) {
     return 'No goal set. Use /goal <objective> first.';
   }
-  const owner = 'tool:' + sessionID;
+  const owner = toolOwner(sessionID);
   const claim = await claimForTool(
     statePath,
     legacyPath,
@@ -532,13 +617,20 @@ async function toolResume(
   );
   if (!claim.claimed) return BUSY_MESSAGE;
   try {
+    // Reload inside the guard: resuming the snapshot read before the claim
+    // would resurrect state that a concurrent transition already changed.
+    const fresh = await loadForTool(statePath, legacyPath);
+    if ('error' in fresh) return fresh.error;
+    if (fresh.state === null) {
+      return 'No goal set. Use /goal <objective> first.';
+    }
     let resumed: GoalState;
     try {
-      resumed = resumeGoal(loaded.state, clock);
+      resumed = resumeGoal(fresh.state, clock);
     } catch {
       return (
         'Only a parked goal can resume. Current status: ' +
-        loaded.state.status +
+        fresh.state.status +
         '.'
       );
     }
@@ -549,7 +641,7 @@ async function toolResume(
     }
     return 'Goal resumed: ' + resumed.objective;
   } finally {
-    await releaseToolLease(statePath, owner, clock);
+    await claim.release();
   }
 }
 
diff --git a/src/verifier.ts b/src/verifier.ts
index ae714ec..e2550a6 100644
--- a/src/verifier.ts
+++ b/src/verifier.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Completion verifier Phase 3.
  * Why this module exists: completion needs checked proof, never agent self-report.
@@ -5,8 +6,16 @@
  */
 import { promises as fs } from 'node:fs';
 import path from 'node:path';
-import type { GoalEvidenceFile } from './evidence.js';
+import type { EvidenceCriterion, GoalEvidenceFile } from './evidence.js';
 import { validateEvidenceShape, hashEvidence } from './evidence.js';
+import { SystemClock } from './state.js';
+import type { Clock } from './state.js';
+import {
+  PROOF_MAX_COMMANDS,
+  PROOF_TIMEOUT_MS,
+  PROOF_TOTAL_TIMEOUT_MS,
+  runProofCommand,
+} from './proof.js';
 
 /**
  * Return true only when a citation resolves to a file inside projectDir.
@@ -56,6 +65,74 @@ export interface LocalVerifyResult {
   failures: string[];
 }
 
+/**
+ * Options for local verification.
+ * Why optional: existing callers pass only projectDir plus evidence and keep
+ * the historical declare-only behavior. The completion path opts into
+ * observation so online agents cannot close a goal on a typed exit code.
+ */
+export interface VerifyLocalOptions {
+  /**
+   * When true, execute each criterion's recorded command and require an
+   * observed exit 0 instead of trusting the declared exitCode.
+   */
+  runTests?: boolean;
+  /** Injected clock for measured durations; defaults to SystemClock. */
+  clock?: Clock;
+  /** Per-command timeout override, mainly for tests. */
+  timeoutMs?: number;
+}
+
+/**
+ * Observe every recorded test command for one criterion.
+ * Why every command: running only the preferred one lets a caller bolt a
+ * trivial passing command onto a failing suite, which would make observation
+ * decorative. All non-empty commands must pass, so a hidden failure surfaces.
+ * Budget: each command gets the smaller of the per-command timeout and the
+ * remaining share of the pass deadline; an exhausted pass fails closed.
+ * @param projectDir absolute project root, the command working directory
+ * @param criterion one evidence criterion
+ * @param opts verification options carrying clock and timeout overrides
+ * @param executed shared counter enforcing the per-verification cap
+ * @param deadlineMs absolute epoch ms when this pass must stop starting work
+ * @returns null when every command observed ok, else a stable failure string
+ */
+async function observeCriterionTests(
+  projectDir: string,
+  criterion: EvidenceCriterion,
+  opts: VerifyLocalOptions,
+  executed: { count: number },
+  deadlineMs: number,
+): Promise<string | null> {
+  // Only non-empty command strings are runnable; a blank one proves nothing.
+  const candidates = criterion.tests.filter(
+    (t) => typeof t.command === 'string' && t.command.trim().length > 0,
+  );
+  if (candidates.length === 0) return 'missing-passing-test:' + criterion.id;
+  const clock = opts.clock ?? new SystemClock();
+  for (const candidate of candidates) {
+    if (executed.count >= PROOF_MAX_COMMANDS) return 'test-cap:' + criterion.id;
+    // Remaining budget shrinks the per-command window so the pass stays bounded.
+    const remaining = deadlineMs - clock.nowMs();
+    if (remaining <= 0) return 'test-budget:' + criterion.id;
+    const perCommand = Math.min(opts.timeoutMs ?? PROOF_TIMEOUT_MS, remaining);
+    executed.count += 1;
+    const proof = await runProofCommand(
+      projectDir,
+      candidate.command,
+      clock,
+      perCommand,
+    );
+    // Observed success is the only pass: the declared exit code is ignored here.
+    if (proof.ok) continue;
+    if (proof.timedOut) return 'test-timeout:' + criterion.id;
+    if (proof.exitCode !== null)
+      return 'test-failed:' + criterion.id + ':exit=' + String(proof.exitCode);
+    return 'test-not-run:' + criterion.id + ':' + proof.reason;
+  }
+  return null;
+}
+
 /** Minimal host probe for optional subagent dispatch. TO-VERIFY on host v2.0.29. */
 export type SubagentRunner = (input: {
   stateSummary: string;
@@ -77,13 +154,17 @@ export function getSubagentRunner(host: unknown): SubagentRunner | null {
 }
 
 /**
- * Run local evidence checks: shape plus file existence plus passing test proof.
+ * Run local evidence checks: shape plus file existence plus test proof.
+ * Test proof is either declared (default, historical behavior) or observed by
+ * executing the recorded command when `opts.runTests` is true.
  * @param projectDir absolute project root for resolving relative citations
  * @param evidence parsed evidence file or null
+ * @param opts observation mode plus clock and timeout overrides
  */
 export async function verifyLocal(
   projectDir: string,
   evidence: GoalEvidenceFile | null,
+  opts?: VerifyLocalOptions,
 ): Promise<LocalVerifyResult> {
   if (evidence === null)
     return {
@@ -95,6 +176,11 @@ export async function verifyLocal(
   if (!shape.ok)
     return { ok: false, reason: shape.reason, failures: [shape.reason] };
   const failures: string[] = [];
+  // Shared command budget across all criteria for this verification pass.
+  const executed = { count: 0 };
+  // One deadline per pass so a padded sidecar cannot run for hours.
+  const deadlineMs =
+    (opts?.clock ?? new SystemClock()).nowMs() + PROOF_TOTAL_TIMEOUT_MS;
   for (const c of evidence.criteria) {
     for (const f of c.files) {
       // Traversal guard first: outside citations fail without filesystem reads.
@@ -113,14 +199,26 @@ export async function verifyLocal(
         failures.push('missing-file:' + c.id + ':' + String(f));
       }
     }
-    // Each criterion needs at least one passing test proof.
-    const passing = c.tests.some(
-      (t) =>
-        typeof t.command === 'string' &&
-        t.command.length > 0 &&
-        t.exitCode === 0,
-    );
-    if (!passing) failures.push('missing-passing-test:' + c.id);
+    if (opts?.runTests === true) {
+      // Observed mode: a declared exit code cannot stand in for a real run.
+      const reason = await observeCriterionTests(
+        projectDir,
+        c,
+        opts,
+        executed,
+        deadlineMs,
+      );
+      if (reason !== null) failures.push(reason);
+    } else {
+      // Declared mode: each criterion needs at least one declared passing test.
+      const passing = c.tests.some(
+        (t) =>
+          typeof t.command === 'string' &&
+          t.command.length > 0 &&
+          t.exitCode === 0,
+      );
+      if (!passing) failures.push('missing-passing-test:' + c.id);
+    }
   }
   if (failures.length > 0)
     return { ok: false, reason: 'evidence-invalid', failures };
@@ -138,9 +236,19 @@ export async function verifyCompletion(args: {
   host?: unknown;
   useSubagent?: boolean;
   stateSummary?: string;
+  /** When true, local verification executes recorded commands. */
+  runTests?: boolean;
+  /** Injected clock for measured proof durations. */
+  clock?: Clock;
+  /** Per-command timeout override. */
+  timeoutMs?: number;
 }): Promise<LocalVerifyResult> {
   try {
-    const local = await verifyLocal(args.projectDir, args.evidence);
+    const local = await verifyLocal(args.projectDir, args.evidence, {
+      runTests: args.runTests === true,
+      clock: args.clock,
+      timeoutMs: args.timeoutMs,
+    });
     if (!local.ok) return local;
     if (args.useSubagent !== true) return local;
     const runner = getSubagentRunner(args.host ?? null);
@@ -175,6 +283,9 @@ export async function verifyCompletion(args: {
  * Why this helper exists: goal-loop evidence discipline blocks bare
  * self-report completes while keeping the legacy pure completeGoal intact
  * for backwards compatibility. Returns pass only when local verifier ok.
+ * Observation is ON by default here: both complete lanes go through this
+ * helper, and the gate must read a real exit code rather than a typed one.
+ * Pass `runTests: false` only for a caller that explicitly wants declare-only.
  * Wrap-up-once is tracked via state.wrapupSent by callers, not here.
  * @param args project dir plus evidence plus optional host dispatch
  */
@@ -184,9 +295,18 @@ export async function tryCompleteWithEvidence(args: {
   host?: unknown;
   useSubagent?: boolean;
   stateSummary?: string;
+  /** Defaults to true; false restores declare-only verification. */
+  runTests?: boolean;
+  /** Injected clock for measured proof durations. */
+  clock?: Clock;
+  /** Per-command timeout override. */
+  timeoutMs?: number;
 }): Promise<LocalVerifyResult> {
-  // Delegate to full verifier: local first, optional subagent second.
-  const got = await verifyCompletion(args);
+  // Delegate to full verifier: local first (observed by default), subagent second.
+  const got = await verifyCompletion({
+    ...args,
+    runTests: args.runTests !== false,
+  });
   // Map missing proof to explicit gate reason for friendly UI messages.
   if (!got.ok && got.reason === 'missing-evidence') {
     return { ok: false, reason: 'evidence-required', failures: got.failures };
diff --git a/src/watchdog.ts b/src/watchdog.ts
index bae1f2c..0dd20ca 100644
--- a/src/watchdog.ts
+++ b/src/watchdog.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Watchdog timer for the idle-never-arrives stall.
  * Why this module exists: the idle-only trigger cannot wake the loop when the
diff --git a/tests/index.test.ts b/tests/index.test.ts
index dc81c3c..915955d 100644
--- a/tests/index.test.ts
+++ b/tests/index.test.ts
@@ -48,6 +48,85 @@ describe('handleGoalCommand guards', () => {
     const got = await handleGoalCommand('/goal complete', dir, clock);
     expect(got).toContain('Only an active goal can complete');
   });
+  it('slash complete serializes on the lease instead of racing', async () => {
+    // Regression: slash completion now runs real proof commands, so it must hold
+    // the lease for the whole pass. Two concurrent completes must not both win.
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-slash-lease-'));
+    const clock = new FakeClock();
+    await handleGoalCommand('/goal finish it', dir, clock);
+    await fsp.writeFile(path.join(dir, 'proof.txt'), 'done\n', 'utf8');
+    const cases = [
+      'id=e1 claim=one files=proof.txt tests=node -e "process.exit(0)":0',
+      'id=e2 claim=two files=proof.txt tests=node -e "process.exit(0)":0',
+    ];
+    for (const args of cases) {
+      const out = await handleGoalCommand('/goal evidence ' + args, dir, clock);
+      expect(out).toContain('Criterion recorded');
+    }
+    const [first, second] = await Promise.all([
+      handleGoalCommand('/goal complete', dir, clock),
+      handleGoalCommand('/goal complete', dir, clock),
+    ]);
+    const results = [first, second];
+    const wins = results.filter((r) => r === 'Goal marked complete.');
+    const busy = results.filter((r) => /busy/i.test(r));
+    // Exactly one winner and one contention result: no lost update, no double.
+    expect(wins.length).toBe(1);
+    expect(busy.length).toBe(1);
+  });
+  it('slash complete releases the lease on a blocked verdict', async () => {
+    // A failed proof must not strand the lease: the next owner can claim it.
+    const { tryClaimLease, LEASE_TTL_MS } = await import('../src/state.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-slash-release-'));
+    const clock = new FakeClock();
+    await handleGoalCommand('/goal release me', dir, clock);
+    await fsp.writeFile(path.join(dir, 'proof.txt'), 'done\n', 'utf8');
+    await handleGoalCommand(
+      '/goal evidence id=e1 claim=x files=proof.txt tests=node -e "process.exit(4)":0',
+      dir,
+      clock,
+    );
+    const blocked = await handleGoalCommand('/goal complete', dir, clock);
+    expect(blocked).toContain('Complete blocked');
+    const state = JSON.parse(
+      await fsp.readFile(resolveStatePath(dir), 'utf8'),
+    ) as { leaseOwner: string | null };
+    expect(state.leaseOwner).toBeNull();
+    const claim = await tryClaimLease(
+      resolveStatePath(dir),
+      'other',
+      LEASE_TTL_MS,
+      clock,
+    );
+    expect(claim.claimed).toBe(true);
+  });
+  it('a goal set during a slow completion is refused by the lease', async () => {
+    // Serialization guard: proof takes hundreds of ms, and a slash set now takes
+    // the same lease as completion, so the replacement is rejected as busy
+    // instead of racing the save.
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-slash-stale-'));
+    const clock = new FakeClock();
+    await handleGoalCommand('/goal first goal', dir, clock);
+    await fsp.writeFile(path.join(dir, 'proof.txt'), 'done\n', 'utf8');
+    await handleGoalCommand(
+      '/goal evidence id=e1 claim=x files=proof.txt tests=node -e "setTimeout(()=>{}, 800)":0',
+      dir,
+      clock,
+    );
+    const completing = handleGoalCommand('/goal complete', dir, clock);
+    // Try to replace the goal while the proof command is still running.
+    await new Promise((resolve) => setTimeout(resolve, 150));
+    const replaced = await handleGoalCommand('/goal second goal', dir, clock);
+    expect(replaced).toMatch(/busy/i);
+    const out = await completing;
+    expect(out).toBe('Goal marked complete.');
+    const state = JSON.parse(
+      await fsp.readFile(resolveStatePath(dir), 'utf8'),
+    ) as { objective: string; status: string };
+    // The original goal completed; the rejected replacement never landed.
+    expect(state.objective).toBe('first goal');
+    expect(state.status).toBe('complete');
+  }, 20000);
   it('reports save failure separately', async () => {
     // Read-only state dir: load succeeds, save fails with EACCES (QA F4).
     const dir = mkdtempSync(path.join(tmpdir(), 'goal-savefail-'));
diff --git a/tests/proof.test.ts b/tests/proof.test.ts
new file mode 100644
index 0000000..5c08552
--- /dev/null
+++ b/tests/proof.test.ts
@@ -0,0 +1,278 @@
+/**
+ * Observed proof tests.
+ * Why these tests exist: the completion gate used to accept a typed exit code.
+ * These prove the runner observes reality, fails closed on timeout and spawn
+ * errors, pins its working directory, and that the verifier switches behavior
+ * only when observation is requested.
+ */
+import { describe, expect, it } from 'vitest';
+import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import * as path from 'node:path';
+import { runProofCommand } from '../src/proof.js';
+import { verifyLocal, tryCompleteWithEvidence } from '../src/verifier.js';
+import type { Clock } from '../src/state.js';
+import type { GoalEvidenceFile } from '../src/evidence.js';
+
+/** Fixed clock keeps durations deterministic; proof timing is not asserted. */
+class FakeClock implements Clock {
+  nowMs(): number {
+    return 1700000000000;
+  }
+}
+
+/** Build a criterion set citing an existing file, one command each. */
+function evidenceFor(
+  dir: string,
+  command: string,
+  exitCode = 0,
+): GoalEvidenceFile {
+  writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+  return {
+    version: 1,
+    updatedAtMs: 1700000000000,
+    criteria: [
+      {
+        id: 'e1',
+        claim: 'work is done',
+        files: ['proof.txt'],
+        tests: [{ command, exitCode }],
+      },
+    ],
+  };
+}
+
+/** Build a single criterion with several recorded commands. */
+function multiCommandEvidence(
+  dir: string,
+  commands: string[],
+): GoalEvidenceFile {
+  writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+  return {
+    version: 1,
+    updatedAtMs: 1700000000000,
+    criteria: [
+      {
+        id: 'e1',
+        claim: 'work is done',
+        files: ['proof.txt'],
+        tests: commands.map((command) => ({ command, exitCode: 0 })),
+      },
+    ],
+  };
+}
+
+describe('runProofCommand', () => {
+  it('observes a real zero exit', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-ok-'));
+    const got = await runProofCommand(
+      dir,
+      'node -e "process.exit(0)"',
+      new FakeClock(),
+    );
+    expect(got.ok).toBe(true);
+    expect(got.exitCode).toBe(0);
+    expect(got.reason).toBe('ran');
+    expect(got.outputHash.length).toBe(16);
+  });
+
+  it('reports a real non-zero exit instead of trusting the caller', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-fail-'));
+    const got = await runProofCommand(
+      dir,
+      'node -e "process.exit(3)"',
+      new FakeClock(),
+    );
+    expect(got.ok).toBe(false);
+    expect(got.exitCode).toBe(3);
+    expect(got.reason).toBe('exit-3');
+  });
+
+  it('rejects empty and non-string commands without spawning', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-empty-'));
+    const clock = new FakeClock();
+    for (const bad of ['', '   ', 42, null, undefined]) {
+      const got = await runProofCommand(dir, bad, clock);
+      expect(got.ok).toBe(false);
+      expect(got.reason).toBe('empty-command');
+      expect(got.exitCode).toBeNull();
+    }
+  });
+
+  it('kills a hanging command and fails closed on timeout', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-hang-'));
+    const got = await runProofCommand(
+      dir,
+      'node -e "setTimeout(() => {}, 30000)"',
+      new FakeClock(),
+      150,
+    );
+    expect(got.ok).toBe(false);
+    expect(got.timedOut).toBe(true);
+    expect(got.reason).toBe('timeout');
+  });
+
+  it('runs inside the project directory', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-cwd-'));
+    const got = await runProofCommand(
+      dir,
+      "node -e \"require('fs').writeFileSync('cwd.txt', process.cwd())\"",
+      new FakeClock(),
+    );
+    expect(got.ok).toBe(true);
+    expect(existsSync(path.join(dir, 'cwd.txt'))).toBe(true);
+  });
+
+  it('maps a missing binary to spawn-error', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-spawn-'));
+    const got = await runProofCommand(
+      dir,
+      'goal-proof-definitely-not-a-binary --version',
+      new FakeClock(),
+    );
+    expect(got.ok).toBe(false);
+    // A shell that cannot find the binary exits 127 rather than failing to spawn.
+    expect(got.reason === 'spawn-error' || got.reason === 'exit-127').toBe(
+      true,
+    );
+  });
+});
+
+describe('verifyLocal observation mode', () => {
+  it('blocks a fabricated exit code whose command really fails', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-fabric-'));
+    const ev = evidenceFor(dir, 'node -e "process.exit(1)"', 0);
+    const got = await verifyLocal(dir, ev, {
+      runTests: true,
+      clock: new FakeClock(),
+    });
+    expect(got.ok).toBe(false);
+    expect(got.reason).toBe('evidence-invalid');
+    expect(got.failures.join(' ')).toContain('test-failed:e1:exit=1');
+  });
+
+  it('passes when the observed command really exits zero', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-real-'));
+    const ev = evidenceFor(dir, 'node -e "process.exit(0)"', 0);
+    const got = await verifyLocal(dir, ev, {
+      runTests: true,
+      clock: new FakeClock(),
+    });
+    expect(got.ok).toBe(true);
+    expect(got.reason).toContain('ok:');
+  });
+
+  it('keeps declare-only behavior for legacy callers', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-legacy-'));
+    const ev = evidenceFor(dir, 'node -e "process.exit(1)"', 0);
+    const got = await verifyLocal(dir, ev);
+    // No observation requested: historical behavior is preserved on purpose.
+    expect(got.ok).toBe(true);
+  });
+
+  it('complete path observes by default', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-default-'));
+    const ev = evidenceFor(dir, 'node -e "process.exit(7)"', 0);
+    const got = await tryCompleteWithEvidence({
+      projectDir: dir,
+      evidence: ev,
+      clock: new FakeClock(),
+    });
+    expect(got.ok).toBe(false);
+    expect(got.failures.join(' ')).toContain('test-failed:e1:exit=7');
+  });
+
+  it('complete path can opt out explicitly', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-optout-'));
+    const ev = evidenceFor(dir, 'node -e "process.exit(7)"', 0);
+    const got = await tryCompleteWithEvidence({
+      projectDir: dir,
+      evidence: ev,
+      clock: new FakeClock(),
+      runTests: false,
+    });
+    expect(got.ok).toBe(true);
+  });
+
+  it('reports missing proof when no command was recorded', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-nocmd-'));
+    const ev = evidenceFor(dir, '   ', 0);
+    const got = await verifyLocal(dir, ev, {
+      runTests: true,
+      clock: new FakeClock(),
+    });
+    expect(got.ok).toBe(false);
+    expect(got.failures.join(' ')).toContain('missing-passing-test:e1');
+  });
+
+  it('runs every recorded command so a trivial pass cannot mask a failure', async () => {
+    // The bypass: a passing command beside the failing suite used to win.
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-multi-'));
+    const ev = multiCommandEvidence(dir, [
+      'node -e "process.exit(0)"',
+      'node -e "process.exit(5)"',
+    ]);
+    const got = await verifyLocal(dir, ev, {
+      runTests: true,
+      clock: new FakeClock(),
+    });
+    expect(got.ok).toBe(false);
+    expect(got.failures.join(' ')).toContain('test-failed:e1:exit=5');
+  });
+
+  it('maps a hanging command to test-timeout through verifyLocal', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-vtimeout-'));
+    const ev = evidenceFor(dir, 'node -e "setTimeout(() => {}, 30000)"');
+    const got = await verifyLocal(dir, ev, {
+      runTests: true,
+      clock: new FakeClock(),
+      timeoutMs: 150,
+    });
+    expect(got.ok).toBe(false);
+    expect(got.failures.join(' ')).toContain('test-timeout:e1');
+  });
+
+  it('maps an unrunnable command to a distinct failure reason', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-vspawn-'));
+    const ev = evidenceFor(dir, 'goal-proof-definitely-not-a-binary --version');
+    const got = await verifyLocal(dir, ev, {
+      runTests: true,
+      clock: new FakeClock(),
+    });
+    expect(got.ok).toBe(false);
+    // Shell reports 127 when the binary is missing; both reasons fail closed.
+    expect(got.failures.join(' ')).toMatch(/test-not-run|test-failed/);
+  });
+
+  it('enforces the command cap across criteria', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-proof-cap-'));
+    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+    const criteria = Array.from({ length: 21 }, (_unused, index) => ({
+      id: 'e' + String(index),
+      claim: 'work is done',
+      files: ['proof.txt'],
+      tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
+    }));
+    const ev: GoalEvidenceFile = {
+      version: 1,
+      updatedAtMs: 1700000000000,
+      criteria,
+    };
+    const got = await verifyLocal(dir, ev, {
+      runTests: true,
+      clock: new FakeClock(),
+    });
+    expect(got.ok).toBe(false);
+    expect(got.failures.join(' ')).toContain('test-cap:e20');
+  });
+
+  it('rejects a relative project directory without spawning', async () => {
+    const got = await runProofCommand(
+      'relative/project',
+      'node -e "process.exit(0)"',
+      new FakeClock(),
+    );
+    expect(got.ok).toBe(false);
+    expect(got.reason).toBe('invalid-cwd');
+  });
+});
diff --git a/tests/session-isolation.test.ts b/tests/session-isolation.test.ts
index 8214d30..6c68a67 100644
--- a/tests/session-isolation.test.ts
+++ b/tests/session-isolation.test.ts
@@ -129,6 +129,37 @@ describe('session isolation', () => {
     expect(legacy?.status).toBe('active');
   });
 
+  it('concurrent first writes on a legacy goal serialize', async () => {
+    // Migrate-on-write: the scoped file does not exist and the state comes from
+    // the legacy fallback, so the lease cannot serialize it. The dedicated lock
+    // must let exactly one writer through and leave one consistent scoped file.
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-lock-'));
+    const clock = new FakeClock();
+    await handleGoalCommand('/goal legacy goal', dir, clock);
+    const [a, b] = await Promise.all([
+      handleGoalCommand(
+        '/goal block reason one',
+        dir,
+        clock,
+        '2.0.29',
+        'sess-L',
+      ),
+      handleGoalCommand(
+        '/goal block reason two',
+        dir,
+        clock,
+        '2.0.29',
+        'sess-L',
+      ),
+    ]);
+    const results = [a, b];
+    expect(
+      results.filter((r) => r.includes('Goal marked blocked')).length,
+    ).toBe(1);
+    expect(results.filter((r) => /busy/i.test(r)).length).toBe(1);
+    const scoped = await loadGoalState(resolveStatePath(dir, 'sess-L'));
+    expect(scoped?.status).toBe('blocked');
+  });
   it('sanitize blocks path traversal without throwing', async () => {
     expect(sanitizeSessionId('../../etc')).toMatch(/^sid-[0-9a-f]{8}$/);
     expect(sanitizeSessionId('sess-A')).toBe('sess-A');
diff --git a/tests/tools.test.ts b/tests/tools.test.ts
index a043a9e..be52b40 100644
--- a/tests/tools.test.ts
+++ b/tests/tools.test.ts
@@ -229,6 +229,32 @@ describe('tool execute parity with slash', () => {
     const stateB = await loadGoalState(resolveStatePath(dirB));
     expect(stateB).toBeNull();
   });
+  it('a same-session tool call never re-enters an in-flight lease', async () => {
+    // Owner ids are per call, not per session: the lease lets a repeated owner
+    // re-claim, so a fixed `tool:<session>` owner would admit a second writer.
+    const { tryClaimLease, resolveStatePath, LEASE_TTL_MS } =
+      await import('../src/state.js');
+    const clock = new FakeClock();
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-sameowner-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute(
+      { title: 'baseline' },
+      { sessionID: 'sess-R' },
+    );
+    // Simulate an in-flight call from the same session holding the lease.
+    const held = await tryClaimLease(
+      resolveStatePath(dir, 'sess-R'),
+      'tool:sess-R',
+      LEASE_TTL_MS,
+      clock,
+    );
+    expect(held.claimed).toBe(true);
+    const blocked = await byName(defs, 'goal_block').execute(
+      { reason: 'second writer' },
+      { sessionID: 'sess-R' },
+    );
+    expect(blocked.content).toMatch(/busy/i);
+  });
   it('held lease blocks tool mutate without changing state', async () => {
     // Simulate the loop holding the lease: tool must back off, not clobber.
     const { readFileSync } = await import('node:fs');
@@ -346,7 +372,8 @@ describe('goal_evidence sole writer', () => {
         id: 'e1',
         claim: 'work is done',
         files: ['proof.txt'],
-        tests: [{ command: 'npm test', exitCode: 0 }],
+        // Real zero exit: goal_complete now runs the command and reads its code.
+        tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
       },
       { sessionID: 'sess-ev' },
     );
@@ -471,7 +498,7 @@ describe('hotfix qa-reject negative paths', () => {
     id: 'e1',
     claim: 'holds',
     files: ['src/a.ts'],
-    tests: [{ command: 'npm test', exitCode: 0 }],
+    tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
   };
   it('slash with empty exit code is invalid and writes nothing', async () => {
     const { existsSync } = await import('node:fs');
```
<!-- END_GIT_DIFF -->
