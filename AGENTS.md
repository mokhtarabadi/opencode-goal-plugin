# AGENTS - opencode-goal-plugin
Entry point. Read this first.
Router: read opencode.json, then src/state.ts, src/goal.ts, src/index.ts, then commands/goal.md, then README.md, DECISIONS.md, CHANGELOG.md.
Rules: file state at .opencode/goal-state.json owns truth, memory is cache only. UTC epoch ms at rest, Clock injection only, no direct Date.now in business logic. Phase 2 adds idle auto-continue via src/loop.ts with single-flight plus cooldown plus budgets. Dual ESM plus CJS export via tsup. Task files live in tasks with BEGIN_GIT_DIFF markers. Update CHANGELOG via Parse-Then-Append. Maximum docstrings plus verbose inline comments on all public functions.
