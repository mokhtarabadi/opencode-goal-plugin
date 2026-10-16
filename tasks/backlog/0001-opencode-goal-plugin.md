# Task 1 — OpenCode V2 Goal Plugin (Phase 0+1 scaffold)

**File:** tasks/backlog/0001-opencode-goal-plugin.md
**Status:** awaiting-plan-approval
**Mode:** autopilot-locked (Brain Autopilot 100% requested; plan gate still requires explicit Approved)
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Host:** opencode v2.0.29

## Goal
/goal sets one objective. Agent auto-continues on session idle until complete/blocked/cleared. Survives compaction. Safety limits stop runaways. Works same on web, CLI, TUI (server-only APIs).

## Seat Check
Domains → seats: plugin contracts → Software Architect; executor loop + duplicate guard → Senior Programmer. Skipped: Designer (no visual decisions phase 0), QA/Reviewer (later). Trigger eval TITLE+BODY: Architect fires on plugin API contract; Programmer fires on race/duplicate-continuation; Designer miss. Cross-disciplinary → 2-seat consult.

## Brainstorm
Brainstorm: not required — reversible scaffold, no published API yet.

## Brain Plan Verdict (task_id 1, 2026-10-16)
Approved plan received from Brain (Architect + Senior Programmer). Selected path: V2-first server-only plugin, file state owns truth, atomic lease single-flight, verifier-backed completion, phase split 0-4.
Refs: goal-loop src/index.ts:15-19 dual {id,server,setup}; goal-loop src/lifecycle.ts claimActivation, src/ports.ts:44-66 HostPort; prevalentWare src/server.ts dual server/setupV2, src/state.ts Goal + atomicWrite, src/tui.ts dual slots; willytop8 src/v2-bridge.js adapter, persistence-lease.js fail-closed; heimoshuiyu src/index.ts:96 serverPlugin + verify subagent; oh-my-goal src/handlers/loop.ts idle + src/goal-store.ts file state.

## Plan Steps (to approve)
1. Scaffold opencode-goal-plugin: package.json, src/index.ts, goal.ts, loop.ts, state.ts, limits.ts, verifier.ts, commands/goal.md, tests, AGENTS/README/CHANGELOG.
2. Confirm V2 hook names on v2.0.29 (command registration, session idle subscribe, context/compaction hooks); fail closed if missing.
3. Phase1 state, Phase2 idle loop + lease, Phase3 compaction + limits + verifier, Phase4 matrix + publish prep.

## Execution Log
- Phase0 research: cloned 5 refs to /tmp/opencode/goal-research + tmp-clones (prevalentWare, heimoshuiyu, willytop8, goal-loop omerdduran, oh-my-goal). 4 parallel discovery reports done.
- Brain plan turn task_id 1 completed. Awaiting Manager Approved (exact word) to route back through Brain for implementation XML.
