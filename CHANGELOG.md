# Changelog

All notable changes follow Keep a Changelog.

## [Unreleased]

### Added

- A blocked `goal_complete` now names what failed: `describeVerificationFailure` quotes the verifier's concrete reasons (`test-failed:<id>:exit=N`, `missing-file:<id>:<path>`, `test-budget:<id>`) for both the tool and slash lanes, capped at five with `(+N more)`, instead of one canned sentence that told the agent to add citations even when the citations were fine. Reproduced live on a JDK-mismatch proof run. Evidence tests may now carry an optional flat `env` string map, validated as strings and merged into the child environment last, so a project can pin the toolchain its command actually needs. 9 new tests (including a no-leak-across-criteria check); full suite 187 green.

- Evidence traversal guard rejecting dot-dot escapes.
- Subagent dispatch tests for pass, fail, and throw paths.
- MIT LICENSE plus install docs for all four surfaces.
- Version note: package stays 0.2.0 during Night Work and sync to 0.3.0 is gated to morning publish with token plus live matrix.
- Durable atomic write with fsync plus chmod 0600 plus dir sync plus corrupt quarantine.
- Fail-closed lease with token single-flight plus per-session cooldown fairness.
- Evidence-gated complete helper plus wrap-up flag plus context nudge injection.
- V2 strictness with goal input JSON Schema plus traversal-safe title check.
- Crash recovery: session.error plus execution.failed listeners, classifyFailure, 90s watchdog, session-start rearm, retryable send, persisted pendingAttempt.
- Agent-callable goal tools (goal_set, goal_block, goal_complete, goal_resume) calling pure helpers directly with lease guard and slash-identical messages.
- Fifth agent tool goal_evidence (sole evidence writer) plus /goal evidence slash mirror: set to evidence to complete is now reachable with the verifier gate unchanged.

### Fixed

- Host-native V2 export: default is Plugin.define with id plus setup wiring slash goal plus idle plus compaction.
- ESM-only dist because the plugin package ships no require entry.
- Swallowed send no longer fakes a turn: a failed send stays retryable and records pendingAttempt.
- Active goal no longer stalls when no session.idle arrives: watchdog plus error listener plus resume.
- Hotfix: lease-guarded failure write plus abort-aware send plus real startup lane plus wrap-after-success plus watchdog bounds plus /goal resume.
- Hotfix: failed-send lane persistence plus wrap watchdog settle plus pending undefined guard.
- Hotfix idle survival: compaction keeps live controller, stale entries cleared.
- Hotfix evidence wiring: both complete lanes require proof plus wrapupSent once.
- Hotfix setup guard plus session fairness plus lease proof with sidecar.
- Hotfix evidence validation: slash rejects empty exit codes (Number('') coerces to 0); tool trims file entries and rejects partial bad files/tests arrays instead of silently dropping.
- Session-scoped goal isolation: state and evidence now live per session under `.opencode/goals/<sessionId>.json` so session B never sees or continues session A's goal; legacy single file stays as read fallback with migrate-on-write.
- Observed test proof: `goal_complete` now executes every recorded test command in the project directory under a 300s per-command and 600s per-pass budget with a 1 MiB output cap, and requires each to exit 0, so a typed `exitCode` can no longer close a goal; `verifyLocal` keeps declare-only behavior unless observation is requested.
- Docs sync for the per-session layout across README, AGENTS, AGENT-TOOLS, conventions, commands, gitignore, and ADR-010/ADR-011.
- Hotfix2 afterSend Clock plus Set copy plus prune helper plus drive-relative guard.
- Tool-lane `goal_set` now seeds a fresh evidence sidecar like `/goal <objective>`, so criteria recorded for a finished goal no longer accumulate and block later completions with `evidence-invalid`; regression tests cover the stale-criteria path, the old failing command, and slash/tool parity.
- Evidence reads stop falling back to the pre-isolation sidecar once the session has its own file, because an empty seeded file used to parse as absent and merge the legacy bucket back in; a session with no scoped file still migrates once.

## [0.3.0] - 2026-10-16

### Added

- Compaction snapshot plus restore with restoreCount audit and cooldown clamp.
- Evidence sidecar schema plus local verifier plus optional subagent dispatch.

### Fixed

- Verification-pending pauses auto turns without stopping the goal.
- Compaction registration never throws: whole body inside try plus null host guard.

## [0.2.0] - 2026-10-16

### Added

- Idle auto-continue loop with single send per tick plus cooldown plus max turns plus wall time.
- STOP_GOAL kill switch plus human-message yield plus stale lease reclaim.

### Fixed

- Idle tick never throws: claim catch plus ctx and opts guards plus send validation plus fail-closed stop check.
- Atomic file claim proven: wx lock plus real-file concurrency test with exactly one winner.
- Clock plus limits shape guards plus safe spend plus fail-closed stop file on non-ENOENT.

## [0.1.0] - 2026-10-16

### Added

- Phase 1 scaffold with slash goal plus file state.
- Atomic claim-lock file with stale reclaim plus per-call unique tmp names for single-flight.
- Guarded block and complete transitions returning friendly status messages.

### Fixed

- Parser boundary: /goalie-style prefixes plus bare block plus keyword extras now invalid.
- Full shape validation rejects partial goal state as corrupt.
- handleGoalCommand guards null input plus bad project dir plus corrupt state plus separated save errors.
