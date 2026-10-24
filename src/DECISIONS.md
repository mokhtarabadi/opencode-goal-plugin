# src — decisions

Sibling docs: `README.md` in this directory; the authoritative chronological log
is the root `DECISIONS.md`.

This file only indexes which root decision record governs which module, so a
reader inside `src/` finds the reasoning without leaving the folder.

| Decision                                         | Governs                                                      |
| ------------------------------------------------ | ------------------------------------------------------------ |
| ADR-001 file state owns truth                    | `state.ts`, `index.ts`                                       |
| ADR-002 claim-lock file serializes claimants     | `state.ts`                                                   |
| ADR-003 idle single-flight plus cooldown         | `loop.ts`, `limits.ts`                                       |
| ADR-004 compaction restore plus evidence gate    | `compaction.ts`, `evidence.ts`, `verifier.ts`                |
| ADR-005 host-native V2 export shape              | `index.ts`                                                   |
| ADR-006 hardening without contract break         | `state.ts`, `index.ts`, `loop.ts`                            |
| ADR-007 crash and error recovery                 | `loop.ts`, `watchdog.ts`, `index.ts`                         |
| ADR-008 agent-callable goal tools                | `tools.ts`                                                   |
| ADR-009 sole evidence writer                     | `tools.ts`, `evidence.ts`                                    |
| ADR-010 per-session state with legacy fallback   | `state.ts`, `evidence.ts`, `index.ts`, `tools.ts`, `loop.ts` |
| ADR-011 completion observes test results         | `proof.ts`, `verifier.ts`, `tools.ts`, `index.ts`            |
| ADR-012 set resets the evidence sidecar          | `tools.ts`, `index.ts`, `evidence.ts`                        |
| ADR-013 scoped evidence ends the legacy fallback | `evidence.ts`, `tools.ts`, `index.ts`                        |

## Local notes

- `proof.ts` exists only because a caller-declared exit code is not evidence.
  Any future change to the completion gate must keep the observation default on
  in `tryCompleteWithEvidence` and keep `verifyLocal` declare-only by default.
- The per-session path rule is enforced by one helper, `sanitizeSessionId` in
  `state.ts`. Do not build a session path by hand anywhere else.
