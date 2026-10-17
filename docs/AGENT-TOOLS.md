# Goal Plugin — Agent Tool Manual

Reader: you are an AI coding agent running inside OpenCode with the
`opencode-goal-plugin` loaded. This file teaches you the four tools that
**you yourself** can call. It is not for the human operator. The human uses
slash commands (`/goal ...`); you use the tools below. Both lanes write the
same state file, so they never disagree.

## The one idea

One project has exactly one active goal, stored in
`.opencode/goal-state.json`. You move it through a lifecycle:

`active` → (`goal_block` → `blocked` → `goal_resume` → `active`) → `goal_complete` → `complete`

Call a tool by passing one JSON object matching its schema. Every tool
returns `{ "content": "<one status string>" }`. Read that string — it always
tells you what happened. Tools never throw.

## Tool 1 — goal_set

Set (or replace) the session goal. Use it when you accept a new objective.

```json
{ "title": "Migrate the auth module to the new token format" }
```

Rules for `title`: a non-empty string, 1–2000 characters. Path escapes
(`..`, leading `/`, `C:\...`) are rejected. Reserved words are safe:
a title of `"block foo"` is stored literally and does **not** trigger a
block, because the title is data and is never re-parsed.

Success response:

```text
Goal set to active: Migrate the auth module to the new token format
```

## Tool 2 — goal_block

Park the goal when you are stuck and cannot proceed on your own.

```json
{ "reason": "Waiting on the payments API credentials" }
```

Rules for `reason`: a non-empty string, 1–2000 characters. Requires an
`active` goal; otherwise you get:

```text
Only an active goal can be blocked. Current status: <status>.
```

Success response:

```text
Goal marked blocked: Waiting on the payments API credentials
```

A blocked goal stops the auto-continue loop. Nothing resumes it except
`goal_resume` or the human.

## Tool 3 — goal_complete

Close the goal when the work is done. This tool has a gate: it succeeds
**only** if proof exists in `.opencode/goal-evidence.json` — file citations
plus at least one passing test per criterion.

```json
{}
```

It takes no arguments. If proof is missing you get:

```text
Complete blocked: <reason>. Add file citations plus passing tests to evidence.
```

Do not retry blindly. Write the evidence first (or do the work that earns
it), then call again. Success response:

```text
Goal marked complete.
```

## Tool 4 — goal_resume

Re-activate a parked goal after the blocker is gone.

```json
{}
```

It takes no arguments. Works only from `blocked` or `interrupted` state;
otherwise you get:

```text
Only a parked goal can resume. Current status: <status>.
```

Success response:

```text
Goal resumed: <the objective text>
```

## Responses you must handle

Every tool can also return these. They describe state, not failure of the
tool itself:

```text
No goal set. Use /goal <objective> first.
```

```text
Goal is busy with another turn. Retry shortly.
```

The busy message means the background loop (or a parallel call) holds the
file lease. Wait for your next turn and retry the exact same call. Never
work around it by writing the state file yourself.

```text
Goal state is corrupt at <path>. Back up the file then clear it.
```

Report this to the human. Do not invent state.

## Hard constraints

1. One goal per project. A second `goal_set` replaces the first.
2. `goal_complete` without evidence always fails. This is deliberate.
3. Titles and reasons are literal data. Newlines, slashes, and words like
   `block`, `clear`, or `resume` inside them trigger nothing.
4. All four schemas reject extra properties. Send exactly the fields shown.
5. Never write `.opencode/goal-state.json` or `.opencode/goal-evidence.json`
   with file tools. Always go through these four tools, so the lease,
   the validation, and the evidence gate stay in force.
