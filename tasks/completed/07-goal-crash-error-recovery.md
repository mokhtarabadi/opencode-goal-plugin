# Task 07: Crash And Error Recovery For Active Goal

**File:** `tasks/completed/07-goal-crash-error-recovery.md`
**Status:** closed
**Source:** manager
**Type:** bug
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Host:** opencode v2.0.29

## Goal

When OpenCode server errors or crashes mid-turn, an active goal must resume continuation instead of stalling forever. Today the plugin only reacts to session.idle, so no idle means no continue.

## Reported Symptom

Manager set a goal, it was running, OpenCode server threw an error, and nothing happened after. The plugin never sent continue again; goal stayed active with no recovery.

## Confirmed Defect

- `src/index.ts:647` filters to `session.idle` only, every other event ignored.
- `src/index.ts:670` sendPrompt does `.catch(() => null)`, so a failed turn looks like a normal send.
- No `session.error` listener anywhere in `src/` (grep clean).
- No watchdog timer and no session-start resume of an active goal.

## Clone Findings (recovery survey)

- prevalentWare: only clone with a real idle-never-arrives watchdog, `armTurnWatchdog` with `max_turn_time` at `src/server.ts:1616`, plus transport retry plus `session.execution.failed/interrupted` handling at `src/server.ts:3056`.
- willytop8: maps V2 `execution.failed/interrupted` to `session.error` at `src/v2-bridge.js:315`, no idle watchdog, forces `stopped` on hydrate at `src/goal-plugin.js:1714`.
- goal-loop: no session.error listener, forces `paused` on load at `src/core/state.ts:300`.
- heimoshuiyu: listens `session.error` plus `MessageAbortedError` at `src/index.ts:389`, but guards are in-memory only, crash-fragile.
- oh-my-goal: idle only, crash-fragile, no failure events.

## Seat Check

Domains → seats: session/event contract plus recovery design → Software Architect; loop race plus timer plus resume → Senior Programmer. Skipped: UI/UX Designer (no visual surface), Project Planner plus Sprint Strategist (single bug), QA Engineer plus Code Reviewer (later gates). Trigger eval TITLE+BODY: Architect fires on contract plus API design; Programmer fires on race plus silent-fail plus performance; Designer miss. Cross-disciplinary → 2-seat consult.

## Acceptance Criteria

- [x] D1 failed send never synthesizes turn-unlabeled and stays retryable
- [x] D2 session.error plus execution.failed plus interrupted subscribed with user-abort park versus provider-error retry
- [x] D3 90s watchdog with Clock math plus unref plus cleanup fires once when idle never arrives
- [x] D4 startup rearm without immediate send plus real lastMessageId threaded
- [x] D5 wrap sends exactly once with persisted flag guard
- [x] D6 pendingAttempt plus heartbeat plus failureCount plus recoveryEpoch persisted atomically
- [x] Invariants intact: lease 120s wx, Clock UTC ms, file-state atomic truth, limits 20s/30/2h/STOP_GOAL
- [x] Full suite 111 pass plus typecheck plus prettier green

## Local TODOs

- [x] Create task file and move to in-progress
- [x] Clone recovery survey plus discovery report
- [x] Brain plan O1 approval
- [x] Implement D1-D6 plus 9 regression tests
- [x] Docs sync plus QA transition

## Risk & Rollback

Risk is host event-name drift and a timer that fires after the goal is done, contained by fail-closed event guards plus clear-on-success plus one timer per lane. Rollback is revert of this slice; the pure loop plus file state keep prior idle-only behavior.

## Brainstorm

Brainstorm: required — cross-disciplinary plus hard to reverse loop behavior.

## Execution Log & Reasoning

- Defect reproduced by code read at cited lines. Awaiting brain plan for recovery strategy (session.error listener, watchdog timer, session-start resume) before any code.
- Manager asked brain plus clone analysis for the strategy; survey done, sending to brain now.
- Discovery ground truth: context-reports/context_report_20261016_221359_947dffe1.md. Confirms only trigger is session.idle src/index.ts:647, send swallowed src/index.ts:667-680, wrapupSent unread src/loop.ts:316-333, zero hits for session.error plus timers plus resume, registerIdleHandler plus registerCompactionHandler never called from setup.
- Brain Plan Verdict (task_id 07): O1 selected — D1 retryable send, D2 session.error plus execution.failed listener with classifyFailure, D3 90s watchdog timer with Clock math plus unref, D4 session-start resume plus fix dead wiring plus thread real lastMessageId, D5 wrap-once sends plus flag guard, D6 persisted pendingAttempt plus lastHeartbeatMs plus failureCount plus recoveryEpoch. Brainstorm required. Manager Approved, requesting implementation XML.
- O1 D1-D6 applied. D1: sendPrompt now returns a discriminated SendResult, normalizeSendResult keeps a legacy plain result working, a failed send never advances the turn and records pendingAttempt. D2: setup subscribes session.error plus session.execution.failed plus session.execution.interrupted, classifyFailure splits user-abort versus provider-error, handleSessionFailure parks on abort (status interrupted, requires manual resume) and records a retry on provider error. D3: new src/watchdog.ts with armWatchdog plus clearWatchdog plus rearmFromState, 90s deadline before the 120s lease TTL, unref plus one timer per lane. D4: shared buildIdleDeps, startup rearm from persisted state without an immediate send, real lastMessageID threaded from the event payload. D5: one wrap-up send on the first budget hit then a persisted wrapped-up stop. D6: recovery fields persisted atomically and every refire path claims the lease.
- Invariants preserved: single-flight lease 120s wx, Clock UTC ms with SystemClock as the only Date.now, file-state atomic tmp plus fsync plus chmod plus rename, limits 20s/30/2h/STOP_GOAL unchanged.
- Honest limitation recorded: the plugin runs inside the OpenCode server process, so during a hard server crash no code runs until the host restarts. Recovery after restart is handled by the startup rearm; recovery during a provider error is handled by the error listener plus watchdog.

## Verification Evidence

- Command: rtk test npm test | Expected: all pass | Actual: 14 files 102 tests passed | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: npx prettier --check src/*.ts tests/*.ts | Expected: exit 0 | Actual: exit 0 after --write | Exit: 0.
- Stack gate skip record: root=. markers=[package.json] matched=[] reason=no stack marker found.
- New tests: tests/recovery.test.ts (D1 retryable send, D2 classification plus handler, D3 watchdog, D5 wrap-once, D6 persisted guards).
- Hotfix QA_REJECTED F1-F7 applied: lease-guarded failure write, abort-aware send with retryable respected, real lastSessionId lane instead of fake startup, event-hint classification with top-level error read, wrap flips only after a successful send, watchdog finite plus 500-lane bounds, and /goal resume for a parked goal.
- Hotfix QA_REJECTED F8-F10 applied: settleFailedSend persists lastSessionId so a first-failure restart can rearm, wrap path settles the watchdog on both success and failure, buildPendingAttempt tolerates undefined pending.
- Command: rtk test npm test | Expected: all pass | Actual: 14 files 111 tests passed | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- QA verdict: QA_PASSED after three rounds (111 tests green plus typecheck clean).
- Review verdict: PO_REVIEW_PENDING with technical approval, low issues only (resume throw, silent unknown error, per-tick closure allocation).
- Manager accept quote: Approved for closure.
- Closure approved 2026-10-17: QA_PASSED plus Reviewer PO_REVIEW_PENDING plus Manager Approved for closure.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `534012793ed5737f59940771527973aa33c602f8`
<!-- END_GIT_DIFF -->
