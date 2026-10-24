# Goal Plugin — Agent Tool Manual

Reader: you are an AI coding agent running inside OpenCode with the
`opencode-goal-plugin` loaded. This file teaches you the five tools that
**you yourself** can call. It is not for the human operator. The human uses
slash commands (`/goal ...`); you use the tools below. Both lanes write the
same session state file, so they never disagree.

## The one idea

One session has exactly one active goal, stored in
`.opencode/goals/<session-id>.json`. A second session in the same project has
its own file and never sees yours. You move it through a lifecycle:

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

**Setting a goal resets its evidence.** `goal_set` writes a fresh empty
sidecar for your session, exactly as `/goal <objective>` does. Criteria you
recorded for the previous goal are gone, so they can never gate the new one.
Record evidence again for the new objective; a stale id is also free to reuse.

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
**only** if proof exists in your session's evidence sidecar
(`.opencode/goals/<session-id>.evidence.json`) — file citations plus at least
one passing test per criterion. The recorded test commands are then executed,
so a declared exit code alone cannot pass.

```json
{}
```

It takes no arguments. If proof is missing you get:

```text
Complete blocked: <reason>. Add file citations plus passing tests to evidence.
```

Do not retry blindly. Record the evidence first with `goal_evidence`
(do the work that earns it), then call again. Success response:

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

## Tool 5 — goal_evidence

Record proof for the active goal. This is the **sole evidence writer**:
the only way proof ever enters the session evidence sidecar
(`.opencode/goals/<session-id>.evidence.json`). One call
appends one criterion; call it once per criterion you can prove.

```json
{
  "id": "build-pass",
  "claim": "Build passes on a clean tree",
  "files": ["src/index.ts"],
  "tests": [{ "command": "npm test", "exitCode": 0 }]
}
```

Rules: `id` plus `claim` are required (non-empty, id max 200 chars,
claim max 2000), plus at least one `files` entry and one `tests` entry —
the stored sidecar always passes shape validation, so empties are rejected
up front. File existence plus passing status are still checked at
`goal_complete` time, so citations may point at work in progress.
Requires an `active` goal; duplicate `id` values are rejected, so each
criterion is recorded once. Same syntax as `/goal evidence`. Success response:

```text
Criterion recorded for <id>.
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

1. One goal per session. A second `goal_set` in the same session replaces the
   first and clears its recorded evidence, because completion checks only ever
   cover the current goal.
2. `goal_complete` without evidence always fails. This is deliberate.
3. Titles and reasons are literal data. Newlines, slashes, and words like
   `block`, `clear`, or `resume` inside them trigger nothing.
4. All five schemas reject extra properties. Send exactly the fields shown.
5. Never write `.opencode/goals/<session-id>.json` or its `.evidence.json`
   sidecar with file tools. Always go through these five tools (`goal_evidence` is
   the sole evidence writer), so the lease, the validation, and the
   evidence gate stay in force.
6. `goal_evidence` stores the command you send, but `goal_complete` executes
   it and reads the real exit code. A declared `exitCode` is not proof.
