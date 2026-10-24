# Task 12: Tool-lane goal_set must clear stale evidence

**File:** `tasks/completed/12-tool-set-clears-stale-evidence.md`
**Status:** closed
**Source:** manager
**Type:** bugfix
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Priority:** High

## Goal

Make `goal_set` reset the session evidence sidecar, so criteria recorded for a previous goal can never gate the next one.

## Problem

The slash lane seeds a fresh empty sidecar on every `/goal <objective>` (`src/index.ts:855-861`), but the tool lane's `toolSet` only saves state (`src/tools.ts:236`). `goal_evidence` appends to whatever the file already holds (`src/tools.ts:474-494`), and the completion gate validates and executes every criterion in it (`src/verifier.ts:184-225`, observation on by default through `tryCompleteWithEvidence`).

Consequence, reproduced live: one session's sidecar accumulated six criteria from three finished goals, one of which recorded `rtk test uv run --project mcp-context-server --with pytest --with pyyaml python -m pytest tests/ -q`. That command now exits 1, so every later `goal_complete` returned `Complete blocked: evidence-invalid` after re-running the historical commands (89s), with no way to see which criterion failed. Duplicate-id rejection (`src/tools.ts:476-478`) also makes a stale entry impossible to correct in place.

## Acceptance Criteria

- [x] `goal_set` writes a fresh empty evidence sidecar for the caller's storage session.
- [x] A criterion recorded for goal A is absent from the sidecar after `goal_set` starts goal B in the same session.
- [x] Completion succeeds for goal B with only goal B's evidence, even when goal A's recorded command fails.
- [x] Slash and tool lanes agree: both reset evidence on set.
- [x] Regression tests cover the stale-criteria path.
- [x] `tsc --noEmit` clean, full suite green, `prettier --check src tests` clean.
- [x] Docs updated: `docs/AGENT-TOOLS.md`, `src/README.md`, root `DECISIONS.md` ADR-012.

## Local TODOs

- [x] Create task file and move to in-progress
- [x] Fix `toolSet` to seed empty evidence under the same storage session
- [x] Add regression tests for stale-criterion removal and completion after a re-set
- [x] Sync docs plus ADR-012 plus CHANGELOG
- [x] Verify, stage, QA, closure

## Execution Log & Reasoning

**Diagnosis (confirmed before any edit).** The installed plugin copy at `~/.cache/opencode/npm/git-opencode-goal-plugin-19cea11cebac/1792709155348/node_modules/opencode-goal-plugin` is byte-identical to local `HEAD` (`24a04b2`) for both `src/tools.ts` and `src/index.ts`, so the live failure reproduces from this source, not from a stale build. The session sidecar under `../../cognitive-lead-hq/.opencode/goals/` held six criteria from three goals; one of them, `task-328-closure`, records `rtk test uv run --project mcp-context-server --with pytest --with pyyaml python -m pytest tests/ -q`, which today exits 1. `goal_complete` re-ran it in observed mode and returned `Complete blocked: evidence-invalid` after 89s measured.

**Root cause.** `toolSet` saved state and nothing else. The slash lane seeds `saveEvidence(projectDir, emptyEvidence(clock.nowMs()), storage)` right after `saveGoalState`; the tool lane did not. `goal_evidence` appends to the sidecar it finds, and `tryCompleteWithEvidence` validates and executes every criterion in it, so criteria outlive the goal that produced them and a finished goal's failing command gates every later goal.

**Fix.** One seed call in `toolSet` after `saveGoalState`, using the same `storage` value already computed for the state path, so scoped and legacy lanes stay aligned with the slash lane. Best-effort by design, matching the slash lane: the goal is already saved, and a failed seed leaves the old criteria rather than undoing the set. Nothing in `evidence.ts`, `verifier.ts`, or `proof.ts` changed, so evidence shape, sole-writer rule, and observed proof semantics are untouched.

**Assumption A1.** The seed is `emptyEvidence(clock.nowMs())`, not a deletion. Deleting would also work, but the two lanes would then differ on disk, and the parity test compares on-disk state. Reason: parity is the invariant the tool lane exists to preserve (ADR-008).

**Assumption A2.** Stale-criterion cleanup is limited to the set lane. `goal_complete` and `goal_clear` are unchanged. Reason: a clear or complete ends a goal but leaves its audit trail; re-set is the point where the criteria stop belonging to anything.

**Known limitation, deliberately out of scope.** `goal_evidence` still rejects a reused id, so correcting a wrong criterion inside the same goal needs a new id. Widening this task would change evidence semantics, which the acceptance criteria exclude. Recorded in ADR-012.

**Test-side consequence.** Four pre-existing tests asserted "no write" as `existsSync(evidencePath) === false`. A seeded empty sidecar makes that file exist, so those assertions now read the criteria array on disk instead, which is the contract they actually guard: no criterion was appended. A shared `readCriteria` helper does the raw read because `loadEvidence` maps an empty sidecar to `null` (`evidence-empty` is a shape failure), so it cannot report the seeded file at all.

**Docs.** `docs/AGENT-TOOLS.md` gained the reset rule under Tool 1 and in hard constraint 1. `src/README.md` gained invariant 7. Root `DECISIONS.md` gained ADR-012 and `src/DECISIONS.md` gained its index row. `CHANGELOG.md` gained one `### Fixed` bullet.

**Deployment note for the Manager.** The running OpenCode process loads the cached GitHub copy of this plugin, not this worktree. The fix reaches the live plugin only after this commit is pushed to `github:mokhtarabadi/opencode-goal-plugin` and OpenCode is restarted.

**Closure authorization.** The Manager pre-authorized closure in the same request that opened this task ("create a task inside the repo and fix the bug and auto approve for closure it"), so the Kanban close ran without a separate review turn. No QA or review verdict is claimed here; the recorded evidence is the command output above.

**Lint note.** `lint_task_file` reports `File path mismatch` for this file because it compares the header literal against the absolute path it resolves. Every task file in this repository, including the closed ones from 01 through 11, uses the same relative `**File:**` header and produces the same single warning, so the header follows repo convention rather than the linter's absolute-path expectation.

**Prettier scope note.** `prettier --check src tests` is the gate and it is clean. The task file itself is not prettier-stable once the injected diff block lands, because diffs of Markdown docs contain triple-backtick lines that end the injected fence; tasks 10 and 11 are in the same state. The file was prettier-clean before injection and its prose was checked again after the final edits by inspection.

## Verification Evidence

- Command: `rtk test ./node_modules/.bin/vitest run tests/tools.test.ts` | Expected: all tools tests pass | Actual: 36 passed (33 existing plus 3 new) | Exit: 0.
- Command: `rtk test npm test` | Expected: full suite green | Actual: 17 files, 175 tests passed | Exit: 0.
- Command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: no output, exit 0 | Exit: 0.
- Command: `./node_modules/.bin/prettier --check src tests` | Expected: clean | Actual: all matched files use Prettier code style | Exit: 0.
- Command: `npx prettier --check docs/AGENT-TOOLS.md DECISIONS.md CHANGELOG.md src/README.md src/DECISIONS.md` | Expected: clean | Actual: all matched files use Prettier code style | Exit: 0.

Regression coverage added in `tests/tools.test.ts` under `goal_set clears stale evidence`:

1. `drops criteria recorded for the previous goal` — records a criterion whose command exits 1, re-sets the goal, asserts the criteria list is empty on disk, then reuses the freed id successfully.
2. `completes a new goal even when the old goal recorded a failing command` — the exact live failure: old goal records an exit-1 command, new goal records an exit-0 command, `goal_complete` returns `Goal marked complete.`
3. `slash set and tool set leave the same evidence state` — both lanes leave an empty criteria list.

## Risk & Rollback

- Risk: a `goal_set` that replaces an active goal now also discards its recorded evidence. That is the intended contract and matches the slash lane; a caller that wants the proof keeps it by not re-setting.
- Risk: the seed write is best-effort, so a failed write leaves the old criteria. Same failure mode as the slash lane; the verifier still fails closed rather than passing on missing proof.
- Rollback: delete the seed block in `toolSet`; state behavior is untouched and the slash lane is unaffected.

## Factual Git Diff

- Injected below via `custom_context_stage_and_inject_diff`.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index bd64f1e..c2451e8 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -34,6 +34,7 @@ All notable changes follow Keep a Changelog.
 - Observed test proof: `goal_complete` now executes every recorded test command in the project directory under a 300s per-command and 600s per-pass budget with a 1 MiB output cap, and requires each to exit 0, so a typed `exitCode` can no longer close a goal; `verifyLocal` keeps declare-only behavior unless observation is requested.
 - Docs sync for the per-session layout across README, AGENTS, AGENT-TOOLS, conventions, commands, gitignore, and ADR-010/ADR-011.
 - Hotfix2 afterSend Clock plus Set copy plus prune helper plus drive-relative guard.
+- Tool-lane `goal_set` now seeds a fresh evidence sidecar like `/goal <objective>`, so criteria recorded for a finished goal no longer accumulate and block later completions with `evidence-invalid`; regression tests cover the stale-criteria path, the old failing command, and slash/tool parity.
 
 ## [0.3.0] - 2026-10-16
 
diff --git a/DECISIONS.md b/DECISIONS.md
index 4df0e43..4d47ae9 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -47,3 +47,7 @@ Context: one shared `.opencode/goal-state.json` meant a goal set in session A wa
 ## ADR-011 2026-10-22 Completion observes test results instead of trusting them
 
 Context: `verifyLocal` accepted the `exitCode` recorded in the evidence sidecar, and that value is written by the agent through `goal_evidence`. The gate rejected empty proof but not false proof: an agent could record `npm test` with `exitCode: 0` without running anything. Decision: add `src/proof.ts` with `runProofCommand`, which executes a recorded command through the platform shell (`/bin/sh` on POSIX, the configured command processor on Windows), started in the project directory after an absolute-path check, with a 300s per-command timeout, a 1 MiB output cap, and a sha256 digest of the captured output for audit. The working directory is a starting point, not a sandbox: absolute paths and `cd` still reach the rest of the machine, and the runner must never receive a command from an untrusted party. `verifyLocal` gains an optional `runTests` mode that executes every non-empty recorded command for a criterion and requires each to exit 0, reporting `test-failed`, `test-timeout`, `test-not-run`, `test-cap`, or `test-budget` distinctly; running only one command would let a trivial pass mask a failing suite. `tryCompleteWithEvidence` enables the mode by default, so both complete lanes observe real results; direct `verifyLocal` callers keep the declare-only behavior. A 20-command cap plus a shared 600s pass deadline bound completion cost, and the slash lane now claims the lease for `PROOF_TOTAL_TIMEOUT_MS + 60000` like the tool lane so a long pass cannot outlive its own guard. Trust boundary: the sidecar is lease-protected runtime state whose only writer is `goal_evidence`, and the calling agent already holds shell access, so executing the recorded command adds no capability; cwd pinning and timeouts bound the blast radius. Consequence: `goal_complete` now runs the project's own tests and can take minutes, and a fabricated exit code can no longer close a goal. Rollback: revert `src/proof.ts`, drop the `runTests` option and its default, and keep declare-only verification with the sidecar unchanged.
+
+## ADR-012 2026-10-24 Setting a goal resets its evidence sidecar
+
+Context: the slash set lane seeded a fresh empty sidecar on every `/goal <objective>`, but the tool lane's `toolSet` only saved state. `goal_evidence` appends to whatever the file already holds, and the completion gate validates plus executes every criterion in it, so criteria recorded for finished goals accumulated in one session sidecar and gated later goals. Reproduced live: a session held six criteria from three goals, one recorded `pytest tests/ -q` that had since started failing, and every `goal_complete` returned `Complete blocked: evidence-invalid` after re-running the historical commands, with no way to see which criterion failed; duplicate-id rejection also made the bad entry impossible to correct in place. Decision: `toolSet` calls `saveEvidence(projectDir, emptyEvidence(clock.nowMs()), storage)` immediately after `saveGoalState`, mirroring `src/index.ts`, as a best-effort write so a failed seed never undoes a saved goal and the gate still fails closed on missing proof. Evidence keeps its existing per-session path, shape validation, sole-writer rule, and observed proof semantics; nothing in `verifier.ts` or `evidence.ts` changes. Consequence: a criterion can never outlive the goal it was recorded for, both set lanes behave identically, and a caller that wants to keep its proof keeps it by not re-setting. Known limitation left open: `goal_evidence` still rejects a reused id, so correcting a wrong criterion inside the same goal requires a new id. Rollback: delete the seed block in `toolSet`; state behavior and the slash lane are unaffected.
diff --git a/docs/AGENT-TOOLS.md b/docs/AGENT-TOOLS.md
index a4a83aa..96ca33e 100644
--- a/docs/AGENT-TOOLS.md
+++ b/docs/AGENT-TOOLS.md
@@ -37,6 +37,11 @@ Success response:
 Goal set to active: Migrate the auth module to the new token format
 ```
 
+**Setting a goal resets its evidence.** `goal_set` writes a fresh empty
+sidecar for your session, exactly as `/goal <objective>` does. Criteria you
+recorded for the previous goal are gone, so they can never gate the new one.
+Record evidence again for the new objective; a stale id is also free to reuse.
+
 ## Tool 2 — goal_block
 
 Park the goal when you are stuck and cannot proceed on your own.
@@ -160,7 +165,9 @@ Report this to the human. Do not invent state.
 
 ## Hard constraints
 
-1. One goal per session. A second `goal_set` in the same session replaces the first.
+1. One goal per session. A second `goal_set` in the same session replaces the
+   first and clears its recorded evidence, because completion checks only ever
+   cover the current goal.
 2. `goal_complete` without evidence always fails. This is deliberate.
 3. Titles and reasons are literal data. Newlines, slashes, and words like
    `block`, `clear`, or `resume` inside them trigger nothing.
diff --git a/src/DECISIONS.md b/src/DECISIONS.md
index 342a517..bc68011 100644
--- a/src/DECISIONS.md
+++ b/src/DECISIONS.md
@@ -19,6 +19,7 @@ reader inside `src/` finds the reasoning without leaving the folder.
 | ADR-009 sole evidence writer                   | `tools.ts`, `evidence.ts`                                    |
 | ADR-010 per-session state with legacy fallback | `state.ts`, `evidence.ts`, `index.ts`, `tools.ts`, `loop.ts` |
 | ADR-011 completion observes test results       | `proof.ts`, `verifier.ts`, `tools.ts`, `index.ts`            |
+| ADR-012 set resets the evidence sidecar        | `tools.ts`, `index.ts`, `evidence.ts`                        |
 
 ## Local notes
 
diff --git a/src/README.md b/src/README.md
index 0d5b00f..eb98dbb 100644
--- a/src/README.md
+++ b/src/README.md
@@ -38,7 +38,10 @@ module is pure enough to test without an OpenCode host.
    `state.ts` is the only `Date.now()` call site.
 6. `verifyLocal` stays declare-only unless `runTests` is requested; the two
    complete lanes opt in, so observation cannot silently change old callers.
-7. Nothing in `src/` throws into the host: host callbacks map failures to a
+7. Both set lanes (slash `/goal <objective>` and the `goal_set` tool) reset the
+   session evidence sidecar. Criteria never outlive the goal they were recorded
+   for, so a finished goal's failing command cannot gate the next one.
+8. Nothing in `src/` throws into the host: host callbacks map failures to a
    reason string.
 
 ## Risks
diff --git a/src/tools.ts b/src/tools.ts
index 04777d9..52542bd 100644
--- a/src/tools.ts
+++ b/src/tools.ts
@@ -271,6 +271,17 @@ async function toolSet(
     } catch (err) {
       return 'Failed to save goal state: ' + (err as Error).message;
     }
+    // Seed a fresh evidence sidecar, exactly as the slash set lane does
+    // (index.ts). Without this reset the session sidecar accumulates criteria
+    // from finished goals, and the verifier runs and validates every one of
+    // them, so a stale failing command blocks completion with evidence-invalid
+    // forever. Best-effort like the slash lane: a failed seed must not undo a
+    // saved goal, and the gate still fails closed on missing proof.
+    try {
+      await saveEvidence(projectDir, emptyEvidence(clock.nowMs()), storage);
+    } catch {
+      // Non-fatal: the goal is set; stale criteria may still gate completion.
+    }
     return 'Goal set to active: ' + next.objective;
   } finally {
     await claim.release();
diff --git a/tests/tools.test.ts b/tests/tools.test.ts
index be52b40..8200c13 100644
--- a/tests/tools.test.ts
+++ b/tests/tools.test.ts
@@ -4,10 +4,11 @@
  * the exact slash handler, so model-driven and user-driven paths cannot drift.
  */
 import { describe, expect, it } from 'vitest';
-import { mkdtempSync } from 'node:fs';
+import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
 import { tmpdir } from 'node:os';
 import * as path from 'node:path';
 import { registerGoalTools } from '../src/tools.js';
+import { resolveEvidencePath } from '../src/evidence.js';
 import {
   BlockInputSchema,
   CompleteInputSchema,
@@ -45,6 +46,21 @@ function fakeCtx(defs: CapturedDef[]): unknown {
   };
 }
 
+/**
+ * Criteria currently on disk for one lane.
+ * Why a raw read instead of loadEvidence: a freshly seeded sidecar holds an
+ * empty list, which shape validation rejects as `evidence-empty`, so
+ * loadEvidence maps it to null and cannot report the file at all.
+ */
+function readCriteria(dir: string, sessionId?: string): unknown[] {
+  const file = resolveEvidencePath(dir, sessionId);
+  if (!existsSync(file)) return [];
+  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
+    criteria?: unknown[];
+  };
+  return parsed.criteria ?? [];
+}
+
 describe('registerGoalTools', () => {
   it('registers five tools beside the slash lane', async () => {
     const defs: CapturedDef[] = [];
@@ -387,8 +403,6 @@ describe('goal_evidence sole writer', () => {
     expect(done.content).toBe('Goal marked complete.');
   });
   it('hostile shape writes nothing', async () => {
-    const { existsSync } = await import('node:fs');
-    const { resolveEvidencePath } = await import('../src/evidence.js');
     const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evbad-'));
     const defs = await toolDefs(dir);
     await byName(defs, 'goal_set').execute({ title: 'baseline' }, {});
@@ -397,7 +411,9 @@ describe('goal_evidence sole writer', () => {
       {},
     );
     expect(bad.content).toContain('Invalid');
-    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+    // goal_set seeds an empty sidecar, so "nothing written" means no criterion
+    // landed, not that the file is absent.
+    expect(readCriteria(dir)).toEqual([]);
   });
   it('duplicate id is rejected with no second write', async () => {
     const { loadEvidence } = await import('../src/evidence.js');
@@ -446,11 +462,9 @@ describe('goal_evidence sole writer', () => {
       { sessionID: 'sess-race' },
     );
     expect(out.content).toMatch(/busy|lease|Busy/i);
-    expect(existsSync(resolveEvidencePath(dir, 'sess-race'))).toBe(false);
+    expect(readCriteria(dir, 'sess-race')).toEqual([]);
   });
   it('blocked goal rejects evidence with no write', async () => {
-    const { existsSync } = await import('node:fs');
-    const { resolveEvidencePath } = await import('../src/evidence.js');
     const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evblk-'));
     const defs = await toolDefs(dir);
     await byName(defs, 'goal_set').execute({ title: 'stuck' }, {});
@@ -465,7 +479,7 @@ describe('goal_evidence sole writer', () => {
       {},
     );
     expect(out.content).toContain('Only an active goal');
-    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+    expect(readCriteria(dir)).toEqual([]);
   });
   it('no goal set reports status with no lease held', async () => {
     const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evnone-'));
@@ -542,8 +556,6 @@ describe('hotfix qa-reject negative paths', () => {
     expect(existsSync(resolveEvidencePath(dir))).toBe(false);
   });
   it('tool rejects empty files or empty tests arrays with no write', async () => {
-    const { existsSync } = await import('node:fs');
-    const { resolveEvidencePath } = await import('../src/evidence.js');
     const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe3-'));
     const defs = await toolDefs(dir);
     await byName(defs, 'goal_set').execute({ title: 'base' }, {});
@@ -557,7 +569,7 @@ describe('hotfix qa-reject negative paths', () => {
       {},
     );
     expect(noTests.content).toContain('Invalid');
-    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+    expect(readCriteria(dir)).toEqual([]);
   });
   it('tool rejects partial bad entries instead of silently dropping', async () => {
     const { loadEvidence } = await import('../src/evidence.js');
@@ -627,3 +639,102 @@ describe('hotfix qa-reject negative paths', () => {
     expect((await loadEvidence(dir))?.criteria.length).toBe(1);
   });
 });
+
+describe('goal_set clears stale evidence', () => {
+  async function toolDefs(dir: string): Promise<CapturedDef[]> {
+    const defs: CapturedDef[] = [];
+    await registerGoalTools(fakeCtx(defs), dir, new FakeClock());
+    return defs;
+  }
+  function byName(defs: CapturedDef[], name: string): CapturedDef {
+    const found = defs.find((d) => d.name === name);
+    if (!found) throw new Error('missing tool ' + name);
+    return found;
+  }
+  it('drops criteria recorded for the previous goal', async () => {
+    const { writeFileSync } = await import('node:fs');
+    const { loadEvidence } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-reset-'));
+    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+    const defs = await toolDefs(dir);
+    const session = { sessionID: 'sess-reset' };
+    await byName(defs, 'goal_set').execute({ title: 'first' }, session);
+    await byName(defs, 'goal_evidence').execute(
+      {
+        id: 'stale',
+        claim: 'first goal proof',
+        files: ['proof.txt'],
+        // A recorded failure: this is the criterion that used to poison the
+        // session sidecar and block every later completion.
+        tests: [{ command: 'node -e "process.exit(1)"', exitCode: 0 }],
+      },
+      session,
+    );
+    expect((await loadEvidence(dir, 'sess-reset'))?.criteria.length).toBe(1);
+
+    await byName(defs, 'goal_set').execute({ title: 'second' }, session);
+
+    const after = readCriteria(dir, 'sess-reset');
+    expect(after).toEqual([]);
+    // The stale id is free again, so a corrected criterion can be recorded.
+    const rec = await byName(defs, 'goal_evidence').execute(
+      {
+        id: 'stale',
+        claim: 'second goal proof',
+        files: ['proof.txt'],
+        tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
+      },
+      session,
+    );
+    expect(rec.content).toContain('Criterion recorded for stale');
+  });
+  it('completes a new goal even when the old goal recorded a failing command', async () => {
+    const { writeFileSync } = await import('node:fs');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-reset2-'));
+    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+    const defs = await toolDefs(dir);
+    const session = { sessionID: 'sess-reset2' };
+    await byName(defs, 'goal_set').execute({ title: 'old goal' }, session);
+    await byName(defs, 'goal_evidence').execute(
+      {
+        id: 'old',
+        claim: 'old proof',
+        files: ['proof.txt'],
+        tests: [{ command: 'node -e "process.exit(1)"', exitCode: 0 }],
+      },
+      session,
+    );
+    await byName(defs, 'goal_set').execute({ title: 'new goal' }, session);
+    await byName(defs, 'goal_evidence').execute(
+      {
+        id: 'new',
+        claim: 'new proof',
+        files: ['proof.txt'],
+        tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
+      },
+      session,
+    );
+    const done = await byName(defs, 'goal_complete').execute({}, session);
+    expect(done.content).toBe('Goal marked complete.');
+  });
+  it('slash set and tool set leave the same evidence state', async () => {
+    const { handleGoalCommand } = await import('../src/index.js');
+    const clock = new FakeClock();
+    const dirTool = mkdtempSync(path.join(tmpdir(), 'goal-tools-resetT-'));
+    const dirSlash = mkdtempSync(path.join(tmpdir(), 'goal-tools-resetS-'));
+    const defs = await toolDefs(dirTool);
+    await byName(defs, 'goal_set').execute(
+      { title: 'parity-reset' },
+      { sessionID: 'sess-parT' },
+    );
+    await handleGoalCommand(
+      '/goal parity-reset',
+      dirSlash,
+      clock,
+      '2.0.29',
+      'sess-parS',
+    );
+    expect(readCriteria(dirTool, 'sess-parT')).toEqual([]);
+    expect(readCriteria(dirSlash, 'sess-parS')).toEqual([]);
+  });
+});
```
<!-- END_GIT_DIFF -->
