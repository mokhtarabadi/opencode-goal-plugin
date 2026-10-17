# opencode-goal-plugin

Slash goal sets one objective and the agent keeps working until it is complete, blocked, or cleared. File state survives compaction. Idle auto-continue sends one prompt per idle tick while the goal stays active and within limits.

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
Completion: `/goal complete` needs evidence in `.opencode/goal-evidence.json` with file citations plus passing test proof. Compaction-safe: state reloads from file and resumes without double send.
State: `.opencode/goal-state.json` with UTC epoch ms.
Build: npm run typecheck, npm test, npm run compile.
