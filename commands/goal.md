# goal command

Slash goal sets objective for OpenCode V2 plugin.
Patterns:

- /goal <objective> sets active objective, max 2000 chars
- /goal status shows current state
- /goal block <reason> marks blocked
- /goal complete marks complete (needs evidence)
- /goal evidence id=<short-id> claim=<one-line claim> files=<a,b> tests=<cmd:exitCode> records one evidence criterion (sole evidence writer)
- /goal resume re-activates a parked goal (interrupted or blocked)
- /goal clear marks cleared
  Example: /goal evidence id=build-pass claim=Build passes on a clean tree files=src/index.ts tests=npm test:0
  Idle auto-continue sends one prompt per idle tick. A provider error or a
  failed send re-arms a watchdog so an active goal resumes instead of stalling.

## Agent tools (same lane, no slash needed)

The model can drive the goal itself via five tools sharing the slash helpers:

- `goal_set {title}` same as /goal <objective>
- `goal_block {reason}` same as /goal block <reason>
- `goal_complete {}` same as /goal complete (evidence gate applies)
- `goal_resume {}` same as /goal resume
- `goal_evidence {id, claim, files[], tests[]}` same as /goal evidence (sole evidence writer)
