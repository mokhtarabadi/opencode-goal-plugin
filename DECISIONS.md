# Decisions

## ADR-001 2026-10-16 File state owns truth

Context: compaction wipes memory. Decision: .opencode/goal-state.json is source of truth with atomic tmp plus rename writes and lease fields. Consequence: survives compaction, enables single-flight claim.

## ADR-002 2026-10-16 Claim-lock file serializes parallel claimants

Context: parallel idle turns shared one tmp name and raced load-modify-write. Decision: wx-flag lock file with stale reclaim plus unique tmp names per call. Consequence: exactly one winner proven by test, crashed runs cannot hold the lock past TTL.

## ADR-003 2026-10-16 Idle single-flight plus cooldown defaults

Context: idle ticks can re-fire while a turn runs. Decision: in-memory idleInFlight plus file lease plus 20s cooldown plus 30 turns plus 2h wall budget plus STOP_GOAL file. Consequence: one send per tick, human messages yield, runaways stop.

## ADR-004 2026-10-16 Compaction restore plus evidence-gated completion

Context: compaction wipes memory and self-report completes too easily. Decision: snapshot plus restore with restoreCount audit and cooldown clamp, evidence sidecar with file plus test proof, local verifier first with optional subagent second. Consequence: goals resume without double send, completion needs proof.

## ADR-005 2026-10-16 Host-native V2 export shape

Context: host loader rejected our plain-object default export as missing id. Decision: default export is Plugin.define with id opencode-goal-plugin plus setup wiring command, idle subscribe, and session hooks, ESM-only dist, @opencode/plugin dependency. Consequence: entry passes host schema on web, CLI, and TUI.

## ADR-006 2026-10-16 Best-plugin hardening without contract break

Context: clones showed crash truncation, double-fire, false complete, global throttle unfairness. Decision: fsync plus chmod plus quarantine, token single-flight plus fail-closed reclaim, evidence-gated helper plus wrapupSent plus nudge, per-session cooldown plus AbortSet, JSON Schema plus traversal guard, file-state stays truth. Consequence: 83 tests green with 7 new regressions, no V2 contract change.

## ADR-007 2026-10-16 Crash and error recovery for an active goal

Context: idle-only trigger stalled an active goal forever when the host emitted no session.idle after a server error or crash, and a failed send was swallowed as a fake success (catch to null then turn-unlabeled). Clone survey: only prevalentWare had a watchdog; heimoshuiyu plus willytop8 plus prevalentWare listened to session.error; goal-loop plus willytop8 paused recovered goals. Decision: subscribe session.error plus execution.failed plus execution.interrupted and classify user-abort versus provider-error; park on abort and park-require-resume; record pendingAttempt plus lastHeartbeatMs plus failureCount plus recoveryEpoch in file state; a 90s watchdog wakes before the 120s lease TTL and every wake re-enters the same lease plus token guard; session start rearms without an immediate send; a failed send stays retryable and never advances the turn; one wrap-up send then stop. Consequence: 102 tests green, an active goal survives a provider error, a failed send, and a restart, and the V2 contract (Plugin.define id plus setup, event.subscribe plus AbortController cleanup) is unchanged.
Rollback: revert this slice; the pure loop plus file state keep prior idle-only behavior.

## ADR-008 2026-10-17 Agent-callable goal tools beside the slash lane

Context: the model could only be driven by user slash commands or the idle loop; smart-compact showed an agent tool lane (compact_context) reusing command helpers. Decision: register goal_set, goal_block, goal_complete, goal_resume via ctx.tool.transform in new src/tools.ts, each execute calling the pure goal.js helpers directly with validated data (never rebuilding slash strings, so reserved-word titles cannot misroute), claiming the file lease under owner tool:<sessionID> before mutating, and returning handleGoalCommand-identical messages (parity-tested). Consequence: model-driven and user-driven paths share validation, evidence gate, Clock, and atomic save with zero drift, and parallel tool calls serialize instead of clobbering.
Rollback: remove the registerGoalTools call; file state untouched.

## ADR-009 2026-10-17 Sole evidence writer closes the completion loop

Context: goal_complete could never succeed because no code path ever wrote criteria into the evidence sidecar (both lanes only read it). Decision: add goal_evidence as the fifth agent tool and sole evidence writer plus a /goal evidence slash mirror delegating to the same recordEvidence handler; id, claim, files, tests all required with shape-only validation at write (existence plus passing stay verifier-side); duplicate ids rejected; writes only on active goals under the state-file lease. Consequence: set to evidence to complete passes with real proof while empty or fabricated evidence still fails, and the verifier plus evidence modules are untouched.
Rollback: remove the tool def plus the slash branch; the sidecar file is per-project runtime state, no migration involved.
