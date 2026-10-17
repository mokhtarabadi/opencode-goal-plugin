# AGENTS - opencode-goal-plugin
Entry point. Read this first before any execution.
Router: read opencode.json, then src/state.ts, src/goal.ts, src/index.ts, then commands/goal.md, then README.md, DECISIONS.md, CHANGELOG.md.
Rules: file state at .opencode/goal-state.json owns truth, memory is cache only. UTC epoch ms at rest, Clock injection only, no direct Date.now in business logic. Phase 2 adds idle auto-continue via src/loop.ts with single-flight plus cooldown plus budgets. Source-first entry (src/index.ts, the host runs TS natively); dist is built only on prepublish via tsup and never committed. Task files live in tasks with BEGIN_GIT_DIFF markers. Update CHANGELOG via Parse-Then-Append. Maximum docstrings plus verbose inline comments on all public functions.

## Mandatory First-Read Rule

You MUST read this AGENTS.md first before any execution. Inside it, route to DESIGN.md, docs/architecture.md, docs/data_model.md, and docs/conventions.md first. Absent-File Policy: DESIGN.md plus docs/architecture.md plus docs/data_model.md do NOT exist in this project, SKIP them gracefully with an explicit note. DO NOT HALT. DO NOT HALLUCINATE their contents. docs/conventions.md MUST exist and be read.

## Core File Locations

- **Global Rules:** `AGENTS.md` (Root)
- **UI/UX Specs:** `DESIGN.md` (Root) — ABSENT per Absent-File Policy, skipped gracefully
- **Conventions:** `docs/conventions.md` (Root docs)
- **Agent Skills:** `.opencode/skills/<skill-name>/SKILL.md` (project contains `.opencode/`, so listed)
- **Active Tasks:** `tasks/backlog/`, `tasks/in-progress/`, `tasks/qa/`, `tasks/completed/`, `tasks/archive/`

## Actionable Guardrails (Do's & Don'ts)

- **Don't** read `context-reports/` markdown files yourself.
  -> **Do** generate them using the MCP server — context reports via `custom_context_read_source_files`, tree reports via `custom_context_create_tree_report` ("create a tree of the project") — and hand the file path to the Manager.
- **Don't** execute Git commands like `git add`, `git commit`, `git checkout`, or `git push` autonomously or try to guess when to stage code.
  -> **Do** execute Git commands ONLY when explicitly instructed by an Orchestrator task block. Otherwise, rely on the `custom_context_stage_and_inject_diff` MCP tool for staging and `custom_context_unstage_files` for index-only unstage.
  -> **Exception:** `git mv` is permitted autonomously for moving task files between Kanban directories (`backlog`, `in-progress`, `qa`, `completed`, `archive`).
- **Don't** guess blindly when facing complex bugs, deadlocks, or silent timeouts.
  -> **Do** utilize the `debug-instrumentation` skill to inject strategic logs and trace the runtime execution path.
- **Don't** write bash scripts without strict mode or mask errors with `2>/dev/null` on data commands.
  -> **Do** follow the Defensive Shell Protocol: `set -euo pipefail`, ban error masking, sidecar isolation for Docker backups. See `docs/conventions.md`.
- **Don't** perform financial mutations without snapshotting the prior state or allow nulls in monetary aggregations.
  -> **Do** follow the Universal Financial Ledger Standard: snapshot-on-write, `$ifNull` precedence, discrepancy alerting, deep config merging. See `docs/conventions.md`.
- **Don't** leave task numbers in visible prompt prose, section headings, or skill instructions.
  -> **Do** keep task-number references in code comments, CHANGELOG entries, task files, history archives, and HTML comments only. See `docs/conventions.md`.
- **Don't** carry over assumptions, partial results, or architectural hypotheses from a previous task.
  -> **Do** flush context and treat every task as contextually independent (Buffer Isolation directive in validation-phase). Flushing covers working execution assumptions only — conversation threads persist under the active session ID until sprint completion.
- **Don't** execute raw, informal, or non-English prompts directly.
  -> **Do** load the `prompt-refactor` skill to translate and expand the intent into an elite English spec first. (Note: If you receive a standard XML task block, skip this and execute normally).
- **Don't** attempt to resolve cross-disciplinary ambiguity within a single persona.
  -> **Do** trigger the Multi-Agent Brainstorming Loop if the Manager explicitly requests brainstorming or a task exhibits cross-disciplinary ambiguity.
- **Don't** silently alter slice architecture or domain invariants without updating the sibling README.md and appending a dated ADR to DECISIONS.md.
  -> **Do** inspect sibling README.md and DECISIONS.md before modifying code, and keep them in sync with implementation changes.

## Task Management & OpenCode Rules

- **Decentralized Task Management:** Agents MUST strictly use decentralized, individual task files in the Kanban directories as their single source of truth.
- **No Monolithic State:** Agents are strictly forbidden from creating `TODO.md` or `STATE.md`.
- **Zero-Autonomous-Commit:** Agents MUST be strictly forbidden from executing Git commands autonomously; they may only run Git commands when explicitly instructed by the Orchestrator. **Exception:** `git mv` is permitted for moving task files between Kanban directories.
- **Mandatory End-Of-Task Sequence:** 1) Update CHANGELOG.md. 2) Write manual reasoning in the task file. 3) Call the `custom_context_stage_and_inject_diff` MCP tool, then `git mv` the task to `tasks/qa/` (NO COMMITS ALLOWED). 4) Synchronize the task file's `**File:**` metadata to the new path and re-run lint + stage at the new path. 5) Notify the Manager. Closing a task file does not close the session thread.
- **UI/UX Enforcement:** Any UI/UX changes MUST enforce the guidelines defined in the project's `DESIGN.md`. DESIGN.md is absent here, so no UI/UX surface applies; server-only plugin.
- **Task-Generator Skill Loading:** Before creating any new task file, you MUST load the `task-generator` skill using the `skill` tool to ensure the correct template format with `<!-- BEGIN_GIT_DIFF -->` / `<!-- END_GIT_DIFF -->` markers.
- **Project Skill Loading:** Before implementing any task, you MUST load every available skill matching the project's tech stack. No stack-skill match exists for this repo (Node TS plugin, no framework marker); log the skip record in Verification Evidence.
- **Complex Debugging:** Agents MUST be instructed not to guess blindly on complex bugs, but instead utilize the `debug-instrumentation` skill.
- **MCP Report Generation:** Generate context reports (`custom_context_read_source_files`) and tree reports (`custom_context_create_tree_report` — "create a tree of the project") via the MCP server and hand the file path to the Manager instead of reading `context-reports/` files inline.
- **Explicit Staging Contract (F5):** The active task's `Execution Log & Reasoning` or `summary_phase` MUST pass a `modified_files` list to `stage_and_inject_diff` — blind `git add -A .` staging is banned.
- **Parallel Index Isolation:** Shared-file round-trip is `custom_context_unstage_files` (index-only unstage) followed by `stage_and_inject_diff` with `skip_add=True`. `git commit`/`git checkout`/`git push` remain forbidden everywhere.
- **Gatekeeper Validation (Halt Protocol):** Evaluate tasks against project rules and HALT with a `⚠️ RULE VIOLATION WARNING` if the Orchestrator provides non-compliant instructions.
- **Context Bootstrapping:** At the start of every task, you MUST call `search_memory` or `list_namespaces` to load any hidden project quirks relevant to your domain before implementing.
- **Buffer Isolation:** Treat every task as contextually independent, preventing cross-task context leakage. Flushing covers working execution assumptions only.
- **Defensive Shell Protocol (DSP):** Bash scripts MUST start with `set -euo pipefail`; `2>/dev/null` is banned on data commands. See `docs/conventions.md`.
- **Universal Financial Ledger Standard:** Financial mutations require snapshot-on-write and `$ifNull` precedence. See `docs/conventions.md`.
- **Lite Mode Protocol:** When eligible (single-file, no security/financial impact, obvious simplicity), the full production line can be bypassed with a `[LITE]` justification in the task's `## Execution Log & Reasoning` section. Escalation to Full Mode is mandatory if hidden complexity is discovered.
- **Deprecated-Section Purge Rule:** `AGENTS.md` and task files across `tasks/` (excluding archive and completed history) MUST NOT contain `## Manager Decisions`, `## Admin Decision`, `Manager Decision`, or `Admin Decision`. Purge any detected section entirely and record the purge.
- **Runtime-State gitignore:** Per-project runtime state MUST be gitignored; deliberate config MUST NOT be gitignored. `.opencode/smart-compact.jsonc` is agent tooling, never runtime state, never gitignored. `tasks/.sessions/` transcript dirs MUST be gitignored when the dir exists.
- **Goal Plugin Runtime State:** `[PROJECT_ROOT]/.opencode/goal-state.json`, `[PROJECT_ROOT]/.opencode/goal-evidence.json`, `[PROJECT_ROOT]/STOP_GOAL`, `[PROJECT_ROOT]/.opencode/STOP_GOAL` are runtime state only and MUST be gitignored. External scratch, never replaces task truth.
- **Living Folder Docs Sibling Inspection:** Inspect sibling README.md and DECISIONS.md before editing code in any component or vertical slice directory, and update them when domain contracts or architectural decisions change.
- **Edit Tool Discipline:** File edits use ONLY native file-editing tools (edit for replacements, file-write tools for new files). Using python, shell, heredoc, `sed -i`, or any script to create or modify files is strictly forbidden. Shell stays read-only for file content (grep, cat, diff, ls, git status). A non-unique anchor must fail loudly, never be forced. Verify every edit with grep/diff. See `docs/conventions.md`.
- **Project Skills Table (local skills):** This project defines no local skills (no `.opencode/skills/` directory; `.opencode/` holds only goal runtime state). On any audit, rescan and rebuild this table if local skills appear.

  | Skill | Trigger | Duty |
  | ----- | ------- | ---- |
  | _(none)_ | No local skill directory exists | Nothing to load; global registry matrix applies |
