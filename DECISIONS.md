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
