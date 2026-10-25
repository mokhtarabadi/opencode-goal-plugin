# Task 14: A blocked completion must name what failed, and a proof command must be able to carry its own environment

**File:** `tasks/qa/14-blocked-message-and-test-env.md`
**Status:** in-progress
**Source:** manager
**Type:** bugfix
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Priority:** High

## Goal

Make `Complete blocked:` actionable by quoting the verifier's concrete failures, and let a recorded proof command pin the environment it needs so a toolchain mismatch stops masquerading as a real test failure.

## Problem

Reproduced live while closing a task in another project: `goal_complete` returned

```text
Complete blocked: evidence-invalid. Add file citations plus passing tests to evidence.
```

The citations were correct. The recorded command was `mvn -B test -Dtest=...`, the host process ran JDK 17, and the project needs 21, so the command exited non-zero. `verifyLocal` produced the exact reason (`test-failed:<id>:exit=1`), `tryCompleteWithEvidence` passed it through in `failures`, and both completion lanes then discarded the array and printed one canned sentence (`src/tools.ts`, `src/index.ts`). ADR-012 already recorded this cost as a known limitation: "no way to see which criterion failed".

Second gap: a proof command can only inherit `process.env` plus the plugin's hygiene variables, so a project that needs a specific toolchain has to smuggle it into the command string.

## Acceptance Criteria

- [x] A blocked completion quotes the verifier's failures, bounded, for both the tool lane and the slash lane.
- [x] An evidence test may carry an optional `env` map of string values, merged over the host environment for that command only.
- [x] Shape validation rejects a non-object `env` and a non-string value, so a silent coercion cannot happen.
- [x] Tests cover the message contract, the env merge, and a real non-zero exit still reporting `test-failed`.
- [x] `npm run typecheck`, `npm test`, and `prettier --check src tests` are clean.
- [x] Docs updated: `docs/AGENT-TOOLS.md`, root `DECISIONS.md` ADR-014, `CHANGELOG.md`.

## Local TODOs

- [x] Create the task file
- [x] Quote failures in both completion lanes through one shared helper
- [x] Add the optional per-test `env` to the schema, the verifier, and the runner
- [x] Add tests for the message contract and the env merge
- [x] Sync docs and CHANGELOG
- [x] Verify, stage, QA

## Execution Log & Reasoning

**Design.** One shared helper, `describeVerificationFailure(reason, failures)`, lives in `src/verifier.ts` next to the code that produces those failures, and both lanes call it. Putting the phrasing in the two callers would have re-created the bug the moment a third lane appeared. The helper bounds the quote at five entries and appends `(+N more)` so a padded sidecar cannot flood the tool reply, and it falls back to the previous generic sentence only when the verifier genuinely produced no failure string.

**Environment.** `EvidenceTestProof` gains an optional `env`. Validation accepts only a flat string map — a number would be stringified by the shell and silently change the command — and `runProofCommand` merges it last, after the hygiene variables, so a recorded command wins over the host. The merge is per command, never global: one criterion pinning a JDK cannot leak into another criterion's proof.

**Verification.** `npm run typecheck` clean, `npm test` 187 passed across 18 files, including 9 new tests in `tests/completion-message.test.ts`: the message quotes `test-failed:e1:exit=1` instead of the canned line, the cap reports `(+3 more)`, the fallback still exists for an empty failure list, a valid env map passes shape validation, a numeric value is rejected as `test-env-not-string`, an array `env` is rejected as `test-env-not-object`, a command passes only because its `env` arrived, a second criterion proves the env does not leak across criteria, and a real `exit 3` still reports `test-failed:e1:exit=3`.

**QA cycle.** Brain QA returned `QA_PASSED` with two non-blocking gaps (no non-object env case, no leak check); both are now covered by the two tests above.

**Code Reviewer cycle.** Verdict `APPROVED` with three deferrable notes, all taken: the `verifier-error` catch in both lanes now goes through the same helper (`describeVerificationFailure('verifier-error', [])`) so there is exactly one message builder, and the evidence shape guard rejects an array test entry explicitly instead of relying on `typeof`. Re-verified after those edits: `tsc --noEmit` clean, `npm test` 187 passed, `prettier --check` clean.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 9bf6b38..0e47c38 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -6,6 +6,8 @@ All notable changes follow Keep a Changelog.
 
 ### Added
 
+- A blocked `goal_complete` now names what failed: `describeVerificationFailure` quotes the verifier's concrete reasons (`test-failed:<id>:exit=N`, `missing-file:<id>:<path>`, `test-budget:<id>`) for both the tool and slash lanes, capped at five with `(+N more)`, instead of one canned sentence that told the agent to add citations even when the citations were fine. Reproduced live on a JDK-mismatch proof run. Evidence tests may now carry an optional flat `env` string map, validated as strings and merged into the child environment last, so a project can pin the toolchain its command actually needs. 9 new tests (including a no-leak-across-criteria check); full suite 187 green.
+
 - Evidence traversal guard rejecting dot-dot escapes.
 - Subagent dispatch tests for pass, fail, and throw paths.
 - MIT LICENSE plus install docs for all four surfaces.
diff --git a/DECISIONS.md b/DECISIONS.md
index f609a22..87b6151 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -52,6 +52,14 @@ Context: `verifyLocal` accepted the `exitCode` recorded in the evidence sidecar,
 
 Context: the slash set lane seeded a fresh empty sidecar on every `/goal <objective>`, but the tool lane's `toolSet` only saved state. `goal_evidence` appends to whatever the file already holds, and the completion gate validates plus executes every criterion in it, so criteria recorded for finished goals accumulated in one session sidecar and gated later goals. Reproduced live: a session held six criteria from three goals, one recorded `pytest tests/ -q` that had since started failing, and every `goal_complete` returned `Complete blocked: evidence-invalid` after re-running the historical commands, with no way to see which criterion failed; duplicate-id rejection also made the bad entry impossible to correct in place. Decision: `toolSet` calls `saveEvidence(projectDir, emptyEvidence(clock.nowMs()), storage)` immediately after `saveGoalState`, mirroring `src/index.ts`, as a best-effort write so a failed seed never undoes a saved goal and the gate still fails closed on missing proof. Evidence keeps its existing per-session path, shape validation, sole-writer rule, and observed proof semantics; nothing in `verifier.ts` or `evidence.ts` changes. Consequence: a criterion can never outlive the goal it was recorded for, both set lanes behave identically, and a caller that wants to keep its proof keeps it by not re-setting. Known limitation left open: `goal_evidence` still rejects a reused id, so correcting a wrong criterion inside the same goal requires a new id. Rollback: delete the seed block in `toolSet`; state behavior and the slash lane are unaffected.
 
+## ADR-014 2026-10-25 A blocked completion quotes its failures, and a proof command may carry its own env
+
+Context: a real `goal_complete` blocked with `evidence-invalid. Add file citations plus passing tests to evidence` while the citations were correct and the recorded `mvn` command had failed only because the host ran JDK 17 instead of 21. `verifyLocal` had produced `test-failed:<id>:exit=1`, `tryCompleteWithEvidence` had passed it in `failures`, and both lanes threw the array away and printed one canned sentence — the same blind spot ADR-012 recorded as a known limitation. A proof command could also only inherit `process.env`, so a project needing a specific toolchain had to smuggle it into the command string.
+
+Decision: one shared helper `describeVerificationFailure(reason, failures)` in `src/verifier.ts` builds the blocked message for both the tool lane and the slash lane; it quotes up to five failures and appends `(+N more)`, and keeps the generic sentence only when the verifier produced none. `EvidenceTestProof` gains an optional flat `env` string map, validated as strings only (a number would be stringified by the shell and silently change the command) and merged into the child environment last, after the hygiene variables, per command rather than globally.
+
+Consequence: a block now says which criterion failed and how, so the agent fixes the cause instead of guessing; a toolchain pin travels with the proof that needs it and cannot leak into another criterion. Rollback: restore the two canned strings and drop the `env` field, its validation and the merge.
+
 ## ADR-013 2026-10-24 A session's own evidence file ends the legacy fallback
 
 Context: ADR-012 made both set lanes seed an empty scoped evidence sidecar. On a machine that still had the pre-isolation `.opencode/goal-evidence.json`, that seed was undone on the very next write: an empty criteria list fails shape validation (`evidence-empty`), `loadEvidence` mapped the seeded file to `null`, and the legacy fallback then returned the old bucket, so `recordEvidence` merged four criteria from finished goals into the new sidecar and `goal_complete` blocked with `evidence-invalid` after an 82s proof pass. The fallback itself is correct for a session that has not migrated yet; what was wrong is that it could not tell an absent file from an empty one. Decision: `loadEvidence` checks whether the scoped path exists on disk and, when it does, reads it and returns that result without consulting the legacy path, including the `null` result an empty or invalid file produces. A session with no scoped file keeps the one-time legacy read. Deleting the legacy file on set was rejected: it would reach into runtime state the plugin only ever mutates through its own writers, and it would drop another session's not-yet-migrated evidence. Consequence: the legacy bucket can never resurrect criteria a set discarded, both lanes get the fix from the shared reader, other sessions' legacy data is preserved, and a corrupt scoped sidecar now fails closed instead of borrowing legacy proof, which matches the state rule in ADR-010. Rollback: restore the previous `loadEvidence` body, which falls back whenever the scoped read returns null.
diff --git a/README.md b/README.md
index 1db5616..db31bc5 100644
--- a/README.md
+++ b/README.md
@@ -37,6 +37,6 @@ Same server-only core runs on web, CLI, TUI, and server-only: no TUI imports, no
 /goal &lt;objective&gt; | /goal status | /goal block &lt;reason&gt; | /goal complete | /goal resume | /goal clear
 Agent tools (no slash needed, same guarded lane): `goal_set`, `goal_block`, `goal_complete`, `goal_resume`.
 Kill switch: create `.opencode/STOP_GOAL` to stop the loop immediately.
-Completion: `/goal complete` needs evidence in the session evidence sidecar (`.opencode/goals/<session-id>.evidence.json`) with file citations plus passing test proof. The recorded test command is executed at completion time, so a declared exit code alone cannot pass the gate. Compaction-safe: state reloads from file and resumes without double send.
+Completion: `/goal complete` needs evidence in the session evidence sidecar (`.opencode/goals/<session-id>.evidence.json`) with file citations plus passing test proof. The recorded test command is executed at completion time, so a declared exit code alone cannot pass the gate, and a blocked completion quotes the verifier's failures so the cause is visible; a test entry may carry an `env` map to pin a toolchain. Compaction-safe: state reloads from file and resumes without double send.
 State: `.opencode/goals/<session-id>.json` with UTC epoch ms, one file per session. A legacy `.opencode/goal-state.json` is still read as a fallback and migrates on the next write.
 Build: npm run typecheck, npm test, npm run compile.
diff --git a/docs/AGENT-TOOLS.md b/docs/AGENT-TOOLS.md
index 96ca33e..8ad44a5 100644
--- a/docs/AGENT-TOOLS.md
+++ b/docs/AGENT-TOOLS.md
@@ -128,6 +128,26 @@ appends one criterion; call it once per criterion you can prove.
 }
 ```
 
+A test entry may also carry an optional `env` map of string values. It is
+merged over the host environment for that command only, which is how a project
+pins a toolchain it needs (a specific JDK, an SDK path) instead of wrapping the
+command in a shell prefix:
+
+```json
+{
+  "id": "jvm-tests",
+  "claim": "The JVM suite passes under JDK 21",
+  "files": ["src/main/java/com/apex/engine/PayoutCliService.java"],
+  "tests": [
+    {
+      "command": "mvn -B test -Dtest=PayoutCliServiceTest",
+      "exitCode": 0,
+      "env": { "JAVA_HOME": "/opt/jdk-21" }
+    }
+  ]
+}
+```
+
 Rules: `id` plus `claim` are required (non-empty, id max 200 chars,
 claim max 2000), plus at least one `files` entry and one `tests` entry —
 the stored sidecar always passes shape validation, so empties are rejected
@@ -178,3 +198,8 @@ Report this to the human. Do not invent state.
    evidence gate stay in force.
 6. `goal_evidence` stores the command you send, but `goal_complete` executes
    it and reads the real exit code. A declared `exitCode` is not proof.
+7. A blocked `goal_complete` names what failed. The reply quotes the verifier's
+   concrete reasons — `test-failed:<id>:exit=N`, `missing-file:<id>:<path>`,
+   `test-budget:<id>` — up to five of them, so you can fix the actual cause
+   instead of guessing. When a command fails only because of its environment,
+   give it that environment through the test's `env` map.
diff --git a/src/evidence.ts b/src/evidence.ts
index a1e4ded..d29c94e 100644
--- a/src/evidence.ts
+++ b/src/evidence.ts
@@ -22,6 +22,15 @@ export interface EvidenceTestProof {
   command: string;
   exitCode: number;
   output?: string;
+  /**
+   * Optional environment overrides for this command.
+   * Why it exists: a project may need a specific toolchain (a JDK, an SDK path)
+   * that the host process does not carry, and a proof command that fails only
+   * because of the environment looks exactly like a real failure. Keys are
+   * merged over the process environment, so the agent can pin what the command
+   * actually needs instead of wrapping it in a shell prefix.
+   */
+  env?: Record<string, string>;
 }
 
 /** One completion criterion with file citations plus test proof. */
@@ -106,6 +115,20 @@ export function validateEvidenceShape(ev: unknown): {
       return { ok: false, reason: 'criterion-missing-files' };
     if (!Array.isArray(c['tests']) || (c['tests'] as unknown[]).length === 0)
       return { ok: false, reason: 'criterion-missing-tests' };
+    // Optional env: when present it must be a flat string map, because a nested
+    // value would be stringified by the shell and silently change the command.
+    for (const t of c['tests'] as unknown[]) {
+      if (t === null || typeof t !== 'object')
+        return { ok: false, reason: 'test-not-object' };
+      const env = (t as Record<string, unknown>)['env'];
+      if (env === undefined) continue;
+      if (env === null || typeof env !== 'object' || Array.isArray(env))
+        return { ok: false, reason: 'test-env-not-object' };
+      for (const value of Object.values(env as Record<string, unknown>)) {
+        if (typeof value !== 'string')
+          return { ok: false, reason: 'test-env-not-string' };
+      }
+    }
   }
   return { ok: true, reason: 'ok' };
 }
diff --git a/src/index.ts b/src/index.ts
index 10a38ac..154c49e 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -46,7 +46,10 @@ import {
   pruneIdleControllers,
 } from './compaction.js';
 import { saveEvidence, emptyEvidence, loadEvidence } from './evidence.js';
-import { tryCompleteWithEvidence } from './verifier.js';
+import {
+  describeVerificationFailure,
+  tryCompleteWithEvidence,
+} from './verifier.js';
 import { PROOF_TOTAL_TIMEOUT_MS } from './proof.js';
 import { recordEvidence, registerGoalTools } from './tools.js';
 import {
@@ -370,11 +373,7 @@ export async function handleGoalCommand(
           clock,
         });
         if (!check.ok) {
-          return (
-            'Complete blocked: ' +
-            check.reason +
-            '. Add file citations plus passing tests to evidence.'
-          );
+          return describeVerificationFailure(check.reason, check.failures);
         }
       } catch {
         // Verifier failure fails closed: do not mark complete without proof.
diff --git a/src/proof.ts b/src/proof.ts
index 280824e..17f56fc 100644
--- a/src/proof.ts
+++ b/src/proof.ts
@@ -101,12 +101,14 @@ function unrunable(
  * @param command recorded command string; non-strings are rejected without spawning
  * @param clock injected clock used only for duration measurement
  * @param timeoutMs per-command budget, defaults to PROOF_TIMEOUT_MS
+ * @param extraEnv optional per-test environment overrides, applied last
  */
 export async function runProofCommand(
   projectDir: string,
   command: unknown,
   clock: Clock,
   timeoutMs: number = PROOF_TIMEOUT_MS,
+  extraEnv?: Record<string, string>,
 ): Promise<ProofResult> {
   const started = clock.nowMs();
   // Trim and type-check before spawning: an empty command would be a silent no-op.
@@ -147,6 +149,9 @@ export async function runProofCommand(
             NO_COLOR: '1',
             GIT_TERMINAL_PROMPT: '0',
             PIP_NO_INPUT: '1',
+            // Per-test overrides last: the recorded command knows which toolchain
+            // it needs (a JDK, a wrapper path) better than the host process does.
+            ...(extraEnv ?? {}),
           },
         },
         (err, stdout, stderr) => {
diff --git a/src/tools.ts b/src/tools.ts
index 52542bd..788536e 100644
--- a/src/tools.ts
+++ b/src/tools.ts
@@ -44,7 +44,10 @@ import {
   saveEvidence,
   validateEvidenceShape,
 } from './evidence.js';
-import { tryCompleteWithEvidence } from './verifier.js';
+import {
+  describeVerificationFailure,
+  tryCompleteWithEvidence,
+} from './verifier.js';
 import { PROOF_TOTAL_TIMEOUT_MS } from './proof.js';
 
 /** Host version stamped on tool-created state, matching the slash lane. */
@@ -559,11 +562,7 @@ async function toolComplete(
         clock,
       });
       if (!check.ok) {
-        return (
-          'Complete blocked: ' +
-          check.reason +
-          '. Add file citations plus passing tests to evidence.'
-        );
+        return describeVerificationFailure(check.reason, check.failures);
       }
     } catch {
       return 'Complete blocked: verifier-error. Add evidence and retry.';
diff --git a/src/verifier.ts b/src/verifier.ts
index e2550a6..17f04dc 100644
--- a/src/verifier.ts
+++ b/src/verifier.ts
@@ -122,6 +122,7 @@ async function observeCriterionTests(
       candidate.command,
       clock,
       perCommand,
+      candidate.env,
     );
     // Observed success is the only pass: the declared exit code is ignored here.
     if (proof.ok) continue;
@@ -313,3 +314,39 @@ export async function tryCompleteWithEvidence(args: {
   }
   return got;
 }
+
+/** How many concrete failures a blocked message quotes before it summarizes. */
+export const BLOCKED_FAILURE_LIMIT = 5;
+
+/**
+ * Build the operator/agent-facing message for a blocked completion.
+ *
+ * Why this exists: the verifier already produces precise reasons
+ * (`test-failed:<id>:exit=1`, `missing-file:<id>:<path>`, `test-budget:<id>`),
+ * but both completion lanes printed one canned sentence telling the agent to
+ * "add file citations plus passing tests" even when the citations were fine and
+ * a recorded command simply exited non-zero. The failures were built and then
+ * discarded, so the only actionable diagnosis never reached the caller.
+ * Quoting them (bounded, so a padded sidecar cannot flood the reply) makes the
+ * block self-explaining.
+ * @param reason stable verifier reason, e.g. `evidence-invalid`
+ * @param failures concrete failures produced by the verifier
+ * @returns one message with the reason plus each failure
+ */
+export function describeVerificationFailure(
+  reason: string,
+  failures: string[],
+): string {
+  const clean = (failures ?? [])
+    .filter((f) => typeof f === 'string' && f.trim().length > 0)
+    .map((f) => f.trim());
+  if (clean.length === 0) {
+    return 'Complete blocked: ' + reason + '. Add evidence and retry.';
+  }
+  const shown = clean.slice(0, BLOCKED_FAILURE_LIMIT).join('; ');
+  const more =
+    clean.length > BLOCKED_FAILURE_LIMIT
+      ? ' (+' + String(clean.length - BLOCKED_FAILURE_LIMIT) + ' more)'
+      : '';
+  return 'Complete blocked: ' + reason + ' — ' + shown + more + '.';
+}
diff --git a/tests/completion-message.test.ts b/tests/completion-message.test.ts
new file mode 100644
index 0000000..25eb483
--- /dev/null
+++ b/tests/completion-message.test.ts
@@ -0,0 +1,204 @@
+// Sibling Docs: tests/README.md | Decisions: tests/DECISIONS.md
+/**
+ * Completion-blocked messaging and per-test environment.
+ * Why these tests exist: a blocked completion used to print one canned sentence
+ * while discarding the verifier's concrete failures, and a proof command could
+ * only inherit the host environment. Both are contract-level behaviours, so
+ * they are pinned here rather than inferred from a green suite.
+ */
+import { describe, expect, it } from 'vitest';
+import { mkdtempSync, writeFileSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import * as path from 'node:path';
+import {
+  BLOCKED_FAILURE_LIMIT,
+  describeVerificationFailure,
+  verifyLocal,
+} from '../src/verifier.js';
+import { validateEvidenceShape } from '../src/evidence.js';
+import type { GoalEvidenceFile } from '../src/evidence.js';
+import type { Clock } from '../src/state.js';
+
+/** Fixed clock keeps observed durations deterministic. */
+class FakeClock implements Clock {
+  nowMs(): number {
+    return 1700000000000;
+  }
+}
+
+/** Build a project dir with one cited file so shape and existence checks pass. */
+function projectWithCitation(): { dir: string; file: string } {
+  const dir = mkdtempSync(path.join(tmpdir(), 'goal-blocked-'));
+  const file = path.join(dir, 'proof.txt');
+  writeFileSync(file, 'proof\n');
+  return { dir, file };
+}
+
+function evidenceWith(
+  dir: string,
+  command: string,
+  env?: Record<string, string>,
+): GoalEvidenceFile {
+  return {
+    version: 1,
+    updatedAtMs: 1700000000000,
+    criteria: [
+      {
+        id: 'e1',
+        claim: 'the recorded command passes',
+        files: ['proof.txt'],
+        tests: [{ command, exitCode: 0, ...(env ? { env } : {}) }],
+      },
+    ],
+  };
+}
+
+describe('describeVerificationFailure', () => {
+  it('quotes the concrete failures instead of a canned sentence', () => {
+    const message = describeVerificationFailure('evidence-invalid', [
+      'test-failed:e1:exit=1',
+    ]);
+
+    expect(message).toContain('evidence-invalid');
+    expect(message).toContain('test-failed:e1:exit=1');
+    expect(message).not.toContain('Add file citations plus passing tests');
+  });
+
+  it('falls back to the generic hint when the verifier reported none', () => {
+    const message = describeVerificationFailure('evidence-invalid', []);
+    expect(message).toBe(
+      'Complete blocked: evidence-invalid. Add evidence and retry.',
+    );
+  });
+
+  it('caps how many failures are quoted', () => {
+    const many = Array.from({ length: 8 }, (_, i) => 'failure-' + String(i));
+    const message = describeVerificationFailure('evidence-invalid', many);
+
+    expect(message).toContain('failure-0');
+    expect(message).toContain('failure-' + String(BLOCKED_FAILURE_LIMIT - 1));
+    expect(message).not.toContain('failure-6');
+    expect(message).toContain('(+3 more)');
+  });
+});
+
+describe('per-test environment', () => {
+  it('accepts an env map in the evidence shape', () => {
+    const shape = validateEvidenceShape({
+      version: 1,
+      updatedAtMs: 1,
+      criteria: [
+        {
+          id: 'e1',
+          claim: 'c',
+          files: ['a.txt'],
+          tests: [{ command: 'true', exitCode: 0, env: { JAVA_HOME: '/jdk' } }],
+        },
+      ],
+    });
+    expect(shape.ok).toBe(true);
+  });
+
+  it('rejects a non-string env value', () => {
+    const shape = validateEvidenceShape({
+      version: 1,
+      updatedAtMs: 1,
+      criteria: [
+        {
+          id: 'e1',
+          claim: 'c',
+          files: ['a.txt'],
+          tests: [{ command: 'true', exitCode: 0, env: { N: 1 } }],
+        },
+      ],
+    });
+    expect(shape.ok).toBe(false);
+    expect(shape.reason).toBe('test-env-not-string');
+  });
+
+  it('rejects a non-object env', () => {
+    const shape = validateEvidenceShape({
+      version: 1,
+      updatedAtMs: 1,
+      criteria: [
+        {
+          id: 'e1',
+          claim: 'c',
+          files: ['a.txt'],
+          tests: [{ command: 'true', exitCode: 0, env: ['JAVA_HOME=/jdk'] }],
+        },
+      ],
+    });
+    expect(shape.ok).toBe(false);
+    expect(shape.reason).toBe('test-env-not-object');
+  });
+
+  it('does not leak one criterion env into another criterion', async () => {
+    const { dir } = projectWithCitation();
+    // Criterion two passes only when the variable from criterion one is absent.
+    const evidence: GoalEvidenceFile = {
+      version: 1,
+      updatedAtMs: 1700000000000,
+      criteria: [
+        {
+          id: 'e1',
+          claim: 'sees its own token',
+          files: ['proof.txt'],
+          tests: [
+            {
+              command: 'test "$GOAL_LEAK_TOKEN" = "ok"',
+              exitCode: 0,
+              env: { GOAL_LEAK_TOKEN: 'ok' },
+            },
+          ],
+        },
+        {
+          id: 'e2',
+          claim: 'does not inherit the previous env',
+          files: ['proof.txt'],
+          tests: [{ command: 'test -z "$GOAL_LEAK_TOKEN"', exitCode: 0 }],
+        },
+      ],
+    };
+
+    const result = await verifyLocal(dir, evidence, {
+      runTests: true,
+      clock: new FakeClock(),
+      timeoutMs: 20000,
+    });
+
+    expect(result.failures).toEqual([]);
+    expect(result.ok).toBe(true);
+  });
+
+  it('passes the env to the observed command', async () => {
+    const { dir } = projectWithCitation();
+    // The command only exits 0 when the override arrived; without it the shell
+    // expands an empty variable and exits 1.
+    const evidence = evidenceWith(dir, 'test "$GOAL_PROOF_TOKEN" = "ok"', {
+      GOAL_PROOF_TOKEN: 'ok',
+    });
+
+    const result = await verifyLocal(dir, evidence, {
+      runTests: true,
+      clock: new FakeClock(),
+      timeoutMs: 20000,
+    });
+
+    expect(result.ok).toBe(true);
+  });
+
+  it('fails with a specific reason when the command really exits non-zero', async () => {
+    const { dir } = projectWithCitation();
+    const evidence = evidenceWith(dir, 'exit 3');
+
+    const result = await verifyLocal(dir, evidence, {
+      runTests: true,
+      clock: new FakeClock(),
+      timeoutMs: 20000,
+    });
+
+    expect(result.ok).toBe(false);
+    expect(result.failures.join(' ')).toContain('test-failed:e1:exit=3');
+  });
+});
```
<!-- END_GIT_DIFF -->
