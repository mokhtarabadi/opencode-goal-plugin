/**
 * Compaction snapshot plus restore Phase 3.
 * Why this module exists: memory dies on compaction, file state must resume cleanly.
 * Snapshot never sends and restore never claims: the next idle tick decides alone.
 */
import type { Clock } from './state.js';

/** Minimal load and save surface needed for restore, kept narrow for tests. */
export interface CompactionStore {
  loadState(statePath: string): Promise<unknown>;
  saveState(statePath: string, state: unknown): Promise<void>;
}

/** Summary returned to logs after snapshot or restore. */
export interface CompactionSummary {
  iterationCount: number;
  lastTurnAtMs: number;
  lastContinuedMessageId: string;
  restoreCount: number;
}

/**
 * Snapshot before compaction: flush hot state to disk, never send.
 * @param statePath absolute goal state path
 * @param clock injected clock for updatedAtMs
 * @param store load and save functions
 */
export async function snapshotForCompaction(
  statePath: string,
  clock: Clock,
  store: CompactionStore,
): Promise<CompactionSummary | null> {
  const raw = (await store.loadState(statePath)) as Record<
    string,
    unknown
  > | null;
  if (raw === null) return null;
  const now = clock.nowMs();
  const next: Record<string, unknown> = { ...raw, updatedAtMs: now };
  await store.saveState(statePath, next);
  return {
    iterationCount:
      typeof next['iterationCount'] === 'number'
        ? (next['iterationCount'] as number)
        : 0,
    lastTurnAtMs:
      typeof next['lastTurnAtMs'] === 'number'
        ? (next['lastTurnAtMs'] as number)
        : 0,
    lastContinuedMessageId:
      typeof next['lastContinuedMessageId'] === 'string'
        ? (next['lastContinuedMessageId'] as string)
        : '',
    restoreCount:
      typeof next['restoreCount'] === 'number'
        ? (next['restoreCount'] as number)
        : 0,
  };
}

/**
 * Build a short evidence nudge for context injection.
 * Why this helper exists: goal-loop pattern shows bare completions need
 * targeted correction text re-injected each turn. Pure so tests never touch disk.
 * @param objective active objective text
 * @param pendingVerification true when verifier is still running
 */
export function buildEvidenceNudge(
  objective: string,
  pendingVerification: boolean,
): string {
  // Null guard plus truncate: long objectives must not bloat every model request.
  // Non-string input still returns a non-empty nudge, never throws into hooks.
  const raw = typeof objective === 'string' ? objective : '';
  const clean =
    raw.trim().length > 0 ? raw.trim().slice(0, 500) : 'active goal';
  // Keep one line, non-empty always: context hook appends it verbatim.
  const base =
    'Evidence required to complete "' +
    clean +
    '": cite files plus passing tests.';
  // Pending flag adds pause wording without stopping the goal.
  if (pendingVerification === true) {
    return base + ' Verification pending, hold auto turns until proof lands.';
  }
  return (
    base + ' Call /goal complete only with proof, or /goal block <reason>.'
  );
}

/**
 * Prune stale idle controllers while keeping the live subscriber.
 * Why this helper exists: compaction must clear dead listeners without
 * killing auto-continue. Copy-iterate avoids skip-during-delete fragility
 * when a Set is mutated during iteration. Pure and sync for testability.
 * @param controllers tracked abort controllers
 * @param live active controller that must survive
 */
export function pruneIdleControllers(
  controllers: Set<{ abort: () => void }>,
  live: { abort: () => void },
): void {
  // Copy first: deleting during direct Set iteration can skip entries.
  for (const c of [...controllers]) {
    if (c === live) continue;
    try {
      c.abort();
    } catch {
      // One bad abort never blocks compaction.
    }
    controllers.delete(c as never);
  }
  (controllers as Set<unknown>).add(live as unknown as never);
}

/**
 * Restore after compaction or resume: reload file state, bump restoreCount, keep cooldown.
 * Never claims a lease and never sends. Next idle tick decides.
 * @param statePath absolute goal state path
 * @param clock injected clock
 * @param store load and save functions
 */
export async function restoreAfterCompaction(
  statePath: string,
  clock: Clock,
  store: CompactionStore,
): Promise<CompactionSummary | null> {
  const raw = (await store.loadState(statePath)) as Record<
    string,
    unknown
  > | null;
  if (raw === null) return null;
  const now = clock.nowMs();
  const prev =
    typeof raw['restoreCount'] === 'number'
      ? (raw['restoreCount'] as number)
      : 0;
  // Safety clamp: a last-turn time in the future relative to this process clock would break budgets.
  const last =
    typeof raw['lastTurnAtMs'] === 'number'
      ? (raw['lastTurnAtMs'] as number)
      : 0;
  const clampedLast = last > now ? now : last;
  const next: Record<string, unknown> = {
    ...raw,
    restoreCount: prev + 1,
    lastTurnAtMs: clampedLast,
    updatedAtMs: now,
  };
  await store.saveState(statePath, next);
  return {
    iterationCount:
      typeof next['iterationCount'] === 'number'
        ? (next['iterationCount'] as number)
        : 0,
    lastTurnAtMs: clampedLast,
    lastContinuedMessageId:
      typeof next['lastContinuedMessageId'] === 'string'
        ? (next['lastContinuedMessageId'] as string)
        : '',
    restoreCount: prev + 1,
  };
}
