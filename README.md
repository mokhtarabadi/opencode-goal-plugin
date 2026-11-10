# opencode-goal-plugin

Slash goal sets one objective and the agent keeps working until it is complete, blocked, or cleared. File state survives compaction. Idle auto-continue sends one prompt per idle tick while the goal stays active and within limits. A new objective is a new goal generation: `/goal <objective>` restarts the turn and wall budgets, while `/goal resume` continues the same one. When a goal finishes, the loop stays quiet until the next objective is set — it never invents one. Two consecutive turns that make no tool call and change no goal state park the loop with one message naming `goal_block <reason>` and `goal_resume`; a `question` tool parks the next tick immediately.

## Install

Local path install in your project `opencode.json` (relative to your project):

```json
{
  "plugins": ["file:../opencode-goal-plugin"]
}
```

After npm publish, use the published name:

```json
{
  "plugins": ["opencode-goal-plugin"]
}
```

Then restart OpenCode. npm install is handled by the host, no global install needed.

## Surface checks (P1-P4)

Same server-only core runs on web, CLI, TUI, and server-only: no TUI imports, no stdin reads. Check each surface with a two-item test goal:

1. `/goal ship test item one` then `/goal status` shows active.
2. Wait for one idle tick: at most one continuation sends.
3. `/goal clear` then `/goal status` shows cleared.
4. Create `.opencode/STOP_GOAL` to pause the loop immediately, delete it to resume.
   Missing host hooks fail closed with a reason and never crash the host.

## Usage

/goal &lt;objective&gt; | /goal status | /goal block &lt;reason&gt; | /goal complete | /goal resume | /goal clear
Agent tools (no slash needed, same guarded lane): `goal_set`, `goal_block`, `goal_complete`, `goal_resume`.
Kill switch: create `.opencode/STOP_GOAL` to stop the loop immediately.
Completion: `/goal complete` needs evidence in the session evidence sidecar (`.opencode/goals/<session-id>.evidence.json`) with file citations plus passing test proof. A citation that legitimately moved inside the project (a Kanban lane promotion, a rename) still proves: the verifier tries the exact path first, then a unique basename hit, and reports which path answered it; two same-named files fail as `ambiguous-citation` naming both, and a citation with no match at all stays `missing-file`. The recorded test command is executed at completion time, so a declared exit code alone cannot pass the gate, and a blocked completion quotes the verifier's failures so the cause is visible; a test entry may carry an `env` map to pin a toolchain. Compaction-safe: state reloads from file and resumes without double send.
State: `.opencode/goals/<session-id>.json` with UTC epoch ms, one file per session. A legacy `.opencode/goal-state.json` is still read as a fallback and migrates on the next write.
Build: npm run typecheck, npm test, npm run compile.
