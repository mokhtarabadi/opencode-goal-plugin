# Task 13: A seeded empty sidecar must not fall back to the legacy evidence file

**File:** `tasks/completed/13-legacy-evidence-fallback.md`
**Status:** closed
**Source:** manager
**Type:** bugfix
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Priority:** High

## Goal

Make a session's own evidence sidecar authoritative once it exists, so the empty file both set lanes seed is respected and the pre-isolation legacy sidecar can never resurrect the criteria a set just discarded.

## Problem

Task 12 made `goal_set` seed a fresh empty sidecar, matching the slash lane. That seed does not survive the next write on a machine that still has the pre-isolation file `.opencode/goal-evidence.json`.

Chain, reproduced live after installing the task 12 build:

1. `goal_set` writes `.opencode/goals/<sid>.evidence.json` with `criteria: []`.
2. `validateEvidenceShape` rejects an empty list as `evidence-empty`, so `loadEvidence` maps the seeded file to `null`.
3. `loadEvidence` then falls back to the legacy sidecar, which still holds four criteria from finished goals.
4. `recordEvidence` appends the new criterion to that legacy list and writes the union back to the scoped file.

Net effect: `goal_complete` returned `Complete blocked: evidence-invalid` after an 82s proof pass, and the scoped sidecar held the four stale criteria again plus the new one. The fallback exists so a session without its own file can read the legacy one once (ADR-010); it must stop the moment the session has a file, empty or not.

## Acceptance Criteria

- [x] `loadEvidence` treats an existing scoped sidecar as authoritative, including when it is empty or fails shape validation.
- [x] A session with no scoped sidecar still reads the legacy one once.
- [x] The legacy sidecar can no longer re-inject criteria after either set lane seeds a scoped sidecar.
- [x] Regression tests cover the fallback boundary and the full legacy-poisoning chain.
- [x] `tsc --noEmit` clean, full suite green, `prettier --check src tests` clean.
- [x] Docs updated: `src/README.md` invariant, root `DECISIONS.md` ADR-013, `CHANGELOG.md`.

## Local TODOs

- [x] Create the task file in `tasks/in-progress/`
- [x] Guard the legacy fallback on scoped-file existence
- [x] Add the fallback-boundary test plus the end-to-end legacy-poisoning test
- [x] Sync docs, ADR-013, CHANGELOG
- [x] Verify, stage, QA, closure

## Execution Log & Reasoning

**Discovery.** The live scoped sidecar `.opencode/goals/ses_<id>.evidence.json` in the HQ repo held the four criteria that task 12 was supposed to discard (`task-328-closure`, `task-328-tests`, `task-329-impl`, `task-329-suite`) plus the criterion this session recorded. The legacy `.opencode/goal-evidence.json` holds exactly those four, which identifies the source.

**Root cause.** `loadEvidence` reads the scoped path, and on `null` falls back to legacy. It cannot tell "no scoped file" from "scoped file that parses to nothing", because an empty criteria list is a shape failure by design (`validateEvidenceShape` returns `evidence-empty`, which the completion gate wants). So the empty file that both set lanes write is indistinguishable from an absent file, and the legacy fallback undoes the reset.

**Fix.** Presence on disk decides: when the scoped path exists, `loadEvidence` reads it and returns its result (valid file, or `null` for an empty or invalid one) without consulting legacy. A session with no scoped file still migrates from legacy once, which is what ADR-010 promised. This is a smaller change than deleting the legacy file on set, keeps other sessions' legacy data intact, and fixes the slash lane as well, since both lanes share `loadEvidence`.

**Assumption A3.** No deletion of legacy runtime state. Reason: the plugin's own rule forbids file-tool writes to goal state, and a delete is the same class of interference; the read-side guard makes the delete unnecessary.

**Assumption A4.** Closure approval from the earlier instruction ("auto approve for closure it") covers this task, because it is the same bug surfaced on a second path rather than new scope. Recorded here so the Kanban close is auditable.

**Deployment note.** The running plugin still carries the pre-fix `loadEvidence`, so this session's goal stays blocked until the Manager pushes this commit and reinstalls. The installed copy that shipped task 12 was verified to still contain the fallback, which is why the poisoning reproduced after that install.

## Verification Evidence

- Command: `rtk test ./node_modules/.bin/vitest run tests/evidence.test.ts tests/tools.test.ts tests/session-isolation.test.ts` | Expected: all pass | Actual: 3 files, 49 tests passed | Exit: 0.
- Command: `rtk test npm test` | Expected: full suite green | Actual: 17 files, 178 tests passed | Exit: 0.
- Command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: no output | Exit: 0.
- Command: `./node_modules/.bin/prettier --check src tests` | Expected: clean | Actual: all matched files use Prettier code style | Exit: 0.
- Command: `npx prettier --check docs/AGENT-TOOLS.md DECISIONS.md CHANGELOG.md src/README.md src/DECISIONS.md tasks/in-progress/13-legacy-evidence-fallback.md` | Expected: clean | Actual: clean | Exit: 0.

Live reproduction before the fix, recorded for the record: after installing the task 12 build, `goal_set` left `.opencode/goals/<sid>.evidence.json` with `criteria: []`, and the next `goal_evidence` wrote back five criteria (the four legacy ones plus the new one). `goal_complete` then ran an 82s proof pass and returned `Complete blocked: evidence-invalid`.

Regression coverage:

1. `tests/evidence.test.ts` — `reads legacy only until the session owns a file`: legacy readable once for a session with no scoped file, then a seeded empty scoped file returns `null` and the legacy bucket stays untouched for legacy-only readers.
2. `tests/evidence.test.ts` — `a scoped file decides even when it is invalid`: an invalid scoped file fails closed instead of borrowing legacy proof.
3. `tests/tools.test.ts` — `legacy sidecar cannot re-inject stale criteria after a set`: a legacy file holding a failing criterion is present, `goal_set` seeds, one criterion is recorded, the scoped file holds exactly that one, and `goal_complete` returns `Goal marked complete.`

## Risk & Rollback

- Risk: a corrupt scoped sidecar now fails closed instead of borrowing legacy criteria. That matches ADR-010's state rule (corrupt scoped never falls back) and is the safe direction for proof.
- Risk: a session that seeded an empty sidecar and then expected to inherit legacy criteria no longer does. That inheritance is the bug, not a contract.
- Rollback: revert the existence guard in `loadEvidence`; nothing else changes.

## Factual Git Diff

- Injected below via `custom_context_stage_and_inject_diff`.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index c2451e8..9bf6b38 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -35,6 +35,7 @@ All notable changes follow Keep a Changelog.
 - Docs sync for the per-session layout across README, AGENTS, AGENT-TOOLS, conventions, commands, gitignore, and ADR-010/ADR-011.
 - Hotfix2 afterSend Clock plus Set copy plus prune helper plus drive-relative guard.
 - Tool-lane `goal_set` now seeds a fresh evidence sidecar like `/goal <objective>`, so criteria recorded for a finished goal no longer accumulate and block later completions with `evidence-invalid`; regression tests cover the stale-criteria path, the old failing command, and slash/tool parity.
+- Evidence reads stop falling back to the pre-isolation sidecar once the session has its own file, because an empty seeded file used to parse as absent and merge the legacy bucket back in; a session with no scoped file still migrates once.
 
 ## [0.3.0] - 2026-10-16
 
diff --git a/DECISIONS.md b/DECISIONS.md
index 4d47ae9..f609a22 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -51,3 +51,7 @@ Context: `verifyLocal` accepted the `exitCode` recorded in the evidence sidecar,
 ## ADR-012 2026-10-24 Setting a goal resets its evidence sidecar
 
 Context: the slash set lane seeded a fresh empty sidecar on every `/goal <objective>`, but the tool lane's `toolSet` only saved state. `goal_evidence` appends to whatever the file already holds, and the completion gate validates plus executes every criterion in it, so criteria recorded for finished goals accumulated in one session sidecar and gated later goals. Reproduced live: a session held six criteria from three goals, one recorded `pytest tests/ -q` that had since started failing, and every `goal_complete` returned `Complete blocked: evidence-invalid` after re-running the historical commands, with no way to see which criterion failed; duplicate-id rejection also made the bad entry impossible to correct in place. Decision: `toolSet` calls `saveEvidence(projectDir, emptyEvidence(clock.nowMs()), storage)` immediately after `saveGoalState`, mirroring `src/index.ts`, as a best-effort write so a failed seed never undoes a saved goal and the gate still fails closed on missing proof. Evidence keeps its existing per-session path, shape validation, sole-writer rule, and observed proof semantics; nothing in `verifier.ts` or `evidence.ts` changes. Consequence: a criterion can never outlive the goal it was recorded for, both set lanes behave identically, and a caller that wants to keep its proof keeps it by not re-setting. Known limitation left open: `goal_evidence` still rejects a reused id, so correcting a wrong criterion inside the same goal requires a new id. Rollback: delete the seed block in `toolSet`; state behavior and the slash lane are unaffected.
+
+## ADR-013 2026-10-24 A session's own evidence file ends the legacy fallback
+
+Context: ADR-012 made both set lanes seed an empty scoped evidence sidecar. On a machine that still had the pre-isolation `.opencode/goal-evidence.json`, that seed was undone on the very next write: an empty criteria list fails shape validation (`evidence-empty`), `loadEvidence` mapped the seeded file to `null`, and the legacy fallback then returned the old bucket, so `recordEvidence` merged four criteria from finished goals into the new sidecar and `goal_complete` blocked with `evidence-invalid` after an 82s proof pass. The fallback itself is correct for a session that has not migrated yet; what was wrong is that it could not tell an absent file from an empty one. Decision: `loadEvidence` checks whether the scoped path exists on disk and, when it does, reads it and returns that result without consulting the legacy path, including the `null` result an empty or invalid file produces. A session with no scoped file keeps the one-time legacy read. Deleting the legacy file on set was rejected: it would reach into runtime state the plugin only ever mutates through its own writers, and it would drop another session's not-yet-migrated evidence. Consequence: the legacy bucket can never resurrect criteria a set discarded, both lanes get the fix from the shared reader, other sessions' legacy data is preserved, and a corrupt scoped sidecar now fails closed instead of borrowing legacy proof, which matches the state rule in ADR-010. Rollback: restore the previous `loadEvidence` body, which falls back whenever the scoped read returns null.
diff --git a/src/DECISIONS.md b/src/DECISIONS.md
index bc68011..85ff238 100644
--- a/src/DECISIONS.md
+++ b/src/DECISIONS.md
@@ -6,20 +6,21 @@ is the root `DECISIONS.md`.
 This file only indexes which root decision record governs which module, so a
 reader inside `src/` finds the reasoning without leaving the folder.
 
-| Decision                                       | Governs                                                      |
-| ---------------------------------------------- | ------------------------------------------------------------ |
-| ADR-001 file state owns truth                  | `state.ts`, `index.ts`                                       |
-| ADR-002 claim-lock file serializes claimants   | `state.ts`                                                   |
-| ADR-003 idle single-flight plus cooldown       | `loop.ts`, `limits.ts`                                       |
-| ADR-004 compaction restore plus evidence gate  | `compaction.ts`, `evidence.ts`, `verifier.ts`                |
-| ADR-005 host-native V2 export shape            | `index.ts`                                                   |
-| ADR-006 hardening without contract break       | `state.ts`, `index.ts`, `loop.ts`                            |
-| ADR-007 crash and error recovery               | `loop.ts`, `watchdog.ts`, `index.ts`                         |
-| ADR-008 agent-callable goal tools              | `tools.ts`                                                   |
-| ADR-009 sole evidence writer                   | `tools.ts`, `evidence.ts`                                    |
-| ADR-010 per-session state with legacy fallback | `state.ts`, `evidence.ts`, `index.ts`, `tools.ts`, `loop.ts` |
-| ADR-011 completion observes test results       | `proof.ts`, `verifier.ts`, `tools.ts`, `index.ts`            |
-| ADR-012 set resets the evidence sidecar        | `tools.ts`, `index.ts`, `evidence.ts`                        |
+| Decision                                         | Governs                                                      |
+| ------------------------------------------------ | ------------------------------------------------------------ |
+| ADR-001 file state owns truth                    | `state.ts`, `index.ts`                                       |
+| ADR-002 claim-lock file serializes claimants     | `state.ts`                                                   |
+| ADR-003 idle single-flight plus cooldown         | `loop.ts`, `limits.ts`                                       |
+| ADR-004 compaction restore plus evidence gate    | `compaction.ts`, `evidence.ts`, `verifier.ts`                |
+| ADR-005 host-native V2 export shape              | `index.ts`                                                   |
+| ADR-006 hardening without contract break         | `state.ts`, `index.ts`, `loop.ts`                            |
+| ADR-007 crash and error recovery                 | `loop.ts`, `watchdog.ts`, `index.ts`                         |
+| ADR-008 agent-callable goal tools                | `tools.ts`                                                   |
+| ADR-009 sole evidence writer                     | `tools.ts`, `evidence.ts`                                    |
+| ADR-010 per-session state with legacy fallback   | `state.ts`, `evidence.ts`, `index.ts`, `tools.ts`, `loop.ts` |
+| ADR-011 completion observes test results         | `proof.ts`, `verifier.ts`, `tools.ts`, `index.ts`            |
+| ADR-012 set resets the evidence sidecar          | `tools.ts`, `index.ts`, `evidence.ts`                        |
+| ADR-013 scoped evidence ends the legacy fallback | `evidence.ts`, `tools.ts`, `index.ts`                        |
 
 ## Local notes
 
diff --git a/src/README.md b/src/README.md
index eb98dbb..2140659 100644
--- a/src/README.md
+++ b/src/README.md
@@ -28,7 +28,9 @@ module is pure enough to test without an OpenCode host.
 2. State and evidence are per session at `.opencode/goals/<session-id>.json` and
    `.evidence.json`, sanitized to `[A-Za-z0-9_-]{1,64}` or a `sid-<fnv1a>` hash.
    The legacy `.opencode/goal-state.json` and `.opencode/goal-evidence.json` are
-   read fallbacks only; the next scoped write migrates a user forward.
+   read fallbacks only, and only until the session owns its own file: once the
+   scoped path exists it is authoritative, empty or invalid included, so a seeded
+   empty sidecar cannot pull stale criteria back from the legacy bucket.
 3. Every mutation runs under the claim lock and lease. Completion claims a TTL
    that covers the whole proof budget.
 4. Completion reloads the state after proof and refuses to write when the
@@ -41,7 +43,10 @@ module is pure enough to test without an OpenCode host.
 7. Both set lanes (slash `/goal <objective>` and the `goal_set` tool) reset the
    session evidence sidecar. Criteria never outlive the goal they were recorded
    for, so a finished goal's failing command cannot gate the next one.
-8. Nothing in `src/` throws into the host: host callbacks map failures to a
+8. The legacy evidence sidecar is a read fallback only until the session has its
+   own file. Presence, not a successful parse, ends the fallback: an empty seed
+   must stay empty instead of merging the old bucket back in.
+9. Nothing in `src/` throws into the host: host callbacks map failures to a
    reason string.
 
 ## Risks
diff --git a/src/evidence.ts b/src/evidence.ts
index 6266a8b..a1e4ded 100644
--- a/src/evidence.ts
+++ b/src/evidence.ts
@@ -119,9 +119,28 @@ export function hashEvidence(ev: GoalEvidenceFile): string {
   return createHash('sha256').update(raw).digest('hex').slice(0, 16);
 }
 
+/**
+ * True when a path exists on disk, used to tell an absent scoped file from a
+ * present-but-empty one. Any error other than success counts as absent, which
+ * keeps a permission failure on the legacy path rather than a hard throw.
+ * @param p absolute path
+ */
+async function existsAt(p: string): Promise<boolean> {
+  try {
+    await fs.access(p);
+    return true;
+  } catch {
+    return false;
+  }
+}
+
 /**
  * Load evidence sidecar, returning null when absent or invalid.
  * Scoped first with legacy fallback so old sidecars migrate on next write.
+ * A scoped file that exists is authoritative even when it is empty or invalid:
+ * both set lanes seed an empty file to discard criteria from finished goals,
+ * and that file fails shape validation by design, so falling back on null would
+ * resurrect exactly the criteria the set removed.
  * @param projectDir absolute project root
  * @param sessionId optional session lane id; empty or missing means legacy
  */
@@ -147,8 +166,9 @@ export async function loadEvidence(
     }
   };
   if (scoped === legacy || t.length === 0) return readOne(legacy);
-  const hit = await readOne(scoped);
-  if (hit !== null) return hit;
+  // Presence decides, not the parse result: a session that has its own file has
+  // migrated and never reads the shared legacy bucket again.
+  if (await existsAt(scoped)) return readOne(scoped);
   return readOne(legacy);
 }
 
diff --git a/tests/evidence.test.ts b/tests/evidence.test.ts
index 3b00aca..77c29ef 100644
--- a/tests/evidence.test.ts
+++ b/tests/evidence.test.ts
@@ -3,10 +3,15 @@
  * Why these tests exist: lock the proof contract for completion.
  */
 import { describe, it, expect } from 'vitest';
+import { mkdtempSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import * as path from 'node:path';
 import {
   validateEvidenceShape,
   hashEvidence,
   emptyEvidence,
+  loadEvidence,
+  saveEvidence,
 } from '../src/evidence.js';
 
 describe('evidence schema', () => {
@@ -34,3 +39,45 @@ describe('evidence schema', () => {
     expect(validateEvidenceShape({ version: 2, criteria: [] }).ok).toBe(false);
   });
 });
+
+describe('evidence legacy fallback boundary', () => {
+  /** One criterion, enough to pass shape validation. */
+  function stale() {
+    return {
+      version: 1 as const,
+      updatedAtMs: 1700000000000,
+      criteria: [
+        {
+          id: 'stale',
+          claim: 'from a finished goal',
+          files: ['src/index.ts'],
+          tests: [{ command: 'node -e "process.exit(1)"', exitCode: 1 }],
+        },
+      ],
+    };
+  }
+
+  it('reads legacy only until the session owns a file', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-ev-fallback-'));
+    // No scoped file: the pre-isolation sidecar is readable once.
+    await saveEvidence(dir, stale());
+    expect((await loadEvidence(dir, 'sess-x'))?.criteria.length).toBe(1);
+    // The set lane seeds an empty scoped file: from here it is authoritative.
+    await saveEvidence(dir, emptyEvidence(1700000001000), 'sess-x');
+    expect(await loadEvidence(dir, 'sess-x')).toBeNull();
+    // The legacy bucket is untouched, so a legacy-only reader still sees it.
+    expect((await loadEvidence(dir))?.criteria.length).toBe(1);
+  });
+
+  it('a scoped file decides even when it is invalid', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-ev-fallback2-'));
+    await saveEvidence(dir, stale());
+    // Corrupt scoped file: fail closed instead of borrowing legacy proof.
+    await saveEvidence(
+      dir,
+      { version: 1, updatedAtMs: 1, criteria: [] } as never,
+      'sess-y',
+    );
+    expect(await loadEvidence(dir, 'sess-y')).toBeNull();
+  });
+});
diff --git a/tests/tools.test.ts b/tests/tools.test.ts
index 8200c13..71f41a2 100644
--- a/tests/tools.test.ts
+++ b/tests/tools.test.ts
@@ -737,4 +737,40 @@ describe('goal_set clears stale evidence', () => {
     expect(readCriteria(dirTool, 'sess-parT')).toEqual([]);
     expect(readCriteria(dirSlash, 'sess-parS')).toEqual([]);
   });
+  it('legacy sidecar cannot re-inject stale criteria after a set', async () => {
+    const { writeFileSync } = await import('node:fs');
+    const { saveEvidence } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-legacy-'));
+    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+    // Pre-isolation sidecar from an older version: one failing criterion.
+    await saveEvidence(dir, {
+      version: 1,
+      updatedAtMs: 1700000000000,
+      criteria: [
+        {
+          id: 'ancient',
+          claim: 'finished goal proof',
+          files: ['proof.txt'],
+          tests: [{ command: 'node -e "process.exit(1)"', exitCode: 1 }],
+        },
+      ],
+    });
+    const defs = await toolDefs(dir);
+    const session = { sessionID: 'sess-legacy' };
+    await byName(defs, 'goal_set').execute({ title: 'fresh goal' }, session);
+    await byName(defs, 'goal_evidence').execute(
+      {
+        id: 'fresh',
+        claim: 'fresh proof',
+        files: ['proof.txt'],
+        tests: [{ command: 'node -e "process.exit(0)"', exitCode: 0 }],
+      },
+      session,
+    );
+    // Only the new criterion lands; the legacy list is not merged back in.
+    expect(readCriteria(dir, 'sess-legacy')).toHaveLength(1);
+    expect(readCriteria(dir, 'sess-legacy')[0]).toMatchObject({ id: 'fresh' });
+    const done = await byName(defs, 'goal_complete').execute({}, session);
+    expect(done.content).toBe('Goal marked complete.');
+  });
 });
```
<!-- END_GIT_DIFF -->
