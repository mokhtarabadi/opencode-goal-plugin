# Task 14: A blocked completion must name what failed, and a proof command must be able to carry its own environment

**File:** `tasks/completed/14-blocked-message-and-test-env.md`
**Status:** closed
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
**Factual Git Diff:** Stored in Commit Hash: `e34b0c36a5a33063949d05b8d32a699e4bf12e67`
<!-- END_GIT_DIFF -->
