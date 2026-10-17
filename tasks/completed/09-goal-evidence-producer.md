# Task 09: Goal completion is unreachable — no evidence producer

**File:** `tasks/qa/09-goal-evidence-producer.md`
**Status:** in-progress
**Source:** manager
**Type:** feature
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Host:** opencode v2.0.29
**Priority:** High (blocks every goal completion)

## Goal

Make `goal_complete` reachable by adding an evidence-producing path, without weakening the verifier gate.

## Problem

`goal_complete` can never succeed. The verifier gate (`tryCompleteWithEvidence`
in `src/verifier.ts`) requires a non-empty evidence sidecar, but no code path
in the plugin ever writes criteria into it:

- `src/index.ts` seeds an EMPTY shell on set (`emptyEvidence`, criteria `[]`).
- The four tools (`goal_set`, `goal_block`, `goal_complete`, `goal_resume` in
  `src/tools.ts`) contain no evidence-writing tool — `toolComplete` only READS.
- `src/loop.ts` and `src/goal.ts` never append criteria (`saveEvidence` has no
  other caller).
- `docs/AGENT-TOOLS.md` forbids writing `.opencode/goal-evidence.json` with
  file tools, closing the only remaining path.

Net: `goal_complete` always returns `evidence-required`, for every goal, forever.
Found live 2026-10-17 while three completed work goals (analytics 921/923/924
in the sibling project) could not be closed.

## Evidence

- `src/verifier.ts` → `verifyLocal`: `evidence === null` gives `missing-evidence`;
  `tryCompleteWithEvidence` maps it to `evidence-required`.
- `src/evidence.ts` → `validateEvidenceShape` rejects empty criteria (`evidence-empty`).
- `src/tools.ts` `toolComplete` (~line 232): load-only, no write path.
- `src/index.ts` (~line 600): seeds empty shell, nothing fills it.
- `docs/AGENT-TOOLS.md` constraint 5: file-tool writes forbidden, "always go
  through these four tools" — but none of the four writes evidence.

## Proposed fix (suggestion, owner decides)

Add a fifth agent-callable tool, e.g. `goal_evidence`, that appends one
criterion `{id, claim, files[], tests[{command, exitCode}]}` to the sidecar
through the same lease + `saveEvidence` path, so the existing verifier gate
stays in force and the "never write state files by hand" rule keeps holding.
Plus a `/goal evidence` slash-lane mirror and a test proving set → evidence →
complete passes.

## Acceptance Criteria

- [ ] A goal can go set → evidence → complete with QA-style proof attached.
- [ ] Empty/fabricated evidence still blocked (verifier unchanged or stricter).
- [ ] Lease + validation + gate semantics preserved for the new tool.

## Local TODOs

- [ ] Read evidence/verifier/goal/tool sources (discovery)
- [ ] Brain planning round + manager approval
- [ ] Implement `goal_evidence` tool + `/goal evidence` slash mirror
- [ ] Add set → evidence → complete test
- [ ] Typecheck + full tests + CHANGELOG + stage + move to qa

## Execution Log & Reasoning

- Task created 2026-10-17 from live dead-end diagnosis. Owner fixes.
- Task moved backlog → in-progress (untracked, filesystem mv); header synced; lint passes.
- Memory bootstrap: no namespaces, skipped gracefully. No stack skill matches
  this repo (Node TS plugin, no framework); skill auto-load matrix miss logged.
- Seat Check: domains → tool contract + JSON Schema + slash parsing → Software
  Architect. Skipped: Designer (no visual surface), Senior Programmer (no
  loop/race change), Planner/Strategist (single feature), QA/Reviewer (later
  gates). Trigger eval: Architect fires on schema + contract; Programmer and
  Designer miss. Brainstorm: not required — single-domain additive, reversible.
- Brain plan verdict (task_id 9, Architect seat): APPROVED-DESIGN — fifth tool
  `goal_evidence` as sole evidence writer, slash mirror `/goal evidence`
  block-style args, state-file lease reuse, null evidence → empty list, dup id
  hard reject, shape-only validation at write (existence stays in verifier),
  verifier untouched. XML withheld pending manager approval.
- Assumption A1: `required: [id, claim]`, files/tests optional at write time
  (verifier still demands them at complete). A2: writes rejected unless goal
  is active.
- Implementation done from Brain XML (Senior Programmer, bare re-emit retry).
  Order: goal.ts schema + parser, tools.ts recordEvidence + fifth def, index.ts
  slash branch delegating to the tool handler, docs (goal.md, AGENT-TOOLS.md
  Tool 5 + four→five), tests, CHANGELOG + ADR-009.
- Repair R1 (only failure, fixed same session): first run failed 2 tests with
  `Invalid evidence shape: criterion-missing-files` — full-file
  validateEvidenceShape plus loadEvidence-null-on-invalid-shape force non-empty
  files/tests at write time. Correction: files + tests required (minItems 1)
  in schema, parser, and handler; existence + passing stay verifier-side.
  Re-ran: 135/135 green. No verifier or evidence module change.
- Enforcement check: new tool is the sole append path; file-tool writes to the
  sidecar stay forbidden per AGENT-TOOLS.md constraint 5.
- QA_REJECTED (autopilot round 1): V1 slash `tests=npm test:` coerced empty
  code to exitCode 0 via Number(''); V2 tool stored files untrimmed vs slash
  trimmed; V3 tool silently dropped bad array entries. Hotfix: empty codeRaw
  rejects in parseGoalEvidence; recordEvidence trims and rejects any bad
  entry whole-call; 8 new negative tests (empty/spaces code, bare slash,
  empty arrays, partial bad entries, trim parity, fabricated citation block,
  post-complete reject). Verifier and evidence modules untouched.

## Verification Evidence

- Command: `rtk test npm test` | Expected: all pass | Actual: 15 files, 135 tests passed | Exit: 0.
- Command: `npx tsc --noEmit` | Expected: clean | Actual: clean | Exit: 0.
- Command: `npx prettier --check src/goal.ts src/tools.ts src/index.ts tests/tools.test.ts` | Expected: clean | Actual: clean | Exit: 0 (after --write on two files).
- Command: `npm run compile` (tsup bundle check) | Expected: success | Actual: success, dist removed after (gitignored) | Exit: 0.
- Stack-skill gate skip record: root dot, markers package.json + tsconfig.json scanned, matched none (Node TS plugin, no framework marker), reason no stack skill in registry; generic tsc + vitest + prettier gates run instead.
- Adaptations to XML (logged, no halt): task file is `09-goal-evidence-producer.md` (not `...-tool.md`); file already in-progress so backlog `git mv` step skipped; `npx eslint` skipped (no eslint config in repo); `npm run build` has no such script — `npm run compile` used instead.
- Hotfix round: `rtk test npm test` | Expected: all pass | Actual: 15 files, 143 tests passed (135 + 8 new) | Exit: 0. `npx tsc --noEmit` clean. Prettier clean after --write.
- Re-QA verdict (autopilot, task_id 9): QA_PASSED — V1/V2/V3 closed, 143 green, verifier untouched. Code Reviewer technical approval: sole-writer + parity + gate unchanged, no blocking issues. Status: PO_REVIEW_PENDING — closure awaits the explicit Manager word.

## Risk & Rollback

- Risk: new write path could weaken the completion gate. Mitigation: reuse
  existing `saveEvidence` + `validateEvidenceShape` + lease helpers unchanged;
  verifier untouched.
- Rollback: revert tool registration + slash branch; sidecar file is per-project
  runtime state (gitignored), no migration involved.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index f0e6eb5..9f1c124 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -16,6 +16,7 @@ All notable changes follow Keep a Changelog.
 - V2 strictness with goal input JSON Schema plus traversal-safe title check.
 - Crash recovery: session.error plus execution.failed listeners, classifyFailure, 90s watchdog, session-start rearm, retryable send, persisted pendingAttempt.
 - Agent-callable goal tools (goal_set, goal_block, goal_complete, goal_resume) calling pure helpers directly with lease guard and slash-identical messages.
+- Fifth agent tool goal_evidence (sole evidence writer) plus /goal evidence slash mirror: set to evidence to complete is now reachable with the verifier gate unchanged.
 
 ### Fixed
 
@@ -28,6 +29,7 @@ All notable changes follow Keep a Changelog.
 - Hotfix idle survival: compaction keeps live controller, stale entries cleared.
 - Hotfix evidence wiring: both complete lanes require proof plus wrapupSent once.
 - Hotfix setup guard plus session fairness plus lease proof with sidecar.
+- Hotfix evidence validation: slash rejects empty exit codes (Number('') coerces to 0); tool trims file entries and rejects partial bad files/tests arrays instead of silently dropping.
 - Hotfix2 afterSend Clock plus Set copy plus prune helper plus drive-relative guard.
 
 ## [0.3.0] - 2026-10-16
diff --git a/DECISIONS.md b/DECISIONS.md
index 5eb9af3..908300b 100644
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -33,3 +33,8 @@ Rollback: revert this slice; the pure loop plus file state keep prior idle-only
 
 Context: the model could only be driven by user slash commands or the idle loop; smart-compact showed an agent tool lane (compact_context) reusing command helpers. Decision: register goal_set, goal_block, goal_complete, goal_resume via ctx.tool.transform in new src/tools.ts, each execute calling the pure goal.js helpers directly with validated data (never rebuilding slash strings, so reserved-word titles cannot misroute), claiming the file lease under owner tool:<sessionID> before mutating, and returning handleGoalCommand-identical messages (parity-tested). Consequence: model-driven and user-driven paths share validation, evidence gate, Clock, and atomic save with zero drift, and parallel tool calls serialize instead of clobbering.
 Rollback: remove the registerGoalTools call; file state untouched.
+
+## ADR-009 2026-10-17 Sole evidence writer closes the completion loop
+
+Context: goal_complete could never succeed because no code path ever wrote criteria into the evidence sidecar (both lanes only read it). Decision: add goal_evidence as the fifth agent tool and sole evidence writer plus a /goal evidence slash mirror delegating to the same recordEvidence handler; id, claim, files, tests all required with shape-only validation at write (existence plus passing stay verifier-side); duplicate ids rejected; writes only on active goals under the state-file lease. Consequence: set to evidence to complete passes with real proof while empty or fabricated evidence still fails, and the verifier plus evidence modules are untouched.
+Rollback: remove the tool def plus the slash branch; the sidecar file is per-project runtime state, no migration involved.
diff --git a/commands/goal.md b/commands/goal.md
index a7b9b83..be9c423 100644
--- a/commands/goal.md
+++ b/commands/goal.md
@@ -7,16 +7,19 @@ Patterns:
 - /goal status shows current state
 - /goal block <reason> marks blocked
 - /goal complete marks complete (needs evidence)
+- /goal evidence id=<short-id> claim=<one-line claim> files=<a,b> tests=<cmd:exitCode> records one evidence criterion (sole evidence writer)
 - /goal resume re-activates a parked goal (interrupted or blocked)
 - /goal clear marks cleared
+  Example: /goal evidence id=build-pass claim=Build passes on a clean tree files=src/index.ts tests=npm test:0
   Idle auto-continue sends one prompt per idle tick. A provider error or a
   failed send re-arms a watchdog so an active goal resumes instead of stalling.
 
 ## Agent tools (same lane, no slash needed)
 
-The model can drive the goal itself via four tools sharing the slash helpers:
+The model can drive the goal itself via five tools sharing the slash helpers:
 
 - `goal_set {title}` same as /goal <objective>
 - `goal_block {reason}` same as /goal block <reason>
 - `goal_complete {}` same as /goal complete (evidence gate applies)
 - `goal_resume {}` same as /goal resume
+- `goal_evidence {id, claim, files[], tests[]}` same as /goal evidence (sole evidence writer)
diff --git a/docs/AGENT-TOOLS.md b/docs/AGENT-TOOLS.md
index 7ab3a34..2d12612 100644
--- a/docs/AGENT-TOOLS.md
+++ b/docs/AGENT-TOOLS.md
@@ -1,7 +1,7 @@
 # Goal Plugin — Agent Tool Manual
 
 Reader: you are an AI coding agent running inside OpenCode with the
-`opencode-goal-plugin` loaded. This file teaches you the four tools that
+`opencode-goal-plugin` loaded. This file teaches you the five tools that
 **you yourself** can call. It is not for the human operator. The human uses
 slash commands (`/goal ...`); you use the tools below. Both lanes write the
 same state file, so they never disagree.
@@ -76,8 +76,8 @@ It takes no arguments. If proof is missing you get:
 Complete blocked: <reason>. Add file citations plus passing tests to evidence.
 ```
 
-Do not retry blindly. Write the evidence first (or do the work that earns
-it), then call again. Success response:
+Do not retry blindly. Record the evidence first with `goal_evidence`
+(do the work that earns it), then call again. Success response:
 
 ```text
 Goal marked complete.
@@ -104,6 +104,33 @@ Success response:
 Goal resumed: <the objective text>
 ```
 
+## Tool 5 — goal_evidence
+
+Record proof for the active goal. This is the **sole evidence writer**:
+the only way proof ever enters `.opencode/goal-evidence.json`. One call
+appends one criterion; call it once per criterion you can prove.
+
+```json
+{
+  "id": "build-pass",
+  "claim": "Build passes on a clean tree",
+  "files": ["src/index.ts"],
+  "tests": [{ "command": "npm test", "exitCode": 0 }]
+}
+```
+
+Rules: `id` plus `claim` are required (non-empty, id max 200 chars,
+claim max 2000), plus at least one `files` entry and one `tests` entry —
+the stored sidecar always passes shape validation, so empties are rejected
+up front. File existence plus passing status are still checked at
+`goal_complete` time, so citations may point at work in progress.
+Requires an `active` goal; duplicate `id` values are rejected, so each
+criterion is recorded once. Same syntax as `/goal evidence`. Success response:
+
+```text
+Criterion recorded for <id>.
+```
+
 ## Responses you must handle
 
 Every tool can also return these. They describe state, not failure of the
@@ -133,7 +160,8 @@ Report this to the human. Do not invent state.
 2. `goal_complete` without evidence always fails. This is deliberate.
 3. Titles and reasons are literal data. Newlines, slashes, and words like
    `block`, `clear`, or `resume` inside them trigger nothing.
-4. All four schemas reject extra properties. Send exactly the fields shown.
+4. All five schemas reject extra properties. Send exactly the fields shown.
 5. Never write `.opencode/goal-state.json` or `.opencode/goal-evidence.json`
-   with file tools. Always go through these four tools, so the lease,
-   the validation, and the evidence gate stay in force.
+   with file tools. Always go through these five tools (`goal_evidence` is
+   the sole evidence writer), so the lease, the validation, and the
+   evidence gate stay in force.
diff --git a/src/goal.ts b/src/goal.ts
index 5240a3b..21c7c95 100644
--- a/src/goal.ts
+++ b/src/goal.ts
@@ -14,6 +14,13 @@ export type ParsedGoal =
   | { kind: 'block'; reason: string }
   | { kind: 'complete' }
   | { kind: 'resume' }
+  | {
+      kind: 'evidence';
+      id: string;
+      claim: string;
+      files: string[];
+      tests: { command: string; exitCode: number }[];
+    }
   | { kind: 'invalid'; raw: string };
 
 export const MAX_OBJECTIVE_LEN = 2000;
@@ -103,6 +110,19 @@ export function parseGoalCommand(rawInput: string): ParsedGoal {
       return { kind: 'invalid', raw: rawInput };
     return { kind: 'block', reason };
   }
+  if (
+    bodyLower.startsWith('evidence ') ||
+    bodyLower.startsWith('evidence\t') ||
+    bodyLower.startsWith('evidence\n')
+  ) {
+    // Block-style args: id plus claim required, files plus tests optional.
+    // Claim may contain spaces, so args split on known key boundaries.
+    return parseGoalEvidence(body.slice('evidence'.length).trim(), rawInput);
+  }
+  if (bodyLower === 'evidence') {
+    // Bare evidence names no criterion, so the write would be unactionable.
+    return { kind: 'invalid', raw: rawInput };
+  }
   if (body.length > MAX_OBJECTIVE_LEN) {
     return { kind: 'invalid', raw: rawInput };
   }
@@ -161,6 +181,127 @@ export const ResumeInputSchema = {
   additionalProperties: false,
 } as const;
 
+/**
+ * JSON Schema for the evidence tool input.
+ * Why this schema exists: goal_evidence is the sole writer of the evidence
+ * sidecar, so its shape must match EvidenceCriterion exactly. id, claim,
+ * files, plus tests are all required with at least one entry each, because
+ * loadEvidence drops sidecars that fail validateEvidenceShape and that
+ * shape rejects empty files plus tests. Existence plus passing checks still
+ * stay in the verifier at complete time — the writer checks shape only.
+ */
+export const EvidenceInputSchema = {
+  type: 'object',
+  properties: {
+    id: { type: 'string', minLength: 1, maxLength: 200 },
+    claim: { type: 'string', minLength: 1, maxLength: 2000 },
+    files: {
+      type: 'array',
+      minItems: 1,
+      items: { type: 'string', minLength: 1 },
+    },
+    tests: {
+      type: 'array',
+      minItems: 1,
+      items: {
+        type: 'object',
+        properties: {
+          command: { type: 'string', minLength: 1 },
+          exitCode: { type: 'integer' },
+        },
+        required: ['command', 'exitCode'],
+        additionalProperties: false,
+      },
+    },
+  },
+  required: ['id', 'claim', 'files', 'tests'],
+  additionalProperties: false,
+} as const;
+
+/** One evidence test proof as parsed from slash args. */
+export interface ParsedEvidenceTest {
+  /** Test command, non-empty. */
+  command: string;
+  /** Process exit code, integer. */
+  exitCode: number;
+}
+
+/**
+ * Extract one key=value arg from a block-style arg string.
+ * Why boundary matching: claim values may contain spaces, so args split on
+ * known key starts (id, claim, files, tests) rather than on whitespace.
+ * Returns the trimmed value or null when the key is absent.
+ * @param args raw arg string after the evidence keyword
+ * @param key one of id, claim, files, tests
+ */
+function extractArg(args: string, key: string): string | null {
+  // Key must start the string or follow whitespace, so a claim mentioning
+  // "files=" mid-sentence cannot hijack the parse.
+  const open = new RegExp('(?:^|\\s)' + key + '=').exec(args);
+  if (!open) return null;
+  const rest = args.slice(open.index + open[0].length);
+  const next = /(?:\s)(?:id|claim|files|tests)=/.exec(rest);
+  return (next ? rest.slice(0, next.index) : rest).trim();
+}
+
+/**
+ * Parse block-style evidence args into a ParsedGoal evidence kind.
+ * Format: id=<short-id> claim=<one-line claim> files=<a,b> tests=<cmd:code;...>.
+ * files splits on comma, tests splits on semicolon with command and exit code
+ * split on the LAST colon so commands containing colons survive.
+ * Shape-only: non-empty id plus claim plus at least one file plus at least
+ * one test. Existence plus passing checks stay in the verifier at complete
+ * time. files plus tests are mandatory (not defaulted) because the stored
+ * sidecar must always pass validateEvidenceShape, which rejects empties.
+ * @param args raw arg string after the evidence keyword
+ * @param rawInput original input for the invalid fallback
+ */
+export function parseGoalEvidence(args: string, rawInput: string): ParsedGoal {
+  const id = extractArg(args, 'id');
+  const claim = extractArg(args, 'claim');
+  // id plus claim are required and length-capped like title plus reason.
+  if (!id || !claim) return { kind: 'invalid', raw: rawInput };
+  if (id.length > 200 || claim.length > MAX_OBJECTIVE_LEN) {
+    return { kind: 'invalid', raw: rawInput };
+  }
+  const filesRaw = extractArg(args, 'files');
+  // files plus tests are mandatory: the stored sidecar must always pass
+  // validateEvidenceShape, which rejects empty arrays.
+  if (filesRaw === null || filesRaw === '') {
+    return { kind: 'invalid', raw: rawInput };
+  }
+  const files = filesRaw
+    .split(',')
+    .map((f) => f.trim())
+    .filter((f) => f.length > 0);
+  if (files.length === 0) {
+    return { kind: 'invalid', raw: rawInput };
+  }
+  const testsRaw = extractArg(args, 'tests');
+  if (testsRaw === null || testsRaw === '') {
+    return { kind: 'invalid', raw: rawInput };
+  }
+  const tests: ParsedEvidenceTest[] = [];
+  for (const part of testsRaw.split(';')) {
+    const item = part.trim();
+    if (item.length === 0) return { kind: 'invalid', raw: rawInput };
+    const colon = item.lastIndexOf(':');
+    if (colon <= 0) return { kind: 'invalid', raw: rawInput };
+    const command = item.slice(0, colon).trim();
+    // Empty code must reject: Number('') coerces to 0, which would forge
+    // a passing proof out of a trailing colon with no exit code.
+    const codeRaw = item.slice(colon + 1).trim();
+    if (codeRaw.length === 0) return { kind: 'invalid', raw: rawInput };
+    const code = Number(codeRaw);
+    if (command.length === 0 || !Number.isInteger(code)) {
+      return { kind: 'invalid', raw: rawInput };
+    }
+    tests.push({ command, exitCode: code });
+  }
+  if (tests.length === 0) return { kind: 'invalid', raw: rawInput };
+  return { kind: 'evidence', id, claim, files, tests };
+}
+
 /**
  * Validate a goal title against traversal plus absolute-path abuse.
  * Why this guard exists: evidence citations must stay inside the project.
diff --git a/src/index.ts b/src/index.ts
index 1489da0..d21fb00 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -40,7 +40,7 @@ import {
 } from './compaction.js';
 import { saveEvidence, emptyEvidence, loadEvidence } from './evidence.js';
 import { tryCompleteWithEvidence } from './verifier.js';
-import { registerGoalTools } from './tools.js';
+import { recordEvidence, registerGoalTools } from './tools.js';
 import {
   armWatchdog,
   clearWatchdog,
@@ -178,6 +178,21 @@ export async function handleGoalCommand(
     }
     return 'Goal marked blocked: ' + parsed.reason;
   }
+  if (parsed.kind === 'evidence') {
+    // Parity by construction: the slash lane calls the tool handler directly,
+    // so validation plus lease plus messages cannot drift between lanes.
+    return await recordEvidence(
+      projectDir,
+      clock,
+      {
+        id: parsed.id,
+        claim: parsed.claim,
+        files: parsed.files,
+        tests: parsed.tests,
+      },
+      'slash',
+    );
+  }
   if (parsed.kind === 'complete') {
     // Evidence gate: active goals need proof, blocked or done still report status.
     // Why order matters: legacy status error must surface first so existing
diff --git a/src/tools.ts b/src/tools.ts
index 09f9db5..6a0bf37 100644
--- a/src/tools.ts
+++ b/src/tools.ts
@@ -1,8 +1,8 @@
 /**
  * Agent-callable goal tools.
  * Why this module exists: the model needs to drive the goal itself mid-session
- * (set, block, complete, resume) without waiting for the user to type a slash
- * command. This mirrors the smart-compact `compact_context` tool pattern:
+ * (set, block, complete, resume, evidence) without waiting for the user to type
+ * a slash command. This mirrors the smart-compact `compact_context` tool pattern:
  * `ctx.tool.transform` with a JSON Schema input.
  * Each execute path calls the pure transition helpers in goal.js directly with
  * already-validated data — never by rebuilding a slash string, so a title
@@ -23,6 +23,7 @@ import {
 import {
   BlockInputSchema,
   CompleteInputSchema,
+  EvidenceInputSchema,
   GoalInputSchema,
   ResumeInputSchema,
   blockGoal,
@@ -31,7 +32,12 @@ import {
   resumeGoal,
   setObjective,
 } from './goal.js';
-import { loadEvidence } from './evidence.js';
+import {
+  emptyEvidence,
+  loadEvidence,
+  saveEvidence,
+  validateEvidenceShape,
+} from './evidence.js';
 import { tryCompleteWithEvidence } from './verifier.js';
 
 /** Host version stamped on tool-created state, matching the slash lane. */
@@ -228,6 +234,145 @@ async function toolBlock(
   }
 }
 
+/**
+ * Record one evidence criterion for the active goal.
+ * Why this function is exported: the slash lane calls it directly so both
+ * lanes share one write path with identical validation — parity by construction.
+ * Sole evidence writer: no other code path appends criteria.
+ * Why shape-only here: file existence plus passing tests are verified at
+ * complete time by the verifier, so a criterion citing work-in-progress
+ * files is storable but cannot complete until the proof is real.
+ * Order: active-goal check, then lease, then load-or-seed, then dup check,
+ * then shape check, then append plus save. Every rejection writes nothing.
+ * @param projectDir project root containing the .opencode dir
+ * @param clock injected clock
+ * @param input raw tool input with id, claim, files, tests
+ * @param sessionID lane id for the lease owner
+ */
+export async function recordEvidence(
+  projectDir: string,
+  clock: Clock,
+  input: unknown,
+  sessionID: string,
+): Promise<string> {
+  const raw = input as {
+    id?: unknown;
+    claim?: unknown;
+    files?: unknown;
+    tests?: unknown;
+  } | null;
+  const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
+  const claim = typeof raw?.claim === 'string' ? raw.claim.trim() : '';
+  // Strict arrays with trimmed storage: any bad entry rejects the whole call
+  // instead of silently dropping, so caller bugs cannot hide as success and
+  // stored files match the slash lane exactly (verifier checks exact paths).
+  const filesInput = Array.isArray(raw?.files) ? raw.files : null;
+  let files: string[] | null = null;
+  if (filesInput !== null) {
+    const out: string[] = [];
+    let bad = false;
+    for (const f of filesInput) {
+      if (typeof f !== 'string' || f.trim().length === 0) {
+        bad = true;
+        break;
+      }
+      out.push(f.trim());
+    }
+    files = bad ? [] : out;
+  }
+  const testsInput = Array.isArray(raw?.tests) ? raw.tests : null;
+  let tests: { command: string; exitCode: number }[] | null = null;
+  if (testsInput !== null) {
+    const out: { command: string; exitCode: number }[] = [];
+    let bad = false;
+    for (const t of testsInput) {
+      if (
+        typeof t !== 'object' ||
+        t === null ||
+        typeof (t as { command?: unknown }).command !== 'string' ||
+        ((t as { command?: unknown }).command as string).trim().length === 0 ||
+        !Number.isInteger((t as { exitCode?: unknown }).exitCode)
+      ) {
+        bad = true;
+        break;
+      }
+      out.push({
+        command: ((t as { command: string }).command as string).trim(),
+        exitCode: (t as { exitCode: number }).exitCode as number,
+      });
+    }
+    tests = bad ? [] : out;
+  }
+  // Shape check first: malformed input never touches state or lease.
+  // files plus tests need at least one entry each: the stored sidecar must
+  // always pass validateEvidenceShape, which rejects empty arrays.
+  // File existence plus passing tests stay verifier-side at complete time.
+  if (
+    id.length === 0 ||
+    id.length > 200 ||
+    claim.length === 0 ||
+    claim.length > 2000 ||
+    files === null ||
+    files.length === 0 ||
+    tests === null ||
+    tests.length === 0
+  ) {
+    return 'Invalid /goal evidence usage. Provide id=<id> claim=<claim> files=<a,b> tests=<cmd:exitCode>.';
+  }
+  const statePath = resolveStatePath(projectDir);
+  const loaded = await loadForTool(statePath);
+  if ('error' in loaded) return loaded.error;
+  if (loaded.state === null) {
+    return 'No goal set. Use /goal <objective> first.';
+  }
+  if (loaded.state.status !== 'active') {
+    return (
+      'Only an active goal can record evidence. Current status: ' +
+      loaded.state.status +
+      '.'
+    );
+  }
+  const owner = 'tool:' + sessionID;
+  const claimRes = await claimForTool(statePath, loaded.state, owner, clock);
+  if (!claimRes.claimed) return BUSY_MESSAGE;
+  try {
+    // Null sidecar (e.g. tool-lane set never seeded one) starts empty.
+    const current = (await loadEvidence(projectDir)) ?? emptyEvidence(0);
+    if (current.criteria.some((c) => c.id === id)) {
+      return 'Evidence id already recorded: ' + id + '.';
+    }
+    const candidate = {
+      version: current.version,
+      updatedAtMs: clock.nowMs(),
+      criteria: [
+        ...current.criteria,
+        {
+          id,
+          claim,
+          files,
+          tests: tests.map((t) => ({
+            command: t.command.trim(),
+            exitCode: t.exitCode,
+          })),
+        },
+      ],
+    };
+    // Full-file shape check reuses the verifier's own gate shape.
+    const shape = validateEvidenceShape(candidate);
+    if (!shape.ok) {
+      return 'Invalid evidence shape: ' + shape.reason + '.';
+    }
+    try {
+      await saveEvidence(projectDir, candidate);
+    } catch (err) {
+      return 'Failed to save evidence: ' + (err as Error).message;
+    }
+    return 'Criterion recorded for ' + id + '.';
+  } finally {
+    await releaseToolLease(statePath, owner, clock);
+  }
+}
+
 /**
  * Mark the active goal complete through the evidence gate.
  * Why gate order matches the slash lane: status errors surface before proof
@@ -326,8 +471,8 @@ async function toolResume(
 }
 
 /**
- * The four agent-callable goal tool definitions.
- * Why four separate tools: clearer prompts and least privilege beat one
+ * The five agent-callable goal tool definitions.
+ * Why five separate tools: clearer prompts and least privilege beat one
  * multi-action tool. Schemas live in goal.ts beside GoalInputSchema.
  */
 function goalToolDefs(projectDir: string, clock: Clock): GoalToolDef[] {
@@ -414,6 +559,26 @@ function goalToolDefs(projectDir: string, clock: Clock): GoalToolDef[] {
         }
       },
     },
+    {
+      name: 'goal_evidence',
+      description:
+        'Record one evidence criterion for the active goal. Sole evidence writer. Slash parity /goal evidence.',
+      input: EvidenceInputSchema,
+      execute: async (input: unknown, context: unknown) => {
+        try {
+          return {
+            content: await recordEvidence(
+              projectDir,
+              clock,
+              input,
+              toolSessionId(context),
+            ),
+          };
+        } catch {
+          return { content: 'Goal tool failed without changing state.' };
+        }
+      },
+    },
   ];
 }
 
diff --git a/tests/tools.test.ts b/tests/tools.test.ts
index 5883034..841255a 100644
--- a/tests/tools.test.ts
+++ b/tests/tools.test.ts
@@ -1,6 +1,6 @@
 /**
  * Tests for agent-callable goal tools.
- * Why these tests exist: prove the tool lane registers four tools and shares
+ * Why these tests exist: prove the tool lane registers five tools and shares
  * the exact slash handler, so model-driven and user-driven paths cannot drift.
  */
 import { describe, expect, it } from 'vitest';
@@ -11,6 +11,7 @@ import { registerGoalTools } from '../src/tools.js';
 import {
   BlockInputSchema,
   CompleteInputSchema,
+  EvidenceInputSchema,
   GoalInputSchema,
   ResumeInputSchema,
 } from '../src/goal.js';
@@ -45,7 +46,7 @@ function fakeCtx(defs: CapturedDef[]): unknown {
 }
 
 describe('registerGoalTools', () => {
-  it('registers four tools beside the slash lane', async () => {
+  it('registers five tools beside the slash lane', async () => {
     const defs: CapturedDef[] = [];
     const out = await registerGoalTools(
       fakeCtx(defs),
@@ -58,6 +59,7 @@ describe('registerGoalTools', () => {
       'goal_block',
       'goal_complete',
       'goal_resume',
+      'goal_evidence',
     ]);
     for (const d of defs) {
       expect(typeof d.description).toBe('string');
@@ -89,6 +91,15 @@ describe('tool schemas', () => {
     expect(CompleteInputSchema.additionalProperties).toBe(false);
     expect(ResumeInputSchema.additionalProperties).toBe(false);
   });
+  it('evidence requires id plus claim plus files plus tests and closes extra props', () => {
+    expect(EvidenceInputSchema.required).toEqual([
+      'id',
+      'claim',
+      'files',
+      'tests',
+    ]);
+    expect(EvidenceInputSchema.additionalProperties).toBe(false);
+  });
 });
 
 describe('tool execute parity with slash', () => {
@@ -279,4 +290,299 @@ describe('tool execute parity with slash', () => {
     );
     expect(toolBlock2.content).toBe(slashBlock2);
   });
+  it('evidence tool result matches slash result for the same op', async () => {
+    const { handleGoalCommand } = await import('../src/index.js');
+    const clock = new FakeClock();
+    const dirTool = mkdtempSync(path.join(tmpdir(), 'goal-tools-parE-'));
+    const dirSlash = mkdtempSync(path.join(tmpdir(), 'goal-tools-parES-'));
+    const defs = await toolDefs(dirTool);
+    await byName(defs, 'goal_set').execute({ title: 'parity-ev' }, {});
+    await handleGoalCommand('/goal parity-ev', dirSlash, clock);
+    const input = {
+      id: 'e1',
+      claim: 'parity holds',
+      files: ['src/a.ts'],
+      tests: [{ command: 'npm test', exitCode: 0 }],
+    };
+    const toolEv = await byName(defs, 'goal_evidence').execute(input, {});
+    const slashEv = await handleGoalCommand(
+      '/goal evidence id=e1 claim=parity holds files=src/a.ts tests=npm test:0',
+      dirSlash,
+      clock,
+    );
+    expect(toolEv.content).toBe(slashEv);
+    expect(toolEv.content).toContain('Criterion recorded for e1');
+  });
+});
+
+describe('goal_evidence sole writer', () => {
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
+  it('set to evidence to complete passes the gate with real proof', async () => {
+    const { writeFileSync } = await import('node:fs');
+    const { loadEvidence } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evok-'));
+    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'prove it' }, {});
+    const rec = await byName(defs, 'goal_evidence').execute(
+      {
+        id: 'e1',
+        claim: 'work is done',
+        files: ['proof.txt'],
+        tests: [{ command: 'npm test', exitCode: 0 }],
+      },
+      { sessionID: 'sess-ev' },
+    );
+    expect(rec.content).toContain('Criterion recorded for e1');
+    const ev = await loadEvidence(dir);
+    expect(ev?.criteria.map((c) => c.id)).toEqual(['e1']);
+    const done = await byName(defs, 'goal_complete').execute({}, {});
+    expect(done.content).toBe('Goal marked complete.');
+  });
+  it('hostile shape writes nothing', async () => {
+    const { existsSync } = await import('node:fs');
+    const { resolveEvidencePath } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evbad-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'baseline' }, {});
+    const bad = await byName(defs, 'goal_evidence').execute(
+      { id: '', claim: '' },
+      {},
+    );
+    expect(bad.content).toContain('Invalid');
+    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+  });
+  it('duplicate id is rejected with no second write', async () => {
+    const { loadEvidence } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evdup-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'dup' }, {});
+    const input = {
+      id: 'e1',
+      claim: 'first',
+      files: ['src/a.ts'],
+      tests: [{ command: 'npm test', exitCode: 0 }],
+    };
+    expect(
+      (await byName(defs, 'goal_evidence').execute(input, {})).content,
+    ).toContain('Criterion recorded');
+    const dup = await byName(defs, 'goal_evidence').execute(input, {});
+    expect(dup.content).toContain('already recorded');
+    expect((await loadEvidence(dir))?.criteria.length).toBe(1);
+  });
+  it('held lease blocks evidence write without changing state', async () => {
+    const { existsSync } = await import('node:fs');
+    const { tryClaimLease, resolveStatePath, LEASE_TTL_MS } =
+      await import('../src/state.js');
+    const { resolveEvidencePath } = await import('../src/evidence.js');
+    const clock = new FakeClock();
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evrace-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'baseline' }, {});
+    const held = await tryClaimLease(
+      resolveStatePath(dir),
+      'loop',
+      LEASE_TTL_MS,
+      clock,
+    );
+    expect(held.claimed).toBe(true);
+    const out = await byName(defs, 'goal_evidence').execute(
+      {
+        id: 'e1',
+        claim: 'racy',
+        files: ['src/a.ts'],
+        tests: [{ command: 'npm test', exitCode: 0 }],
+      },
+      { sessionID: 'sess-race' },
+    );
+    expect(out.content).toMatch(/busy|lease|Busy/i);
+    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+  });
+  it('blocked goal rejects evidence with no write', async () => {
+    const { existsSync } = await import('node:fs');
+    const { resolveEvidencePath } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evblk-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'stuck' }, {});
+    await byName(defs, 'goal_block').execute({ reason: 'wait' }, {});
+    const out = await byName(defs, 'goal_evidence').execute(
+      {
+        id: 'e1',
+        claim: 'late',
+        files: ['src/a.ts'],
+        tests: [{ command: 'npm test', exitCode: 0 }],
+      },
+      {},
+    );
+    expect(out.content).toContain('Only an active goal');
+    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+  });
+  it('no goal set reports status with no lease held', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-evnone-'));
+    const defs = await toolDefs(dir);
+    const out = await byName(defs, 'goal_evidence').execute(
+      {
+        id: 'e1',
+        claim: 'orphan',
+        files: ['src/a.ts'],
+        tests: [{ command: 'npm test', exitCode: 0 }],
+      },
+      {},
+    );
+    expect(out.content).toContain('No goal set');
+  });
+});
+
+describe('hotfix qa-reject negative paths', () => {
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
+  const good = {
+    id: 'e1',
+    claim: 'holds',
+    files: ['src/a.ts'],
+    tests: [{ command: 'npm test', exitCode: 0 }],
+  };
+  it('slash with empty exit code is invalid and writes nothing', async () => {
+    const { existsSync } = await import('node:fs');
+    const { handleGoalCommand } = await import('../src/index.js');
+    const { resolveEvidencePath } = await import('../src/evidence.js');
+    const clock = new FakeClock();
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe1-'));
+    await handleGoalCommand('/goal slash-ev', dir, clock);
+    const out = await handleGoalCommand(
+      '/goal evidence id=e-bad claim=x files=src/a.ts tests=npm test:',
+      dir,
+      clock,
+    );
+    expect(out).toContain('Invalid');
+    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+  });
+  it('slash with spaces-only exit code is invalid and writes nothing', async () => {
+    const { existsSync } = await import('node:fs');
+    const { handleGoalCommand } = await import('../src/index.js');
+    const { resolveEvidencePath } = await import('../src/evidence.js');
+    const clock = new FakeClock();
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe1b-'));
+    await handleGoalCommand('/goal slash-ev', dir, clock);
+    const out = await handleGoalCommand(
+      '/goal evidence id=e-bad claim=x files=src/a.ts tests=npm test:  ',
+      dir,
+      clock,
+    );
+    expect(out).toContain('Invalid');
+    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+  });
+  it('bare slash evidence is invalid and writes nothing', async () => {
+    const { existsSync } = await import('node:fs');
+    const { handleGoalCommand } = await import('../src/index.js');
+    const { resolveEvidencePath } = await import('../src/evidence.js');
+    const clock = new FakeClock();
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe2-'));
+    await handleGoalCommand('/goal slash-ev', dir, clock);
+    const out = await handleGoalCommand('/goal evidence', dir, clock);
+    expect(out).toContain('Invalid');
+    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+  });
+  it('tool rejects empty files or empty tests arrays with no write', async () => {
+    const { existsSync } = await import('node:fs');
+    const { resolveEvidencePath } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe3-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'base' }, {});
+    const noFiles = await byName(defs, 'goal_evidence').execute(
+      { ...good, files: [] },
+      {},
+    );
+    expect(noFiles.content).toContain('Invalid');
+    const noTests = await byName(defs, 'goal_evidence').execute(
+      { ...good, tests: [] },
+      {},
+    );
+    expect(noTests.content).toContain('Invalid');
+    expect(existsSync(resolveEvidencePath(dir))).toBe(false);
+  });
+  it('tool rejects partial bad entries instead of silently dropping', async () => {
+    const { loadEvidence } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe3b-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'base' }, {});
+    const badFile = await byName(defs, 'goal_evidence').execute(
+      { ...good, files: ['src/a.ts', 42] },
+      {},
+    );
+    expect(badFile.content).toContain('Invalid');
+    const badTest = await byName(defs, 'goal_evidence').execute(
+      { ...good, tests: [{ command: '', exitCode: 0 }] },
+      {},
+    );
+    expect(badTest.content).toContain('Invalid');
+    expect(await loadEvidence(dir)).toBeNull();
+  });
+  it('tool trims spaced file entries to match the slash lane', async () => {
+    const { loadEvidence } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe4-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'base' }, {});
+    const out = await byName(defs, 'goal_evidence').execute(
+      { ...good, files: ['  src/a.ts  '] },
+      {},
+    );
+    expect(out.content).toContain('Criterion recorded');
+    expect((await loadEvidence(dir))?.criteria[0].files).toEqual(['src/a.ts']);
+  });
+  it('fabricated file citation cannot complete', async () => {
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe5-'));
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'fake' }, {});
+    const rec = await byName(defs, 'goal_evidence').execute(
+      { ...good, files: ['src/does-not-exist.ts'] },
+      {},
+    );
+    expect(rec.content).toContain('Criterion recorded');
+    const done = await byName(defs, 'goal_complete').execute({}, {});
+    expect(done.content).not.toContain('Goal marked complete');
+    expect(done.content).toContain('blocked');
+  });
+  it('evidence after complete rejects with no second write', async () => {
+    const { writeFileSync } = await import('node:fs');
+    const { loadEvidence } = await import('../src/evidence.js');
+    const dir = mkdtempSync(path.join(tmpdir(), 'goal-tools-qe6-'));
+    writeFileSync(path.join(dir, 'proof.txt'), 'done\n');
+    const defs = await toolDefs(dir);
+    await byName(defs, 'goal_set').execute({ title: 'fin' }, {});
+    await byName(defs, 'goal_evidence').execute(
+      {
+        ...good,
+        id: 'e1',
+        files: ['proof.txt'],
+      },
+      {},
+    );
+    expect((await byName(defs, 'goal_complete').execute({}, {})).content).toBe(
+      'Goal marked complete.',
+    );
+    const late = await byName(defs, 'goal_evidence').execute(
+      { ...good, id: 'e2' },
+      {},
+    );
+    expect(late.content).toContain('Only an active goal');
+    expect((await loadEvidence(dir))?.criteria.length).toBe(1);
+  });
 });
```
<!-- END_GIT_DIFF -->
