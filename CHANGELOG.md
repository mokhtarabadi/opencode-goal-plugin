# Changelog
All notable changes follow Keep a Changelog.
## [Unreleased]
### Added
- Evidence traversal guard rejecting dot-dot escapes.
- Subagent dispatch tests for pass, fail, and throw paths.
- MIT LICENSE plus install docs for all four surfaces.
- Version note: package stays 0.2.0 during Night Work and sync to 0.3.0 is gated to morning publish with token plus live matrix.
- Durable atomic write with fsync plus chmod 0600 plus dir sync plus corrupt quarantine.
- Fail-closed lease with token single-flight plus per-session cooldown fairness.
- Evidence-gated complete helper plus wrap-up flag plus context nudge injection.
- V2 strictness with goal input JSON Schema plus traversal-safe title check.
- Crash recovery: session.error plus execution.failed listeners, classifyFailure, 90s watchdog, session-start rearm, retryable send, persisted pendingAttempt.
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
- Hotfix2 afterSend Clock plus Set copy plus prune helper plus drive-relative guard.
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
