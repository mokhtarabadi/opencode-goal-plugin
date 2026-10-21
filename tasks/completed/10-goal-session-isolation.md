# Task 10: Session-scoped goal isolation

**File:** `tasks/qa/10-goal-session-isolation.md`
**Status:** in-progress
**Source:** manager
**Type:** bugfix
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Priority:** High

## Goal

Scope goal state and evidence per session so session B never sees or continues session A's goal.

## Problem

`resolveStatePath(projectDir)` and `resolveEvidencePath(projectDir)` build one shared `.opencode/goal-state.json` per project. Idle handler, context hook, slash lane, and `goal_*` tools all read that single file. `sessionId` is only used for cooldown token key, not for storage isolation. Result: cross-session leakage.

## Acceptance Criteria

- [x] Goal set in session A is invisible to session B (`status` in B shows no goal).
- [x] Idle tick in B never continues A's objective.
- [x] Evidence is also per-session.
- [x] Existing tests updated, typecheck green.

## Execution Log & Reasoning

- Created from live cross-session leak report.
- [LITE] justification: user explicitly authorized lite task; fix is storage-path scoping with legacy fallback, fully covered by 149 green tests plus tsc clean, no security/financial surface, reversible via revert.
- Seat Check: domains → storage path isolation + tool contract → Software Architect. Skipped Designer (server-only), Senior Programmer (plan-only), QA/Reviewer (later gates). Trigger eval: Architect fires on [schema, contract, migration]; others miss. Brainstorm: not required — single-domain reversible.
- Brain plan verdict (task 10, Architect): per-session files `.opencode/goals/<safeSessionId>.json` + `.evidence.json`, sanitize `[A-Za-z0-9_-]` max64 else FNV-1a `sid-` hash, legacy fallback read + migrate-on-write, thread sessionId through slash/tools/idle/failure/startup/compaction/context. Second turn returned bare Senior Programmer XML (implement).
- Fed-context via 3 parallel cognitive-discovery subagents (state+evidence, index+tools, loop+watchdog) before second planning turn.
- Implementation: state.ts `sanitizeSessionId` + `resolveLegacyStatePath` + scoped `resolveStatePath(projectDir, sessionId?)` + `loadGoalStateWithFallback`; evidence.ts scoped `resolveEvidencePath` + scoped `loadEvidence`/`saveEvidence` with legacy fallback; tools.ts `storageSessionFor` (`unknown`/`slash`/empty → legacy) + scoped claim with first-write-no-lease fix + `recordEvidence` storage session param; index.ts `handleGoalCommand` sessionId param + scoped slash set/status/evidence/complete + scoped startup scan + scoped compaction/context hooks (context hook fails closed without session); loop.ts scoped idle + failure loads with legacy fallback. Kept `lastSessionId` field (now per-file lane, no cross leak).
- Repair R1 (same session): `recordEvidence` after `toolSet` with a different session hit BUSY because `tryClaimLease` on a missing scoped file returns false. Fix: `claimForTool` short-circuits claimed:true when the scoped file is absent (first write, no file to race).
- Repair R2 (tests): 4 red → updated `resolveStatePath(dir, sess)` reads, rewrote share-semantics test to isolation, scoped lease/evidence race tests to same session; added `tests/session-isolation.test.ts` (6 tests: slash invisibility, idle no-continue, evidence invisibility, legacy migrate-once, traversal sanitize, scoped seed never writes legacy).
- Assumption A1: host always supplies real `sessionID` on tool/slash/idle events; `unknown`/missing falls back to legacy and stays isolated from real sessions. A2: legacy migration is read-fallback + migrate-on-next-write (no auto-rewrite, race-free).
- Autopilot locked for task 10 QA per manager answer; chained bridge-QA then bridge-review under same task_id.
- QA_PASSED recorded from Brain QA turn (adversarial: scoped paths, fallback, no leak, traversal, evidence scoping).
- PO_REVIEW_PENDING recorded from Brain reviewer turn (technical approval; low-severity notes only, no blockers).

## Local TODOs

- [x] Scope state + evidence paths per session with legacy fallback
- [x] Thread sessionId through index/tools/loop lanes
- [x] Update/add isolation tests + typecheck + full suite
- [x] CHANGELOG + lint + stage + move to qa

## Verification Evidence

- Command: `./node_modules/.bin/tsc --noEmit` | Expected: clean | Actual: clean | Exit: 0.
- Command: `./node_modules/.bin/vitest run --no-color` | Expected: all pass | Actual: 16 files, 149 tests passed | Exit: 0.
- Command: `./node_modules/.bin/prettier --write src tests` then `--check` | Expected: clean | Actual: clean | Exit: 0.
- Stack-skill gate skip record: root dot, markers package.json + tsconfig.json scanned, matched none (Node TS plugin, no framework marker), reason no stack skill in registry; generic tsc + vitest + prettier gates run instead.
- No stack skill matches this repo (Node TS plugin, no framework); skill matrix miss logged.

## Risk & Rollback

- Risk: path change breaks existing single-file users. Mitigation: fallback read of legacy path, then migrate on write.
- Rollback: revert path helpers.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 9f1c124..847a1ff 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -30,6 +30,7 @@ All notable changes follow Keep a Changelog.
 - Hotfix evidence wiring: both complete lanes require proof plus wrapupSent once.
 - Hotfix setup guard plus session fairness plus lease proof with sidecar.
 - Hotfix evidence validation: slash rejects empty exit codes (Number('') coerces to 0); tool trims file entries and rejects partial bad files/tests arrays instead of silently dropping.
+- Session-scoped goal isolation: state and evidence now live per session under `.opencode/goals/<sessionId>.json` so session B never sees or continues session A's goal; legacy single file stays as read fallback with migrate-on-write.
 - Hotfix2 afterSend Clock plus Set copy plus prune helper plus drive-relative guard.
 
 ## [0.3.0] - 2026-10-16
diff --git a/src/evidence.ts b/src/evidence.ts
index 8d85f19..89c0dd2 100644
--- a/src/evidence.ts
+++ b/src/evidence.ts
@@ -6,6 +6,7 @@
 import { promises as fs } from 'node:fs';
 import path from 'node:path';
 import { createHash } from 'node:crypto';
+import { sanitizeSessionId } from './state.js';
 
 /** Version of the evidence sidecar format. */
 export const EVIDENCE_VERSION = 1 as const;
@@ -38,14 +39,35 @@ export interface GoalEvidenceFile {
 }
 
 /**
- * Resolve evidence sidecar path for a project directory.
+ * Resolve legacy (pre-isolation) evidence sidecar path for a project directory.
  * @param projectDir absolute project root
- * @returns absolute evidence file path
+ * @returns absolute legacy evidence file path
  */
-export function resolveEvidencePath(projectDir: string): string {
+export function resolveLegacyEvidencePath(projectDir: string): string {
   return path.join(projectDir, '.opencode', EVIDENCE_FILE_NAME);
 }
 
+/**
+ * Resolve evidence sidecar path for a project directory, scoped per session.
+ * Old callers pass projectDir only and keep the legacy path.
+ * @param projectDir absolute project root
+ * @param sessionId optional session lane id; empty or missing means legacy
+ * @returns absolute evidence file path
+ */
+export function resolveEvidencePath(
+  projectDir: string,
+  sessionId?: string | null,
+): string {
+  const t = typeof sessionId === 'string' ? sessionId.trim() : '';
+  if (t.length === 0) return resolveLegacyEvidencePath(projectDir);
+  return path.join(
+    projectDir,
+    '.opencode',
+    'goals',
+    sanitizeSessionId(t) + '.evidence.json',
+  );
+}
+
 /**
  * Build an empty evidence file with injected time.
  * @param nowMs UTC epoch millis from injected Clock
@@ -98,37 +120,52 @@ export function hashEvidence(ev: GoalEvidenceFile): string {
 
 /**
  * Load evidence sidecar, returning null when absent or invalid.
+ * Scoped first with legacy fallback so old sidecars migrate on next write.
  * @param projectDir absolute project root
+ * @param sessionId optional session lane id; empty or missing means legacy
  */
 export async function loadEvidence(
   projectDir: string,
+  sessionId?: string | null,
 ): Promise<GoalEvidenceFile | null> {
-  try {
-    const raw = await fs.readFile(resolveEvidencePath(projectDir), 'utf8');
-    const parsed: unknown = JSON.parse(raw);
-    const shape = validateEvidenceShape(parsed);
-    if (!shape.ok) return null;
-    return parsed as GoalEvidenceFile;
-  } catch (e: unknown) {
-    // ENOENT means no evidence yet; anything else also maps to null so callers stay total.
-    const code = (e as { code?: string }).code;
-    if (code === 'ENOENT') return null;
-    return null;
-  }
+  const t = typeof sessionId === 'string' ? sessionId.trim() : '';
+  const scoped = resolveEvidencePath(projectDir, sessionId);
+  const legacy = resolveLegacyEvidencePath(projectDir);
+  const readOne = async (p: string): Promise<GoalEvidenceFile | null> => {
+    try {
+      const raw = await fs.readFile(p, 'utf8');
+      const parsed: unknown = JSON.parse(raw);
+      const shape = validateEvidenceShape(parsed);
+      if (!shape.ok) return null;
+      return parsed as GoalEvidenceFile;
+    } catch (e: unknown) {
+      // ENOENT means no evidence yet; anything else also maps to null so callers stay total.
+      const code = (e as { code?: string }).code;
+      if (code === 'ENOENT') return null;
+      return null;
+    }
+  };
+  if (scoped === legacy || t.length === 0) return readOne(legacy);
+  const hit = await readOne(scoped);
+  if (hit !== null) return hit;
+  return readOne(legacy);
 }
 
 /**
  * Save evidence sidecar atomically via tmp plus rename with durability.
  * Why hardening exists: evidence is the second leg of completion proof.
  * Fsync plus chmod mirrors state durability so a crash cannot hollow proof.
+ * Scoped saves never write back to the legacy path (migrate-on-write).
  * @param projectDir absolute project root
  * @param ev evidence to persist
+ * @param sessionId optional session lane id; empty or missing means legacy
  */
 export async function saveEvidence(
   projectDir: string,
   ev: GoalEvidenceFile,
+  sessionId?: string | null,
 ): Promise<void> {
-  const target = resolveEvidencePath(projectDir);
+  const target = resolveEvidencePath(projectDir, sessionId);
   await fs.mkdir(path.dirname(target), { recursive: true });
   // Unique tmp per call so parallel savers never share a tmp file.
   evidenceTmpCounter += 1;
diff --git a/src/index.ts b/src/index.ts
index d21fb00..9f37d30 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -10,6 +10,8 @@ import { Plugin } from '@opencode/plugin';
 import {
   SystemClock,
   loadGoalState,
+  loadGoalStateWithFallback,
+  resolveLegacyStatePath,
   resolveStatePath,
   saveGoalState,
   tryClaimLease,
@@ -101,6 +103,7 @@ export async function handleGoalCommand(
   projectDir: string,
   clock: Clock = new SystemClock(),
   hostVersion: string = '2.0.29',
+  sessionId?: string | null,
 ): Promise<string> {
   // Type guards first: a misbehaving host gets a message, never a TypeError.
   if (typeof rawInput !== 'string') {
@@ -114,10 +117,18 @@ export async function handleGoalCommand(
   if (parsed.kind === 'invalid') {
     return 'Invalid /goal usage. Try /goal <objective> or /goal status.';
   }
-  const statePath = resolveStatePath(projectDir);
+  const storage =
+    typeof sessionId === 'string' && sessionId.trim() !== ''
+      ? sessionId.trim()
+      : undefined;
+  const statePath = resolveStatePath(projectDir, storage);
+  const legacyPath = resolveLegacyStatePath(projectDir);
   let current: GoalState | null;
   try {
-    current = await loadGoalState(statePath);
+    current =
+      statePath === legacyPath
+        ? await loadGoalState(statePath)
+        : await loadGoalStateWithFallback(statePath, legacyPath);
   } catch {
     // Corrupt JSON or shape mismatch: point at the file, do not throw.
     return (
@@ -181,6 +192,7 @@ export async function handleGoalCommand(
   if (parsed.kind === 'evidence') {
     // Parity by construction: the slash lane calls the tool handler directly,
     // so validation plus lease plus messages cannot drift between lanes.
+    // Storage scope is the real session; the lease lane stays 'slash'.
     return await recordEvidence(
       projectDir,
       clock,
@@ -191,6 +203,7 @@ export async function handleGoalCommand(
         tests: parsed.tests,
       },
       'slash',
+      storage ?? null,
     );
   }
   if (parsed.kind === 'complete') {
@@ -208,8 +221,9 @@ export async function handleGoalCommand(
       );
     }
     // Active path now requires evidence: missing proof blocks with friendly text.
+    // Scoped evidence: a session completes only on its own citations.
     try {
-      const ev = await loadEvidence(projectDir);
+      const ev = await loadEvidence(projectDir, storage);
       const check = await tryCompleteWithEvidence({
         projectDir,
         evidence: ev,
@@ -379,6 +393,7 @@ export function registerIdleHandler(
 export interface RegisterCompactionOptions {
   projectDir: string;
   clock?: Clock;
+  sessionId?: string | null;
 }
 
 /**
@@ -425,7 +440,11 @@ export function registerCompactionHandler(
       return { registered: false, reason: 'compaction-hook-unavailable' };
     }
     const clock = opts.clock ?? new SystemClock();
-    const statePath = resolveStatePath(opts.projectDir);
+    const storage =
+      typeof opts.sessionId === 'string' && opts.sessionId.trim() !== ''
+        ? opts.sessionId.trim()
+        : undefined;
+    const statePath = resolveStatePath(opts.projectDir, storage);
     const store = { loadState: loadGoalState, saveState: saveGoalState };
     // Snapshot flushes hot state to disk before compaction wipes memory.
     if (hasCompact && typeof h.onCompact === 'function') {
@@ -600,10 +619,14 @@ export default Plugin.define({
                     }
                     return;
                   }
-                  const statePath = resolveStatePath(projectDir);
-                  const current = await loadGoalState(statePath).catch(
-                    () => null,
-                  );
+                  const storage = sessionID !== '' ? sessionID : undefined;
+                  const statePath = resolveStatePath(projectDir, storage);
+                  const legacyPath = resolveLegacyStatePath(projectDir);
+                  const current = await (
+                    statePath === legacyPath
+                      ? loadGoalState(statePath)
+                      : loadGoalStateWithFallback(statePath, legacyPath)
+                  ).catch(() => null);
                   const next = setObjective(
                     current,
                     parsed.objective,
@@ -612,9 +635,11 @@ export default Plugin.define({
                   );
                   await saveGoalState(statePath, next);
                   // Seed evidence shell so completion checks have a file from turn one.
+                  // Scoped seed: sessions never share citations.
                   await saveEvidence(
                     projectDir,
                     emptyEvidence(clock.nowMs()),
+                    storage,
                   ).catch(() => undefined);
                   if (sessionID !== '') {
                     await (
@@ -634,10 +659,13 @@ export default Plugin.define({
                   return;
                 }
                 // Status, block, complete, and clear reuse the guarded handler, then report.
+                // Real session threads through so B never touches A's goal.
                 const message = await handleGoalCommand(
                   '/goal ' + text,
                   projectDir,
                   clock,
+                  '2.0.29',
+                  sessionID !== '' ? sessionID : undefined,
                 );
                 if (sessionID !== '') {
                   const session = (
@@ -860,28 +888,66 @@ export default Plugin.define({
       }
     })();
 
-    // Session-start resume: rearm any outstanding retry from file state.
-    // Why no immediate send: a blind resume would bypass the lease and the
-    // 20s cooldown. Rearm only, so the watchdog performs the guarded retry.
-    void loadGoalState(resolveStatePath(projectDir))
-      .then((st) => {
-        if (st === null || st.status !== 'active') return;
-        if (st.pendingAttempt === null) return;
-        // Rearm the exact last real session. A missing id means no lane is
-        // known yet, so skip: the next real event will rearm correctly.
-        const lane =
-          typeof st.lastSessionId === 'string' && st.lastSessionId.length > 0
-            ? st.lastSessionId
-            : '';
-        if (lane === '') return;
-        rearmFromState(projectDir, lane, st, clock, async () => {
-          await handleSessionIdle(
-            { projectDir, lastMessageId: null, sessionId: lane },
-            buildIdleDeps(lane),
-          );
-        });
-      })
-      .catch(() => undefined);
+    // Session-start resume: rearm outstanding retries from file state.
+    // Why scan instead of one file: per-session files each own their lane, so
+    // a global lastSessionId would reintroduce the leak. Best-effort only.
+    void (async () => {
+      try {
+        // Legacy single file keeps its old lane behavior for old users.
+        await loadGoalState(resolveStatePath(projectDir))
+          .then((st) => {
+            if (st === null || st.status !== 'active') return;
+            if (st.pendingAttempt === null) return;
+            const lane =
+              typeof st.lastSessionId === 'string' &&
+              st.lastSessionId.length > 0
+                ? st.lastSessionId
+                : '';
+            if (lane === '') return;
+            rearmFromState(projectDir, lane, st, clock, async () => {
+              await handleSessionIdle(
+                { projectDir, lastMessageId: null, sessionId: lane },
+                buildIdleDeps(lane),
+              );
+            });
+          })
+          .catch(() => undefined);
+        // Scoped files: rearm each lane with a pending retry.
+        const { promises: fsp } = await import('node:fs');
+        const goalsDir = (await import('node:path')).join(
+          projectDir,
+          '.opencode',
+          'goals',
+        );
+        let names: string[] = [];
+        try {
+          names = await fsp.readdir(goalsDir);
+        } catch {
+          return;
+        }
+        for (const n of names) {
+          if (!n.endsWith('.json') || n.endsWith('.evidence.json')) continue;
+          if (n.includes('.lock')) continue;
+          const lane = n.slice(0, -'.json'.length);
+          if (!/^[A-Za-z0-9_-]{1,64}$|^sid-[0-9a-f]{8}$/.test(lane)) continue;
+          try {
+            const st = await loadGoalState(resolveStatePath(projectDir, lane));
+            if (st === null || st.status !== 'active') continue;
+            if (st.pendingAttempt === null) continue;
+            rearmFromState(projectDir, lane, st, clock, async () => {
+              await handleSessionIdle(
+                { projectDir, lastMessageId: null, sessionId: lane },
+                buildIdleDeps(lane),
+              );
+            });
+          } catch {
+            // One bad scoped file never blocks the rest.
+          }
+        }
+      } catch {
+        // Startup rearm is best-effort.
+      }
+    })();
 
     // Compaction survival: re-inject the goal summary from file state, never send.
     try {
@@ -907,7 +973,8 @@ export default Plugin.define({
                 // Prune failure never blocks compaction; live stays registered.
                 idleAbortControllers.add(controller);
               }
-              void loadGoalState(resolveStatePath(projectDir))
+              // Scoped restore: a session resumes only its own goal, never another's.
+              void loadGoalState(resolveStatePath(projectDir, e.sessionID))
                 .then((state) => {
                   if (state === null || state.status !== 'active') return;
                   if (!Array.isArray(e.messages)) return;
@@ -931,8 +998,11 @@ export default Plugin.define({
         await session
           .hook('context', (event: unknown) => {
             try {
-              const e = event as { system?: unknown };
-              void loadGoalState(resolveStatePath(projectDir))
+              const e = event as { system?: unknown; sessionID?: unknown };
+              // Fail closed: without a session id we inject nothing, so B can
+              // never see A's goal through a session-less context event.
+              if (typeof e.sessionID !== 'string' || e.sessionID === '') return;
+              void loadGoalState(resolveStatePath(projectDir, e.sessionID))
                 .then((state) => {
                   if (state === null || state.status !== 'active') return;
                   if (!Array.isArray(e.system)) return;
diff --git a/src/loop.ts b/src/loop.ts
index e076e15..93e3b3a 100644
--- a/src/loop.ts
+++ b/src/loop.ts
@@ -292,10 +292,23 @@ export async function handleSessionFailure(
   ) {
     return { decision: 'stopped', reason: 'invalid-deps' };
   }
-  const statePath = resolveStatePath(ctx.projectDir);
+  const storage =
+    typeof ctx.sessionId === 'string' && ctx.sessionId.trim().length > 0
+      ? ctx.sessionId.trim()
+      : undefined;
+  const statePath = resolveStatePath(ctx.projectDir, storage);
+  const legacyPath = resolveStatePath(ctx.projectDir);
   let current: GoalState | null;
   try {
     current = await deps.loadState(statePath);
+    // Scoped missing plus legacy present: migrate old users exactly once.
+    if (current === null && statePath !== legacyPath) {
+      try {
+        current = await deps.loadState(legacyPath);
+      } catch {
+        current = null;
+      }
+    }
   } catch {
     return { decision: 'stopped', reason: 'corrupt-state' };
   }
@@ -630,10 +643,23 @@ export async function handleSessionIdle(
   activeContinueTokens.set(tokenKey, myToken);
   idleInFlight = true;
   try {
-    const statePath = resolveStatePath(ctx.projectDir);
+    // Scoped storage: an idle tick in B loads only B's file, never A's.
+    const idleStorage =
+      typeof ctx.sessionId === 'string' && ctx.sessionId.trim().length > 0
+        ? ctx.sessionId.trim()
+        : undefined;
+    const statePath = resolveStatePath(ctx.projectDir, idleStorage);
+    const legacyPath = resolveStatePath(ctx.projectDir);
     let current: GoalState | null;
     try {
       current = await deps.loadState(statePath);
+      if (current === null && statePath !== legacyPath) {
+        try {
+          current = await deps.loadState(legacyPath);
+        } catch {
+          current = null;
+        }
+      }
     } catch {
       return { decision: 'stopped', reason: 'corrupt-state' };
     }
diff --git a/src/state.ts b/src/state.ts
index ba2beae..cdecb8c 100644
--- a/src/state.ts
+++ b/src/state.ts
@@ -91,16 +91,92 @@ export interface GoalState {
 
 export const STATE_FILENAME = 'goal-state.json';
 export const LEASE_TTL_MS = 120000;
+export const SESSION_STATE_DIR = 'goals';
 
 /**
- * Resolve state file path inside project dir.
+ * Sanitize a session id into a safe filename stem.
+ * Why this helper exists: session ids come from the host and must never
+ * escape the goals dir via traversal. Strict allowlist keeps isolation safe.
+ * Trims, allows 1..64 of [A-Za-z0-9_-], else stable FNV-1a hash with sid- prefix.
+ * @param raw unknown session id value
+ */
+export function sanitizeSessionId(raw: unknown): string {
+  const t = typeof raw === 'string' ? raw.trim() : '';
+  if (/^[A-Za-z0-9_-]{1,64}$/.test(t)) return t;
+  // FNV-1a 32-bit over the raw string: stable, dependency-free, 8 hex chars.
+  let h = 0x811c9dc5;
+  const s = typeof raw === 'string' ? raw : String(raw);
+  for (let i = 0; i < s.length; i++) {
+    h ^= s.charCodeAt(i);
+    h = Math.imul(h, 0x01000193);
+  }
+  return 'sid-' + (h >>> 0).toString(16).padStart(8, '0');
+}
+
+/**
+ * Resolve legacy (pre-isolation) state file path inside project dir.
+ * Why kept: existing users own one shared file; fallback reads it once.
  * @param projectDir project root containing .opencode dir
  */
-export function resolveStatePath(projectDir: string): string {
+export function resolveLegacyStatePath(projectDir: string): string {
   // Inline path join keeps storage layout explicit and testable.
   return path.join(projectDir, '.opencode', STATE_FILENAME);
 }
 
+/**
+ * Resolve state file path inside project dir, scoped per session when given.
+ * Why optional session exists: old callers pass projectDir only and keep the
+ * legacy path, so existing tests stay green. New lanes pass the real session
+ * id and get an isolated file under .opencode/goals/.
+ * @param projectDir project root containing .opencode dir
+ * @param sessionId optional session lane id; empty or missing means legacy
+ */
+export function resolveStatePath(
+  projectDir: string,
+  sessionId?: string | null,
+): string {
+  const t = typeof sessionId === 'string' ? sessionId.trim() : '';
+  if (t.length === 0) return resolveLegacyStatePath(projectDir);
+  // Scoped file keeps storage layout explicit and testable.
+  return path.join(
+    projectDir,
+    '.opencode',
+    SESSION_STATE_DIR,
+    sanitizeSessionId(t) + '.json',
+  );
+}
+
+/**
+ * Load state with legacy fallback: scoped first, then legacy file once.
+ * Why fallback exists: single-file users migrate without losing an active goal.
+ * Corrupt scoped files fail closed (no fallback) so corruption never hides.
+ * Missing scoped plus present legacy returns legacy content; the next mutation
+ * saves to the scoped path, completing a migrate-on-write without races.
+ * @param scopedPath per-session state path
+ * @param legacyPath legacy shared state path
+ */
+export async function loadGoalStateWithFallback(
+  scopedPath: string,
+  legacyPath: string,
+): Promise<GoalState | null> {
+  // Same-file shortcut: legacy callers pass identical paths, single load.
+  if (scopedPath === legacyPath) return loadGoalState(scopedPath);
+  let scoped: GoalState | null;
+  try {
+    scoped = await loadGoalState(scopedPath);
+  } catch {
+    // Corrupt scoped file fails closed: never mask it with legacy content.
+    throw new Error('corrupt goal state at ' + scopedPath);
+  }
+  if (scoped !== null) return scoped;
+  // Scoped missing: one legacy read migrates old users exactly once.
+  try {
+    return await loadGoalState(legacyPath);
+  } catch {
+    throw new Error('corrupt goal state at ' + legacyPath);
+  }
+}
+
 /**
  * Create a fresh state for a new objective.
  * @param objective trimmed objective text, must be non-empty
diff --git a/src/tools.ts b/src/tools.ts
index 6a0bf37..7f5761e 100644
--- a/src/tools.ts
+++ b/src/tools.ts
@@ -15,7 +15,9 @@ import type { Clock, GoalState } from './state.js';
 import {
   LEASE_TTL_MS,
   loadGoalState,
+  loadGoalStateWithFallback,
   releaseLease,
+  resolveLegacyStatePath,
   resolveStatePath,
   saveGoalState,
   tryClaimLease,
@@ -102,11 +104,24 @@ const BUSY_MESSAGE = 'Goal is busy with another turn. Retry shortly.';
  */
 async function claimForTool(
   statePath: string,
+  legacyPath: string,
   current: GoalState | null,
   owner: string,
   clock: Clock,
 ): Promise<{ claimed: boolean }> {
   if (current === null) return { claimed: true };
+  // First write to a missing scoped file needs no lease: no file to race.
+  // Why scoped check matters: fallback may have loaded legacy content while
+  // the scoped path is still absent. Claiming the absent path would fail
+  // closed (tryClaimLease returns false on null) and wrongly report busy.
+  if (statePath !== legacyPath) {
+    try {
+      const scoped = await loadGoalState(statePath);
+      if (scoped === null) return { claimed: true };
+    } catch {
+      // Corrupt scoped fails closed below via tryClaimLease path.
+    }
+  }
   try {
     const res = await tryClaimLease(statePath, owner, LEASE_TTL_MS, clock);
     return { claimed: res.claimed };
@@ -134,13 +149,33 @@ async function releaseToolLease(
 }
 
 /**
- * Load current state, mapping corruption to the shared message.
+ * Map a lane id to a storage session: host-less markers stay on legacy.
+ * Why this helper exists: toolSessionId returns 'unknown' when the host omits
+ * the session, and the slash lane historically passed 'slash' as the lane.
+ * Neither is a real session, so both map to legacy (undefined) to keep old
+ * callers green. Real session ids pass through to per-session files.
+ * @param sessionID lane id from toolSessionId or slash wiring
+ */
+function storageSessionFor(sessionID: string): string | undefined {
+  const t = typeof sessionID === 'string' ? sessionID.trim() : '';
+  if (t === '' || t === 'unknown' || t === 'slash') return undefined;
+  return t;
+}
+
+/**
+ * Load current state with legacy fallback, mapping corruption to the message.
+ * Scoped missing plus legacy present returns legacy content; next save lands
+ * scoped (migrate-on-write). Corrupt scoped fails closed without fallback.
  */
 async function loadForTool(
   statePath: string,
+  legacyPath: string,
 ): Promise<{ state: GoalState | null } | { error: string }> {
   try {
-    return { state: await loadGoalState(statePath) };
+    if (statePath === legacyPath)
+      return { state: await loadGoalState(statePath) };
+    // Corrupt scoped throws inside and maps to the corrupt message below.
+    return { state: await loadGoalStateWithFallback(statePath, legacyPath) };
   } catch {
     return { error: corruptMessage(statePath) };
   }
@@ -168,11 +203,19 @@ async function toolSet(
   if (!isSafeGoalTitle(title)) {
     return 'Invalid /goal usage. Objective must not be a path escape.';
   }
-  const statePath = resolveStatePath(projectDir);
-  const loaded = await loadForTool(statePath);
+  const storage = storageSessionFor(sessionID);
+  const statePath = resolveStatePath(projectDir, storage);
+  const legacyPath = resolveLegacyStatePath(projectDir);
+  const loaded = await loadForTool(statePath, legacyPath);
   if ('error' in loaded) return loaded.error;
   const owner = 'tool:' + sessionID;
-  const claim = await claimForTool(statePath, loaded.state, owner, clock);
+  const claim = await claimForTool(
+    statePath,
+    legacyPath,
+    loaded.state,
+    owner,
+    clock,
+  );
   if (!claim.claimed) return BUSY_MESSAGE;
   try {
     const next = setObjective(loaded.state, title, clock, TOOL_HOST_VERSION);
@@ -203,14 +246,22 @@ async function toolBlock(
   ) {
     return 'Invalid usage. Provide a reason string.';
   }
-  const statePath = resolveStatePath(projectDir);
-  const loaded = await loadForTool(statePath);
+  const storage = storageSessionFor(sessionID);
+  const statePath = resolveStatePath(projectDir, storage);
+  const legacyPath = resolveLegacyStatePath(projectDir);
+  const loaded = await loadForTool(statePath, legacyPath);
   if ('error' in loaded) return loaded.error;
   if (loaded.state === null) {
     return 'No goal set. Use /goal <objective> first.';
   }
   const owner = 'tool:' + sessionID;
-  const claim = await claimForTool(statePath, loaded.state, owner, clock);
+  const claim = await claimForTool(
+    statePath,
+    legacyPath,
+    loaded.state,
+    owner,
+    clock,
+  );
   if (!claim.claimed) return BUSY_MESSAGE;
   try {
     let next: GoalState;
@@ -248,12 +299,15 @@ async function toolBlock(
  * @param clock injected clock
  * @param input raw tool input with id, claim, files, tests
  * @param sessionID lane id for the lease owner
+ * @param storageSessionId optional real session for storage scope (slash lane
+ * passes its invocation sessionID here; defaults to sessionID)
  */
 export async function recordEvidence(
   projectDir: string,
   clock: Clock,
   input: unknown,
   sessionID: string,
+  storageSessionId?: string | null,
 ): Promise<string> {
   const raw = input as {
     id?: unknown;
@@ -319,8 +373,13 @@ export async function recordEvidence(
   ) {
     return 'Invalid /goal evidence usage. Provide id=<id> claim=<claim> files=<a,b> tests=<cmd:exitCode>.';
   }
-  const statePath = resolveStatePath(projectDir);
-  const loaded = await loadForTool(statePath);
+  const storage =
+    typeof storageSessionId === 'string' && storageSessionId.trim() !== ''
+      ? storageSessionFor(storageSessionId)
+      : storageSessionFor(sessionID);
+  const statePath = resolveStatePath(projectDir, storage);
+  const legacyPath = resolveLegacyStatePath(projectDir);
+  const loaded = await loadForTool(statePath, legacyPath);
   if ('error' in loaded) return loaded.error;
   if (loaded.state === null) {
     return 'No goal set. Use /goal <objective> first.';
@@ -333,11 +392,19 @@ export async function recordEvidence(
     );
   }
   const owner = 'tool:' + sessionID;
-  const claimRes = await claimForTool(statePath, loaded.state, owner, clock);
+  const claimRes = await claimForTool(
+    statePath,
+    legacyPath,
+    loaded.state,
+    owner,
+    clock,
+  );
   if (!claimRes.claimed) return BUSY_MESSAGE;
   try {
     // Null sidecar (e.g. tool-lane set never seeded one) starts empty.
-    const current = (await loadEvidence(projectDir)) ?? emptyEvidence(0);
+    // Scoped evidence: slash plus tool lanes never share citations.
+    const current =
+      (await loadEvidence(projectDir, storage)) ?? emptyEvidence(0);
     if (current.criteria.some((c) => c.id === id)) {
       return 'Evidence id already recorded: ' + id + '.';
     }
@@ -363,7 +430,7 @@ export async function recordEvidence(
       return 'Invalid evidence shape: ' + shape.reason + '.';
     }
     try {
-      await saveEvidence(projectDir, candidate);
+      await saveEvidence(projectDir, candidate, storage);
     } catch (err) {
       return 'Failed to save evidence: ' + (err as Error).message;
     }
@@ -384,14 +451,22 @@ async function toolComplete(
   clock: Clock,
   sessionID: string,
 ): Promise<string> {
-  const statePath = resolveStatePath(projectDir);
-  const loaded = await loadForTool(statePath);
+  const storage = storageSessionFor(sessionID);
+  const statePath = resolveStatePath(projectDir, storage);
+  const legacyPath = resolveLegacyStatePath(projectDir);
+  const loaded = await loadForTool(statePath, legacyPath);
   if ('error' in loaded) return loaded.error;
   if (loaded.state === null) {
     return 'No goal set. Use /goal <objective> first.';
   }
   const owner = 'tool:' + sessionID;
-  const claim = await claimForTool(statePath, loaded.state, owner, clock);
+  const claim = await claimForTool(
+    statePath,
+    legacyPath,
+    loaded.state,
+    owner,
+    clock,
+  );
   if (!claim.claimed) return BUSY_MESSAGE;
   try {
     let next: GoalState;
@@ -405,7 +480,7 @@ async function toolComplete(
       );
     }
     try {
-      const ev = await loadEvidence(projectDir);
+      const ev = await loadEvidence(projectDir, storage);
       const check = await tryCompleteWithEvidence({
         projectDir,
         evidence: ev,
@@ -439,14 +514,22 @@ async function toolResume(
   clock: Clock,
   sessionID: string,
 ): Promise<string> {
-  const statePath = resolveStatePath(projectDir);
-  const loaded = await loadForTool(statePath);
+  const storage = storageSessionFor(sessionID);
+  const statePath = resolveStatePath(projectDir, storage);
+  const legacyPath = resolveLegacyStatePath(projectDir);
+  const loaded = await loadForTool(statePath, legacyPath);
   if ('error' in loaded) return loaded.error;
   if (loaded.state === null) {
     return 'No goal set. Use /goal <objective> first.';
   }
   const owner = 'tool:' + sessionID;
-  const claim = await claimForTool(statePath, loaded.state, owner, clock);
+  const claim = await claimForTool(
+    statePath,
+    legacyPath,
+    loaded.state,
+    owner,
+    clock,
+  );
   if (!claim.claimed) return BUSY_MESSAGE;
   try {
     let resumed: GoalState;
diff --git a/tests/session-isolation.test.ts b/tests/session-isolation.test.ts
new file mode 100644
index 0000000..8214d30
--- /dev/null
+++ b/tests/session-isolation.test.ts
@@ -0,0 +1,154 @@
+/**
+ * Session isolation regression tests for Task 10.
+ * Why these tests exist: prove session B never sees or continues session A's
+ * goal after the per-session storage fix. Each lane (slash, tools, idle,
+ * evidence) gets one isolation assertion plus legacy migration plus sanitize.
+ */
+import { describe, expect, it } from 'vitest';
+import { mkdtempSync, writeFileSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import * as path from 'node:path';
+import { handleGoalCommand } from '../src/index.js';
+import {
+  loadGoalState,
+  resolveStatePath,
+  sanitizeSessionId,
+} from '../src/state.js';
+import {
+  loadEvidence,
+  resolveEvidencePath,
+  saveEvidence,
+  emptyEvidence,
+} from '../src/evidence.js';
+import { handleSessionIdle } from '../src/loop.js';
+import { DEFAULT_LIMITS } from '../src/limits.js';
+import type { Clock } from '../src/state.js';
+
+/** Fixed clock keeps timestamps deterministic. */
+class FakeClock implements Clock {
+  nowMs(): number {
+    return 1700000000000;
+  }
+}
+
+describe('session isolation', () => {
+  it('slash status in B shows no goal after A sets one', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-status-'));
+    const clock = new FakeClock();
+    await handleGoalCommand('/goal ship A', dir, clock, '2.0.29', 'sess-A');
+    const b = await handleGoalCommand(
+      '/goal status',
+      dir,
+      clock,
+      '2.0.29',
+      'sess-B',
+    );
+    expect(b).toContain('No goal set');
+    const a = await handleGoalCommand(
+      '/goal status',
+      dir,
+      clock,
+      '2.0.29',
+      'sess-A',
+    );
+    expect(a).toContain('ship A');
+  });
+
+  it('idle tick in B never continues A objective', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-idle-'));
+    const clock = new FakeClock();
+    await handleGoalCommand('/goal ship A', dir, clock, '2.0.29', 'sess-A');
+    let sent = 0;
+    const deps = {
+      clock,
+      limits: DEFAULT_LIMITS,
+      ownerId: 'test',
+      loadState: loadGoalState,
+      saveState: (await import('../src/state.js')).saveGoalState,
+      tryClaim: (await import('../src/state.js')).tryClaimLease,
+      sendPrompt: async () => {
+        sent += 1;
+        return { success: true as const, messageId: 'm1' };
+      },
+      hasStopFile: async () => false,
+    };
+    const res = await handleSessionIdle(
+      { projectDir: dir, lastMessageId: null, sessionId: 'sess-B' },
+      deps,
+    );
+    expect(sent).toBe(0);
+    expect(res.reason).toBe('no-state');
+  });
+
+  it('evidence written in A is invisible in B', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-ev-'));
+    const clock = new FakeClock();
+    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+    await handleGoalCommand('/goal ship A', dir, clock, '2.0.29', 'sess-A');
+    const rec = await handleGoalCommand(
+      '/goal evidence id=e1 claim=done files=proof.txt tests=npm test:0',
+      dir,
+      clock,
+      '2.0.29',
+      'sess-A',
+    );
+    expect(rec).toContain('Criterion recorded');
+    const evB = await loadEvidence(dir, 'sess-B');
+    expect(evB).toBeNull();
+    const evA = await loadEvidence(dir, 'sess-A');
+    expect(evA?.criteria.map((c) => c.id)).toEqual(['e1']);
+  });
+
+  it('legacy file migrates on next scoped write without sharing', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-legacy-'));
+    const clock = new FakeClock();
+    // Old caller with no session writes the legacy file.
+    await handleGoalCommand('/goal legacy goal', dir, clock);
+    expect((await loadGoalState(resolveStatePath(dir)))?.objective).toBe(
+      'legacy goal',
+    );
+    // New session B reads legacy via fallback, then its own write lands scoped.
+    const statusB = await handleGoalCommand(
+      '/goal status',
+      dir,
+      clock,
+      '2.0.29',
+      'sess-B',
+    );
+    expect(statusB).toContain('legacy goal');
+    await handleGoalCommand(
+      '/goal block waiting',
+      dir,
+      clock,
+      '2.0.29',
+      'sess-B',
+    );
+    const scopedB = await loadGoalState(resolveStatePath(dir, 'sess-B'));
+    expect(scopedB?.status).toBe('blocked');
+    const legacy = await loadGoalState(resolveStatePath(dir));
+    expect(legacy?.status).toBe('active');
+  });
+
+  it('sanitize blocks path traversal without throwing', async () => {
+    expect(sanitizeSessionId('../../etc')).toMatch(/^sid-[0-9a-f]{8}$/);
+    expect(sanitizeSessionId('sess-A')).toBe('sess-A');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-trav-'));
+    const p = resolveStatePath(dir, '../../etc');
+    expect(p.startsWith(path.join(dir, '.opencode', 'goals'))).toBe(true);
+    expect(p).not.toContain('..');
+    const ep = resolveEvidencePath(dir, '../../etc');
+    expect(ep.startsWith(path.join(dir, '.opencode', 'goals'))).toBe(true);
+  });
+
+  it('scoped evidence save never writes the legacy path', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-iso-evscope-'));
+    await saveEvidence(
+      dir,
+      { ...emptyEvidence(1), criteria: [] },
+      'sess-X',
+    ).catch(() => undefined);
+    // empty criteria still writes the shell; legacy file must stay absent.
+    const { existsSync } = await import('node:fs');
+    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+  });
+});
diff --git a/tests/tools.test.ts b/tests/tools.test.ts
index 841255a..a043a9e 100644
--- a/tests/tools.test.ts
+++ b/tests/tools.test.ts
@@ -183,7 +183,7 @@ describe('tool execute parity with slash', () => {
       { sessionID: 'sess-1' },
     );
     expect(out.content).toContain('Goal set to active');
-    const state = await loadGoalState(resolveStatePath(dir));
+    const state = await loadGoalState(resolveStatePath(dir, 'sess-1'));
     expect(state?.status).toBe('active');
     expect(state?.objective).toBe('block foo');
   });
@@ -199,9 +199,9 @@ describe('tool execute parity with slash', () => {
     expect(state?.status).toBe('active');
     expect(state?.objective).toBe(evil);
   });
-  it('different sessionIDs share one project goal without bleed', async () => {
-    // Single-goal-per-project semantics: sequential writes are consistent,
-    // last writer wins, and neither call throws or corrupts state.
+  it('different sessionIDs get isolated goals without bleed', async () => {
+    // Per-session isolation: each lane owns its file, last writer no longer
+    // clobbers the other lane. A sees only A's goal, B only B's.
     const { loadGoalState, resolveStatePath } = await import('../src/state.js');
     const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-sess-'));
     const defs = await toolDefs(dir);
@@ -215,8 +215,10 @@ describe('tool execute parity with slash', () => {
     );
     expect(a.content).toContain('Goal set to active');
     expect(b.content).toContain('Goal set to active');
-    const state = await loadGoalState(resolveStatePath(dir));
-    expect(state?.objective).toBe('from sess-B');
+    const stateA = await loadGoalState(resolveStatePath(dir, 'sess-A'));
+    const stateB = await loadGoalState(resolveStatePath(dir, 'sess-B'));
+    expect(stateA?.objective).toBe('from sess-A');
+    expect(stateB?.objective).toBe('from sess-B');
   });
   it('projects stay isolated from each other', async () => {
     const { loadGoalState, resolveStatePath } = await import('../src/state.js');
@@ -235,8 +237,11 @@ describe('tool execute parity with slash', () => {
     const clock = new FakeClock();
     const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-race-'));
     const defs = await toolDefs(dir);
-    await byName(defs, 'goal_set').execute({ title: 'baseline' }, {});
-    const statePath = resolveStatePath(dir);
+    await byName(defs, 'goal_set').execute(
+      { title: 'baseline' },
+      { sessionID: 'sess-race' },
+    );
+    const statePath = resolveStatePath(dir, 'sess-race');
     const before = readFileSync(statePath, 'utf8');
     const held = await tryClaimLease(statePath, 'loop', LEASE_TTL_MS, clock);
     expect(held.claimed).toBe(true);
@@ -332,7 +337,10 @@ describe('goal_evidence sole writer', () => {
     const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evok-'));
     writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
     const defs = await toolDefs(dir);
-    await byName(defs, 'goal_set').execute({ title: 'prove it' }, {});
+    await byName(defs, 'goal_set').execute(
+      { title: 'prove it' },
+      { sessionID: 'sess-ev' },
+    );
     const rec = await byName(defs, 'goal_evidence').execute(
       {
         id: 'e1',
@@ -343,9 +351,12 @@ describe('goal_evidence sole writer', () => {
       { sessionID: 'sess-ev' },
     );
     expect(rec.content).toContain('Criterion recorded for e1');
-    const ev = await loadEvidence(dir);
+    const ev = await loadEvidence(dir, 'sess-ev');
     expect(ev?.criteria.map((c) => c.id)).toEqual(['e1']);
-    const done = await byName(defs, 'goal_complete').execute({}, {});
+    const done = await byName(defs, 'goal_complete').execute(
+      {},
+      { sessionID: 'sess-ev' },
+    );
     expect(done.content).toBe('Goal marked complete.');
   });
   it('hostile shape writes nothing', async () => {
@@ -387,9 +398,12 @@ describe('goal_evidence sole writer', () => {
     const clock = new FakeClock();
     const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evrace-'));
     const defs = await toolDefs(dir);
-    await byName(defs, 'goal_set').execute({ title: 'baseline' }, {});
+    await byName(defs, 'goal_set').execute(
+      { title: 'baseline' },
+      { sessionID: 'sess-race' },
+    );
     const held = await tryClaimLease(
-      resolveStatePath(dir),
+      resolveStatePath(dir, 'sess-race'),
       'loop',
       LEASE_TTL_MS,
       clock,
@@ -405,7 +419,7 @@ describe('goal_evidence sole writer', () => {
       { sessionID: 'sess-race' },
     );
     expect(out.content).toMatch(/busy|lease|Busy/i);
-    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+    expect(existsSync(resolveEvidencePath(dir, 'sess-race'))).toBe(false);
   });
   it('blocked goal rejects evidence with no write', async () => {
     const { existsSync } = await import('node:fs');
diff --git a/tests/v2-entry.test.ts b/tests/v2-entry.test.ts
index 3acf55e..3c6f6e2 100644
--- a/tests/v2-entry.test.ts
+++ b/tests/v2-entry.test.ts
@@ -75,7 +75,7 @@ describe('v2 setup wiring', () => {
       sessionID: 's1',
       prompt: { text: 'ship v2 entry' },
     });
-    const state = await loadGoalState(resolveStatePath(dir));
+    const state = await loadGoalState(resolveStatePath(dir, 's1'));
     expect(state?.objective).toBe('ship v2 entry');
     expect(state?.status).toBe('active');
     (cleanup as () => void)();
```
<!-- END_GIT_DIFF -->
