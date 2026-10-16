# Decisions
## ADR-001 2026-10-16 File state owns truth
Context: compaction wipes memory. Decision: .opencode/goal-state.json is source of truth with atomic tmp plus rename writes and lease fields. Consequence: survives compaction, enables single-flight claim.
## ADR-002 2026-10-16 Claim-lock file serializes parallel claimants
Context: parallel idle turns shared one tmp name and raced load-modify-write. Decision: wx-flag lock file with stale reclaim plus unique tmp names per call. Consequence: exactly one winner proven by test, crashed runs cannot hold the lock past TTL.
