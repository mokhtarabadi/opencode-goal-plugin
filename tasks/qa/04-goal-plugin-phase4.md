# Task 04: Goal Plugin Phase 4 Matrix Plus Publish

**File:** `tasks/completed/04-goal-plugin-phase4.md`
**Status:** closed
**Source:** manager
**Type:** feature
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Mode:** Night Work locked (autopilot). Advance blanket approval: Do it dont stop.

## Goal

Prove the plugin on web plus CLI plus TUI plus server-only surfaces, close deferred hardening, and prepare a clean npm publish (publish itself gated to morning).

## Acceptance Criteria

- [x] H1 traversal guard rejects dot-dot escapes
- [x] H3 subagent dispatch pass plus fail plus throw tested
- [x] H4 single reset export (already single, D1 keeps name)
- [x] H5 formatter run plus pending-pause test
- [x] H6 README plus CHANGELOG synced
- [x] P1-P4 matrix evidence logs exist
- [x] S1 versions synced at 0.2.0, no Night Work bump
- [x] S2 README install docs complete
- [x] S3 LICENSE MIT present and matches package metadata
- [x] S4 pack dry-run clean with zero junk files
- [x] Typecheck plus full suite plus build exit 0

## Definition of Done

- [x] Checklist steps executed in order
- [x] Verification Evidence recorded with exit codes

## Micro-Task Checklist

- [x] Step 1 task file plus anchors (verifier exports, single reset, 0.2.0, no LICENSE found)
- [x] Step 2 traversal guard in verifier.ts plus wiring
- [x] Step 3 H4 verified single, formatter run
- [x] Step 4 phase4-hardening tests plus subagent tests
- [x] Step 5 docs plus LICENSE plus versions
- [x] Step 6 matrix P1-P4 evidence logs
- [x] Step 7 typecheck test build dry-run

## Local TODOs

- [x] Implement hardening plus matrix plus docs
- [x] Typecheck plus full tests plus build plus dry-run
- [ ] QA plus review via Brain, then close

## Risk & Rollback

Matrix touched local host only. Publish excluded from Night Work (needs token plus morning approval). Rollback is revert of Phase 4 commit; Phases 1-3 intact.

## Execution Log & Reasoning

- Validation: AGENTS.md read. No rule violations. LICENSE was missing, added MIT with git-config identity.
- D1: kept `_resetIdleInFlightForTests` name (tests use it, already single definition) instead of renaming to resetIdleState.
- D2: pack included tmp-clones plus evidence plus tasks (14 junk lines), added files allowlist, repack clean at 10 files.
- Matrix honesty: CLI smoke ran live, web plus TUI plus server share the identical server-only core (zero UI imports proven), live UI runs deferred to morning.
- Hotfix QA_REJECTED F1-F3: guard rejects empty plus dot plus non-string, file check requires isFile. 5 hotfix tests added. 74 of 74 pass.
- D3: evidence logs unstaged and gitignored (kept on disk for audit) per reviewer hygiene.
- D4: review fixes applied without version bump: exact parent segments, portable README, version note, status qa.
- Stack skill skip: standalone TypeScript plugin, no registry stack skill.

## Verification Evidence

- Stack skill skip: root ~/Develop/Projects/opencode-goal-plugin, markers [package.json stack fields, src framework imports], matched [], reason standalone TypeScript plugin.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && npm run typecheck | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && rtk test npm test | Expected: all pass | Actual: 10 files 69 tests passed (62 existing plus 7 new) | Exit: 0.
- Hotfix command: cd ~/Develop/Projects/opencode-goal-plugin && rtk test npm test | Expected: all pass | Actual: 11 files 74 tests passed (69 existing plus 5 new) | Exit: 0.
- Review-fix command: typecheck plus 74 tests plus build | Expected: all exit 0 | Actual: all exit 0 | Exit: 0.
- Review-fix command: git diff --cached --name-only | Expected: no evidence files | Actual: no evidence staged | Exit: 0.
- Review: Code Reviewer technical approval PO_REVIEW_PENDING (F1-F6 strengths, I1-I3 publish-gated to morning). Night Work delegated closure with own commits.
- Command: cd ~/Develop/Projects/opencode-goal-plugin && npm run build | Expected: ESM plus CJS plus DTS | Actual: Build success | Exit: 0.
- Command: grep -R "Date.now" src | Expected: single source | Actual: only SystemClock.nowMs plus one comment | Exit: 0.
- Matrix: evidence/matrix-P1-web.log, P2-cli.log (live smoke), P3-tui.log, P4-server.log (zero UI imports) plus host-version.log.
- Dry run: evidence/pack-dry-run.log shows 0.2.0 tgz, 10 files, 10.9 kB, zero junk.
- LICENSE: present, MIT, matches package metadata. Versions: package 0.2.0, manifest 0.2.0.

## Factual Git Diff

- Pending.

## Closure

Night Work delegated closure: close on reviewer technical approval with own commits, never batched.
Closure scope: Phase 4 hardening plus matrix plus publish prep, 74 of 74 tests green. Publish itself gated to morning (token plus live matrix plus approval).

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/.gitignore b/.gitignore
index e8a28f5..46f327f 100644
--- a/.gitignore
+++ b/.gitignore
@@ -3,3 +3,5 @@ dist/
 .opencode/goal-state.json
 context-reports/
 tmp-clones/
+evidence/*.log
+evidence/*.tgz
diff --git a/CHANGELOG.md b/CHANGELOG.md
index fb2b466..8ce36c0 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,5 +1,11 @@
 # Changelog
 All notable changes follow Keep a Changelog.
+## [Unreleased]
+### Added
+- Evidence traversal guard rejecting dot-dot escapes.
+- Subagent dispatch tests for pass, fail, and throw paths.
+- MIT LICENSE plus install docs for all four surfaces.
+- Version note: package stays 0.2.0 during Night Work and sync to 0.3.0 is gated to morning publish with token plus live matrix.
 ## [0.3.0] - 2026-10-16
 ### Added
 - Compaction snapshot plus restore with restoreCount audit and cooldown clamp.
diff --git a/LICENSE b/LICENSE
new file mode 100644
index 0000000..2bd95e3
--- /dev/null
+++ b/LICENSE
@@ -0,0 +1,21 @@
+MIT License
+
+Copyright (c) 2026 Mohammad Reza Mokhtarabadi
+
+Permission is hereby granted, free of charge, to any person obtaining a copy
+of this software and associated documentation files (the "Software"), to deal
+in the Software without restriction, including without limitation the rights
+to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+copies of the Software, and to permit persons to whom the Software is
+furnished to do so, subject to the following conditions:
+
+The above copyright notice and this permission notice shall be included in all
+copies or substantial portions of the Software.
+
+THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+SOFTWARE.
diff --git a/README.md b/README.md
index 27627e7..322267d 100644
--- a/README.md
+++ b/README.md
@@ -1,7 +1,29 @@
-# opencode-goal-plugin Phase 2
-Slash goal sets objective. File state survives compaction. Idle auto-continue sends one prompt per idle tick while the goal stays active and within limits.
-Usage: /goal <objective> | /goal status | /goal block <reason> | /goal complete | /goal clear
+# opencode-goal-plugin
+Slash goal sets one objective and the agent keeps working until it is complete, blocked, or cleared. File state survives compaction. Idle auto-continue sends one prompt per idle tick while the goal stays active and within limits.
+## Install
+Local path install in your project `opencode.json` (relative to your project):
+```json
+{
+  "plugins": ["file:../opencode-goal-plugin"]
+}
+```
+After npm publish, use the published name:
+```json
+{
+  "plugins": ["opencode-goal-plugin"]
+}
+```
+Then restart OpenCode. npm install is handled by the host, no global install needed.
+## Surface checks (P1-P4)
+Same server-only core runs on web, CLI, TUI, and server-only: no TUI imports, no stdin reads. Check each surface with a two-item test goal:
+1. `/goal ship test item one` then `/goal status` shows active.
+2. Wait for one idle tick: at most one continuation sends.
+3. `/goal clear` then `/goal status` shows cleared.
+4. Create `.opencode/STOP_GOAL` to pause the loop immediately, delete it to resume.
+Missing host hooks fail closed with a reason and never crash the host.
+## Usage
+/goal &lt;objective&gt; | /goal status | /goal block &lt;reason&gt; | /goal complete | /goal clear
 Kill switch: create `.opencode/STOP_GOAL` to stop the loop immediately.
 Completion: `/goal complete` needs evidence in `.opencode/goal-evidence.json` with file citations plus passing test proof. Compaction-safe: state reloads from file and resumes without double send.
-State: .opencode/goal-state.json with UTC epoch ms.
+State: `.opencode/goal-state.json` with UTC epoch ms.
 Build: npm run typecheck, npm test, npm run build.
diff --git a/package.json b/package.json
index 4109654..ab5a38f 100644
--- a/package.json
+++ b/package.json
@@ -2,10 +2,12 @@
   "name": "opencode-goal-plugin",
   "version": "0.2.0",
   "description": "Slash goal with file state for OpenCode V2 Phase 1",
+  "license": "MIT",
   "type": "module",
   "main": "./dist/index.cjs",
   "module": "./dist/index.js",
   "types": "./dist/index.d.ts",
+  "files": ["dist", "commands", "README.md", "LICENSE", "CHANGELOG.md", "opencode.json"],
   "exports": {
     ".": {
       "import": "./dist/index.js",
diff --git a/src/verifier.ts b/src/verifier.ts
index 9436476..2e79925 100644
--- a/src/verifier.ts
+++ b/src/verifier.ts
@@ -8,6 +8,40 @@ import path from 'node:path';
 import type { GoalEvidenceFile } from './evidence.js';
 import { validateEvidenceShape, hashEvidence } from './evidence.js';
 
+/**
+ * Return true only when a citation resolves to a file inside projectDir.
+ * Rejects empty, dot, absolute escapes, and dot-dot traversal, plus any
+ * non-string input, so evidence cannot cite outside the verified project.
+ * @param projectDir absolute project root
+ * @param citation cited path, relative or absolute
+ */
+export function isCitationInsideProjectDir(projectDir: string, citation: string): boolean {
+  try {
+    // Non-string JSON values fail closed instead of throwing in path calls.
+    if (typeof citation !== 'string') {
+      return false;
+    }
+    if (citation.trim() === '') {
+      return false;
+    }
+    // Resolve both sides: a citation escaping via dot-dot lands outside base.
+    const base = path.resolve(projectDir);
+    const target = path.resolve(base, citation);
+    const rel = path.relative(base, target);
+    // Empty or dot relative means the project dir itself, not a file: reject.
+    if (rel === '' || rel === '.') {
+      return false;
+    }
+    // Exact parent segments only: names merely starting with two dots stay inside.
+    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
+      return false;
+    }
+    return true;
+  } catch {
+    return false;
+  }
+}
+
 /** Local verification outcome. Verifier errors keep goal active. */
 export interface LocalVerifyResult {
   ok: boolean;
@@ -56,10 +90,20 @@ export async function verifyLocal(
   const failures: string[] = [];
   for (const c of evidence.criteria) {
     for (const f of c.files) {
+      // Traversal guard first: outside citations fail without filesystem reads.
+      if (!isCitationInsideProjectDir(projectDir, f)) {
+        failures.push('traversal-escape:' + c.id + ':' + String(f));
+        continue;
+      }
       try {
-        await fs.access(path.isAbsolute(f) ? f : path.join(projectDir, f));
+        // Require a real file: directories and missing paths both fail proof.
+        const p = path.isAbsolute(f) ? f : path.join(projectDir, f);
+        const st = await fs.stat(p);
+        if (!st.isFile()) {
+          failures.push('not-a-file:' + c.id + ':' + String(f));
+        }
       } catch {
-        failures.push('missing-file:' + c.id + ':' + f);
+        failures.push('missing-file:' + c.id + ':' + String(f));
       }
     }
     // Each criterion needs at least one passing test proof.
diff --git a/tests/phase4-hardening.test.ts b/tests/phase4-hardening.test.ts
new file mode 100644
index 0000000..77e21fb
--- /dev/null
+++ b/tests/phase4-hardening.test.ts
@@ -0,0 +1,65 @@
+/**
+ * Phase 4 hardening tests: traversal plus parallel restore plus clamp.
+ * Why these tests exist: lock the publish-prep guarantees.
+ */
+import { describe, it, expect } from 'vitest';
+import { isCitationInsideProjectDir } from '../src/verifier.js';
+import { restoreAfterCompaction } from '../src/compaction.js';
+
+describe('phase4 hardening', () => {
+  it('T1 rejects dot-dot traversal citation', () => {
+    expect(isCitationInsideProjectDir('/tmp/proj', '../outside.txt')).toBe(false);
+    expect(isCitationInsideProjectDir('/tmp/proj', 'evidence/a.json')).toBe(true);
+  });
+  it('T2 parallel restore keeps audit count sane', async () => {
+    // Two concurrent restores must each report at least one restore, never throw.
+    let stored: Record<string, unknown> = {
+      iterationCount: 2,
+      lastTurnAtMs: 1700000000000,
+      lastContinuedMessageId: 'm1',
+      restoreCount: 0
+    };
+    const store = {
+      loadState: async () => stored,
+      saveState: async (_p: string, v: unknown) => {
+        stored = v as Record<string, unknown>;
+      }
+    };
+    class C {
+      constructor(public now = 1700000001000) {}
+      nowMs(): number {
+        return this.now;
+      }
+    }
+    const clock = new C();
+    const [a, b] = await Promise.all([
+      restoreAfterCompaction('/tmp/x.json', clock, store),
+      restoreAfterCompaction('/tmp/x.json', clock, store)
+    ]);
+    expect(a?.restoreCount).toBeGreaterThanOrEqual(1);
+    expect(b?.restoreCount).toBeGreaterThanOrEqual(1);
+    expect(stored['restoreCount'] as number).toBeGreaterThanOrEqual(1);
+  });
+  it('T6 restore clamps future timestamp to now', async () => {
+    let s: Record<string, unknown> = {
+      iterationCount: 1,
+      lastTurnAtMs: 1800000000000,
+      lastContinuedMessageId: 'm9',
+      restoreCount: 0
+    };
+    const store2 = {
+      loadState: async () => s,
+      saveState: async (_p: string, v: unknown) => {
+        s = v as Record<string, unknown>;
+      }
+    };
+    class C2 {
+      constructor(public now = 1700000000000) {}
+      nowMs(): number {
+        return this.now;
+      }
+    }
+    const got = await restoreAfterCompaction('/tmp/y.json', new C2(), store2);
+    expect(got?.lastTurnAtMs).toBe(1700000000000);
+  });
+});
diff --git a/tests/traversal-guard-hotfix.test.ts b/tests/traversal-guard-hotfix.test.ts
new file mode 100644
index 0000000..c2c1ffc
--- /dev/null
+++ b/tests/traversal-guard-hotfix.test.ts
@@ -0,0 +1,56 @@
+/**
+ * Traversal guard hotfix tests Phase 4.
+ * Why these tests exist: prove empty, dot, non-string, and directory citations fail closed.
+ */
+import { describe, it, expect } from 'vitest';
+import fs from 'node:fs/promises';
+import os from 'node:os';
+import path from 'node:path';
+import { isCitationInsideProjectDir, verifyLocal } from '../src/verifier.js';
+
+describe('traversal guard hotfix', () => {
+  it('rejects empty citation', () => {
+    expect(isCitationInsideProjectDir('/tmp/proj', '')).toBe(false);
+  });
+  it('rejects dot citation', () => {
+    expect(isCitationInsideProjectDir('/tmp/proj', '.')).toBe(false);
+  });
+  it('non-string citation fails closed without throw', () => {
+    let out: unknown;
+    expect(() => {
+      out = isCitationInsideProjectDir('/tmp/proj', null as unknown as string);
+    }).not.toThrow();
+    expect(out).toBe(false);
+  });
+  it('verifyLocal rejects empty and directory without throw', async () => {
+    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-verify-'));
+    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
+    await fs.writeFile(path.join(dir, 'src/a.ts'), 'x');
+    const got = await verifyLocal(dir, {
+      version: 1,
+      updatedAtMs: 1,
+      criteria: [
+        { id: 'c1', claim: 'x', files: ['', 'src', 'src/a.ts'], tests: [{ command: 'npm test', exitCode: 0 }] },
+      ],
+    });
+    expect(got.ok).toBe(false);
+    expect(got.failures.some((x) => x.includes('traversal-escape') || x.includes('not-a-file'))).toBe(true);
+  });
+  it('verifyLocal with null file fails closed', async () => {
+    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-verify-null-'));
+    await fs.writeFile(path.join(dir2, 'a.ts'), 'x');
+    let got: unknown;
+    await expect(
+      (async () => {
+        got = await verifyLocal(dir2, {
+          version: 1,
+          updatedAtMs: 1,
+          criteria: [
+            { id: 'c1', claim: 'x', files: [null as unknown as string], tests: [{ command: 'npm test', exitCode: 0 }] },
+          ],
+        });
+      })(),
+    ).resolves.toBeUndefined();
+    expect((got as { ok: boolean }).ok).toBe(false);
+  });
+});
diff --git a/tests/verifier.test.ts b/tests/verifier.test.ts
index 7b60e37..a093419 100644
--- a/tests/verifier.test.ts
+++ b/tests/verifier.test.ts
@@ -76,4 +76,99 @@ describe('verifier', () => {
     });
     expect(got.ok).toBe(true);
   });
+  it('T3 subagent pass completes', async () => {
+    // Host subagent agrees with local checks: completion carries both reasons.
+    const d = proj({ 'src/a.ts': 'x' });
+    const host = { runSubagent: async () => ({ pass: true, reason: 'looks good' }) };
+    const got = await verifyCompletion({
+      projectDir: d,
+      evidence: {
+        version: 1,
+        updatedAtMs: 1,
+        criteria: [
+          {
+            id: 'c1',
+            claim: 'x',
+            files: ['src/a.ts'],
+            tests: [{ command: 'npm test', exitCode: 0 }],
+          },
+        ],
+      },
+      host,
+      useSubagent: true,
+      stateSummary: 'goal active turn 3',
+    });
+    expect(got.ok).toBe(true);
+    expect(got.reason).toContain('subagent-pass');
+  });
+  it('T4 subagent fail keeps goal active', async () => {
+    // Host subagent rejects: goal stays active with the fail reason.
+    const d = proj({ 'src/a.ts': 'x' });
+    const host = { runSubagent: async () => ({ pass: false, reason: 'tests not run here' }) };
+    const got = await verifyCompletion({
+      projectDir: d,
+      evidence: {
+        version: 1,
+        updatedAtMs: 1,
+        criteria: [
+          {
+            id: 'c1',
+            claim: 'x',
+            files: ['src/a.ts'],
+            tests: [{ command: 'npm test', exitCode: 0 }],
+          },
+        ],
+      },
+      host,
+      useSubagent: true,
+    });
+    expect(got.ok).toBe(false);
+    expect(got.reason).toContain('subagent-fail');
+  });
+  it('T5 subagent throw keeps goal active', async () => {
+    // Host runner throws: verifier maps to not-ok instead of escaping.
+    const d = proj({ 'src/a.ts': 'x' });
+    const host = {
+      runSubagent: async () => {
+        throw new Error('runner down');
+      },
+    };
+    const got = await verifyCompletion({
+      projectDir: d,
+      evidence: {
+        version: 1,
+        updatedAtMs: 1,
+        criteria: [
+          {
+            id: 'c1',
+            claim: 'x',
+            files: ['src/a.ts'],
+            tests: [{ command: 'npm test', exitCode: 0 }],
+          },
+        ],
+      },
+      host,
+      useSubagent: true,
+    });
+    expect(got.ok).toBe(false);
+    expect(got.reason).toBe('verifier-error');
+  });
+  it('rejects traversal citation as invalid', async () => {
+    // Dot-dot citations fail without touching the filesystem outside.
+    const d = proj({ 'src/a.ts': 'x' });
+    const got = await verifyLocal(d, {
+      version: 1,
+      updatedAtMs: 1,
+      criteria: [
+        {
+          id: 'c1',
+          claim: 'x',
+          files: ['../escape.ts'],
+          tests: [{ command: 'npm test', exitCode: 0 }],
+        },
+      ],
+    });
+    expect(got.ok).toBe(false);
+    expect(got.failures.some((f) => f.startsWith('traversal-escape'))).toBe(true);
+  });
 });
```
<!-- END_GIT_DIFF -->
