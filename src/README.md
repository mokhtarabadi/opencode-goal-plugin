# src — goal plugin core modules

Sibling docs: this file plus `DECISIONS.md` in this directory; the project-wide
decision log is the root `DECISIONS.md`.

## Duties

`src/` holds the whole plugin. `index.ts` is the only host binding; every other
module is pure enough to test without an OpenCode host.

| Module          | Duty                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `index.ts`      | `Plugin.define` entry, slash `/goal` lane, idle event subscription, startup rearm, compaction and context hooks |
| `state.ts`      | `GoalState` shape, per-session path resolution, atomic save, claim lock and lease                               |
| `goal.ts`       | Slash parsing, JSON Schemas, lifecycle transitions, title traversal guard                                       |
| `tools.ts`      | The five agent tools and the lease-guarded mutation paths                                                       |
| `loop.ts`       | One idle tick: gate, claim, send, record; failure classification                                                |
| `watchdog.ts`   | In-memory timers that wake a stalled lane from persisted state                                                  |
| `compaction.ts` | Snapshot before compaction, restore after, abort-set pruning                                                    |
| `evidence.ts`   | Evidence sidecar shape, per-session paths, atomic save                                                          |
| `verifier.ts`   | Completion gate: citations, then declared or observed test proof                                                |
| `proof.ts`      | Executes a recorded proof command under timeout, output cap and cwd pin                                         |
| `limits.ts`     | Turn, wall-time, delay and per-session cooldown budgets                                                         |

## Invariants

1. File state owns truth. Memory is a cache and never a second source.
2. State and evidence are per session at `.opencode/goals/<session-id>.json` and
   `.evidence.json`, sanitized to `[A-Za-z0-9_-]{1,64}` or a `sid-<fnv1a>` hash.
   The legacy `.opencode/goal-state.json` and `.opencode/goal-evidence.json` are
   read fallbacks only; the next scoped write migrates a user forward.
3. Every mutation runs under the claim lock and lease. Completion claims a TTL
   that covers the whole proof budget.
4. Completion reloads the state after proof and refuses to write when the
   objective changed during the pass. A long pass must never clobber a newer
   goal.
5. All current-time access goes through the injected `Clock`. `SystemClock` in
   `state.ts` is the only `Date.now()` call site.
6. `verifyLocal` stays declare-only unless `runTests` is requested; the two
   complete lanes opt in, so observation cannot silently change old callers.
7. Nothing in `src/` throws into the host: host callbacks map failures to a
   reason string.

## Risks

- `loop.ts` and `index.ts` both own idle wiring; a second sender would allow a
  double turn, so both use one `buildIdleDeps`.
- `proof.ts` executes the recorded command with `cwd` set to the project
  directory. That is a starting directory, not a sandbox: a command that changes
  directory can leave it. The bounds are the timeout, the output cap, the command
  cap and the caller's pre-existing shell access.
