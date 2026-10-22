# Task 11: Observed test proof and doc sync

**File:** `tasks/completed/11-evidence-truth-and-doc-sync.md`
**Status:** closed
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
- Closure: manager approval "Approved for closure" recorded after ten review rounds. The log does not carry a Code Reviewer APPROVED verdict; the gate rejected on the OS-sandbox scope point after every code defect was fixed, and the Manager ruled closure explicitly. This is recorded here so the missing PO_REVIEW_PENDING is auditable, not implied.

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
**Factual Git Diff:** Stored in Commit Hash: `5ebe0c4a7aada7cb53c58400c12dad408ee11b2f`
<!-- END_GIT_DIFF -->
