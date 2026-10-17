# Task 08: Agent-Callable Goal Tools

**File:** `tasks/completed/08-agent-callable-goal-tools.md`
**Status:** closed
**Source:** manager
**Type:** feature
**Project:** /home/mohammad/Develop/Projects/opencode-goal-plugin
**Host:** opencode v2.0.29
**Mode:** autopilot-locked (Manager locked autopilot for QA-through-review; closure still needs the explicit word)

## Goal

Expose agent-callable tools (like smart-compact's `compact_context` tool) so the model itself can drive the goal mid-session without a slash command: report progress, block with reason, complete with evidence. Both paths write the same file state so they cannot drift.

## Seat Check

Domains → seats: tool contract plus JSON Schema plus API design → Software Architect. Skipped: UI/UX Designer (no visual surface), Senior Programmer (no loop or race change expected; tools reuse the existing guarded handler paths), Project Planner plus Sprint Strategist (single feature), QA Engineer plus Code Reviewer (later gates). Trigger eval TITLE+BODY: Architect fires on schema plus contract plus API design; Programmer miss (no flaky, race, deadlock, silent-fail, or performance words); Designer miss. Single-seat planning call.

## Brainstorm

Brainstorm: not required — single-domain additive tool registration, fully reversible by removing the registration.

## Plan Steps (to approve)

1. Register tools via `ctx.tool.transform` with JSON Schema inputs, reusing the existing command helpers so both paths cannot drift.
2. Route tool execution through the same guarded state paths (lease, evidence gate, Clock, atomic write).
3. Tests plus docs sync plus QA transition.

## Acceptance Criteria

- [x] Tools registered via `ctx.tool.transform` with JSON Schema (progress, block, complete)
- [x] Tool execution reuses command helpers, no drift between paths
- [x] Lease plus evidence gate plus Clock invariants hold on the tool path
- [x] Full suite green plus typecheck plus prettier

## Local TODOs

- [ ] Brain plan approval
- [ ] Implementation via brain XML
- [ ] QA plus review plus closure

## Risk & Rollback

Risk is model misuse of completion without evidence, contained by reusing the evidence gate. Rollback is removal of the tool registration; file state untouched.

## Brain Plan Verdict (task_id 08)

Architect plan received: four tools (`goal_set`, `goal_block`, `goal_complete`, `goal_resume`) in new `src/tools.ts` via `ctx.tool.transform`, reusing `goal.ts:162/183/206` plus `verifier.ts:181`, registered in `setup()` beside `src/index.ts:542-544`. Step 0 resolves host tool-type shape from `node_modules`. Brainstorm not required. Awaiting Manager Approved.

## Execution Log & Reasoning

- Step 0 host API resolved from installed types: `ctx.tool.transform` plus `editor.add`, `execute(input, context)` with `context.sessionID`, plain JSON Schema inputs, `{content}` results.
- Design: tools call pure goal.js helpers directly with validated data (never rebuilding slash strings, so reserved-word titles cannot misroute); lease claimed under owner tool:<sessionID> before mutating, released after; messages identical to handleGoalCommand (parity-tested).
- New `src/tools.ts` with `registerGoalTools` fail-closed probing; wired in `setup()` beside slash registration; schemas exported from `src/goal.ts` (ResumeInputSchema is an independent literal); 16 tests in `tests/tools.test.ts` covering reserved-word titles, newline injection, hostile snapshots, session and project isolation, lease-held backoff, and tool/slash message parity; docs mirrored in `commands/goal.md`, `README.md`, `DECISIONS.md` (ADR-008), `CHANGELOG.md`.
- Hotfix (QA round 1): V1 direct-helper routing, V2 sessionID in lease owner, V3 lease claim with busy backoff, V4 preserved handler messages with generic text only on unexpected throw, V5 independent resume schema.
- Re-QA verdict: QA_PASSED (127 tests green plus typecheck clean).
- Review verdict: PO_REVIEW_PENDING with technical approval, low issues only (hardcoded host version, first-set lease bypass documented).
- Manager accept quote: Approved for closure.
- Stack gate skip record: root=. markers=[package.json] matched=[] reason=no stack marker found.

## Verification Evidence

- Command: rtk test npm test | Expected: all pass | Actual: 15 files 127 tests passed | Exit: 0.
- Command: npx tsc --noEmit | Expected: exit 0 | Actual: exit 0 clean | Exit: 0.
- Command: npx prettier --check src/tools.ts src/index.ts src/goal.ts tests/tools.test.ts | Expected: exit 0 | Actual: exit 0 | Exit: 0.
- Hotfix verification: reserved-word title, newline injection, hostile snapshot, session/project isolation, lease-held backoff, tool/slash parity all green.

- Step 0 host API resolved from installed `node_modules/@opencode/plugin` types (promise flavor): `ctx.tool.transform((editor) => ...)` with `editor.add({name, description, input, execute})`; `execute(input, context)` where `context.sessionID: Session.ID` (`@opencode/schema/dist/tool.d.ts:10-17`); input accepts plain `JsonSchema.JsonSchema`; result `{content: string}` valid. Lane id field is `context.sessionID`, same name as slash `invocation.sessionID`.
- Design decision: tools delegate to `handleGoalCommand` (the exact slash function), so validation, evidence gate, Clock, and atomic save are shared with zero drift. No lease claim on the tool path, matching the slash path: saves are atomic tmp+rename and tools never send prompts, so no double-send risk exists.

- Manager request: same dual-trigger pattern as smart-compact (user slash plus agent tool).
- Memory bootstrapping: no memory namespaces found, index missing, skipped gracefully.

## Verification Evidence

- Command: pending | Expected: pending | Actual: pending | Exit: pending.

## Factual Git Diff

- Pending.

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `155f8e41835f51f026864d619bfc3ac3b1d8bc34`
<!-- END_GIT_DIFF -->
