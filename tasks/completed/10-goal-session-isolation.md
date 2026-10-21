# Task 10: Session-scoped goal isolation

**File:** `tasks/completed/10-goal-session-isolation.md`
**Status:** closed
**Source:** manager
**Type:** bugfix
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Priority:** High

## Goal

Scope goal state and evidence per session so session B never sees or continues session A's goal.

## Problem

`resolveStatePath(projectDir)` and `resolveEvidencePath(projectDir)` build one shared `.opencode/goal-state.json` per project. Idle handler, context hook, slash lane, and `goal_*` tools all read that single file. `sessionId` is only used for cooldown token key, not for storage isolation. Result: cross-session leakage.

## Acceptance Criteria

- [x] Goal set in session A is invisible to session B (`status` in B shows no goal).
- [x] Idle tick in B never continues A's objective.
- [x] Evidence is also per-session.
- [x] Existing tests updated, typecheck green.

## Execution Log & Reasoning

- Created from live cross-session leak report.
- [LITE] justification: user explicitly authorized lite task; fix is storage-path scoping with legacy fallback, fully covered by 149 green tests plus tsc clean, no security/financial surface, reversible via revert.
- Seat Check: domains → storage path isolation + tool contract → Software Architect. Skipped Designer (server-only), Senior Programmer (plan-only), QA/Reviewer (later gates). Trigger eval: Architect fires on [schema, contract, migration]; others miss. Brainstorm: not required — single-domain reversible.
- Brain plan verdict (task 10, Architect): per-session files `.opencode/goals/<safeSessionId>.json` + `.evidence.json`, sanitize `[A-Za-z0-9_-]` max64 else FNV-1a `sid-` hash, legacy fallback read + migrate-on-write, thread sessionId through slash/tools/idle/failure/startup/compaction/context. Second turn returned bare Senior Programmer XML (implement).
- Fed-context via 3 parallel cognitive-discovery subagents (state+evidence, index+tools, loop+watchdog) before second planning turn.
- Implementation: state.ts `sanitizeSessionId` + `resolveLegacyStatePath` + scoped `resolveStatePath(projectDir, sessionId?)` + `loadGoalStateWithFallback`; evidence.ts scoped `resolveEvidencePath` + scoped `loadEvidence`/`saveEvidence` with legacy fallback; tools.ts `storageSessionFor` (`unknown`/`slash`/empty → legacy) + scoped claim with first-write-no-lease fix + `recordEvidence` storage session param; index.ts `handleGoalCommand` sessionId param + scoped slash set/status/evidence/complete + scoped startup scan + scoped compaction/context hooks (context hook fails closed without session); loop.ts scoped idle + failure loads with legacy fallback. Kept `lastSessionId` field (now per-file lane, no cross leak).
- Repair R1 (same session): `recordEvidence` after `toolSet` with a different session hit BUSY because `tryClaimLease` on a missing scoped file returns false. Fix: `claimForTool` short-circuits claimed:true when the scoped file is absent (first write, no file to race).
- Repair R2 (tests): 4 red → updated `resolveStatePath(dir, sess)` reads, rewrote share-semantics test to isolation, scoped lease/evidence race tests to same session; added `tests/session-isolation.test.ts` (6 tests: slash invisibility, idle no-continue, evidence invisibility, legacy migrate-once, traversal sanitize, scoped seed never writes legacy).
- Assumption A1: host always supplies real `sessionID` on tool/slash/idle events; `unknown`/missing falls back to legacy and stays isolated from real sessions. A2: legacy migration is read-fallback + migrate-on-next-write (no auto-rewrite, race-free).
- Autopilot locked for task 10 QA per manager answer; chained bridge-QA then bridge-review under same task_id.
- QA_PASSED recorded from Brain QA turn (adversarial: scoped paths, fallback, no leak, traversal, evidence scoping).
- PO_REVIEW_PENDING recorded from Brain reviewer turn (technical approval; low-severity notes only, no blockers).
- Manager accept quote: "Approved for closure" (via closure-approval question, autopilot relay).
- Closure: approval Approved for closure verified, PO_REVIEW_PENDING confirmed, moving to completed per Senior Programmer closure XML.

## Local TODOs

- [x] Scope state + evidence paths per session with legacy fallback
- [x] Thread sessionId through index/tools/loop lanes
- [x] Update/add isolation tests + typecheck + full suite
- [x] CHANGELOG + lint + stage + move to qa

## Verification Evidence

- Command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: clean | Exit: 0.
- Command: `./node_modules/.bin/vitest run --no-color` | Expected: all pass | Actual: 16 files, 149 tests passed | Exit: 0.
- Command: `./node_modules/.bin/prettier --write src tests` then `--check` | Expected: clean | Actual: clean | Exit: 0.
- Stack-skill gate skip record: root dot, markers package.json + tsconfig.json scanned, matched none (Node TS plugin, no framework marker), reason no stack skill in registry; generic tsc + vitest + prettier gates run instead.
- No stack skill matches this repo (Node TS plugin, no framework); skill matrix miss logged.

## Risk & Rollback

- Risk: path change breaks existing single-file users. Mitigation: fallback read of legacy path, then migrate on write.
- Rollback: revert path helpers.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `0addefd0f354f595ea5d4db04e6c9560b4c998c8`
<!-- END_GIT_DIFF -->
