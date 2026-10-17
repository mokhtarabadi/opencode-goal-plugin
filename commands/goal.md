# goal command
Slash goal sets objective for OpenCode V2 plugin.
Patterns:
- /goal <objective> sets active objective, max 2000 chars
- /goal status shows current state
- /goal block <reason> marks blocked
- /goal complete marks complete (needs evidence)
- /goal resume re-activates a parked goal (interrupted or blocked)
- /goal clear marks cleared
Idle auto-continue sends one prompt per idle tick. A provider error or a
failed send re-arms a watchdog so an active goal resumes instead of stalling.
