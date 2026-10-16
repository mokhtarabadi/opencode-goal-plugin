# opencode-goal-plugin Phase 2
Slash goal sets objective. File state survives compaction. Idle auto-continue sends one prompt per idle tick while the goal stays active and within limits.
Usage: /goal <objective> | /goal status | /goal block <reason> | /goal complete | /goal clear
Kill switch: create `.opencode/STOP_GOAL` to stop the loop immediately.
State: .opencode/goal-state.json with UTC epoch ms.
Build: npm run typecheck, npm test, npm run build.
