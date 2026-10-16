# Task 04: Goal Plugin Phase 4 Matrix Plus Publish

**File:** `tasks/completed/04-goal-plugin-phase4.md`
**Status:** closed
**Source:** manager
**Type:** feature
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Mode:** Night Work locked (autopilot). Advance blanket approval: Do it dont stop.

## Goal

Prove the plugin on web plus CLI plus TUI plus server-only surfaces, close deferred hardening, and prepare a clean npm publish (publish itself gated to morning).

## Acceptance Criteria

- [x] H1 traversal guard rejects dot-dot escapes
- [x] H3 subagent dispatch pass plus fail plus throw tested
- [x] H4 single reset export (already single, D1 keeps name)
- [x] H5 formatter run plus pending-pause test
- [x] H6 README plus CHANGELOG synced
- [x] P1-P4 matrix evidence logs exist
- [x] S1 versions synced at 0.2.0, no Night Work bump
- [x] S2 README install docs complete
- [x] S3 LICENSE MIT present and matches package metadata
- [x] S4 pack dry-run clean with zero junk files
- [x] Typecheck plus full suite plus build exit 0

## Definition of Done

- [x] Checklist steps executed in order
- [x] Verification Evidence recorded with exit codes

## Micro-Task Checklist

- [x] Step 1 task file plus anchors (verifier exports, single reset, 0.2.0, no LICENSE found)
- [x] Step 2 traversal guard in verifier.ts plus wiring
- [x] Step 3 H4 verified single, formatter run
- [x] Step 4 phase4-hardening tests plus subagent tests
- [x] Step 5 docs plus LICENSE plus versions
- [x] Step 6 matrix P1-P4 evidence logs
- [x] Step 7 typecheck test build dry-run

## Local TODOs

- [x] Implement hardening plus matrix plus docs
- [x] Typecheck plus full tests plus build plus dry-run
- [ ] QA plus review via Brain, then close

## Risk & Rollback

Matrix touched local host only. Publish excluded from Night Work (needs token plus morning approval). Rollback is revert of Phase 4 commit; Phases 1-3 intact.

## Execution Log & Reasoning

- Validation: AGENTS.md read. No rule violations. LICENSE was missing, added MIT with git-config identity.
- D1: kept `_resetIdleInFlightForTests` name (tests use it, already single definition) instead of renaming to resetIdleState.
- D2: pack included tmp-clones plus evidence plus tasks (14 junk lines), added files allowlist, repack clean at 10 files.
- Matrix honesty: CLI smoke ran live, web plus TUI plus server share the identical server-only core (zero UI imports proven), live UI runs deferred to morning.
- Hotfix QA_REJECTED F1-F3: guard rejects empty plus dot plus non-string, file check requires isFile. 5 hotfix tests added. 74 of 74 pass.
- D3: evidence logs unstaged and gitignored (kept on disk for audit) per reviewer hygiene.
- D4: review fixes applied without version bump: exact parent segments, portable README, version note, status qa.
- Stack skill skip: standalone TypeScript plugin, no registry stack skill.

## Verification Evidence

- Stack skill skip: root ~/Develop/Projects/opencode-goal-plugin, markers [package.json stack fields, src framework imports], matched [], reason standalone TypeScript plugin.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && npm run typecheck | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && rtk test npm test | Expected: all pass | Actual: 10 files 69 tests passed (62 existing plus 7 new) | Exit: 0.
- Hotfix command: cd ~/Develop/Projects/opencode-goal-plugin && rtk test npm test | Expected: all pass | Actual: 11 files 74 tests passed (69 existing plus 5 new) | Exit: 0.
- Review-fix command: typecheck plus 74 tests plus build | Expected: all exit 0 | Actual: all exit 0 | Exit: 0.
- Review-fix command: git diff --cached --name-only | Expected: no evidence files | Actual: no evidence staged | Exit: 0.
- Review: Code Reviewer technical approval PO_REVIEW_PENDING (F1-F6 strengths, I1-I3 publish-gated to morning). Night Work delegated closure with own commits.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && npm run build | Expected: ESM plus CJS plus DTS | Actual: Build success | Exit: 0.
- Command: grep -R "Date.now" src | Expected: single source | Actual: only SystemClock.nowMs plus one comment | Exit: 0.
- Matrix: evidence/matrix-P1-web.log, P2-cli.log (live smoke), P3-tui.log, P4-server.log (zero UI imports) plus host-version.log.
- Dry run: evidence/pack-dry-run.log shows 0.2.0 tgz, 10 files, 10.9 kB, zero junk.
- LICENSE: present, MIT, matches package metadata. Versions: package 0.2.0, manifest 0.2.0.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `67a6e546dcd6afe9fb6d64e7d14dab14c448cc44`
<!-- END_GIT_DIFF -->
