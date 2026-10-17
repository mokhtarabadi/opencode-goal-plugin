# Task 09: Goal completion is unreachable — no evidence producer

**File:** `tasks/completed/09-goal-evidence-producer.md`
**Status:** closed
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
- Closure: re-QA QA_PASSED and reviewer technical approval recorded as PO_REVIEW_PENDING above; manager approval "Approved for closure" observed; file moved qa → completed; sibling docs unchanged (pure move, skip logged).

## Risk & Rollback

- Risk: new write path could weaken the completion gate. Mitigation: reuse
  existing `saveEvidence` + `validateEvidenceShape` + lease helpers unchanged;
  verifier untouched.
- Rollback: revert tool registration + slash branch; sidecar file is per-project
  runtime state (gitignored), no migration involved.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `e2a852c49fdf561c4e01a1dc9237c55b359941a6`
<!-- END_GIT_DIFF -->
