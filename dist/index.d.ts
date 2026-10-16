import { Plugin } from '@opencode/plugin';

/** Clock abstraction to keep business logic mockable. */
interface Clock {
    nowMs(): number;
}

/**
 * Budget limits Phase 2.
 * Why this module exists: bounds auto-continue so the idle loop cannot run forever.
 * All values are plain numbers, no wall-time reads here.
 */

/** Tunable budget for one goal. */
interface Limits {
    /** Minimum ms between auto turns, stops tight idle loops. */
    minDelayMs: number;
    /** Maximum auto turns per goal, then the loop stops. */
    maxTurns: number;
    /** Maximum wall ms per goal measured from createdAtMs. */
    maxWallMs: number;
}

declare const PLUGIN_NAME = "opencode-goal-plugin";
declare const PLUGIN_VERSION = "0.2.0";
/** Minimal host shape, all fields optional so probing never throws. */
interface MinimalHost {
    version?: unknown;
    registerCommand?: unknown;
    onIdle?: unknown;
    onCompact?: unknown;
    onSessionEnd?: unknown;
}
/**
 * Probe available hooks without throwing.
 * @param host unknown host object from OpenCode V2
 */
declare function getAvailableHooks(host: unknown): string[];
/**
 * Handle a slash goal command against file state.
 * Every failure returns a friendly string, never throws.
 * @param rawInput raw input like /goal ship feature
 * @param projectDir project root containing the .opencode dir
 * @param clock injected clock, defaults to SystemClock
 * @param hostVersion host version string for audit
 */
declare function handleGoalCommand(rawInput: string, projectDir: string, clock?: Clock, hostVersion?: string): Promise<string>;
/**
 * Legacy probe stub kept for compatibility with earlier tests.
 */
declare function handleIdleStub(): string;
/** Options for idle registration. */
interface RegisterIdleOptions {
    projectDir: string;
    getLastMessageId: () => string | null;
    sendPrompt: (prompt: string) => Promise<{
        messageId: string;
        tokenSpend?: number;
    }>;
    clock?: Clock;
    limits?: Limits;
    ownerId?: string;
}
/**
 * Build a stop-file checker for one project dir.
 * @param projectDir project root containing the .opencode dir
 */
declare function defaultHasStopFile(projectDir: string): () => Promise<boolean>;
/**
 * Register the idle handler only when the host supports onIdle, fail closed otherwise.
 * @param host unknown host object from OpenCode V2
 * @param opts project dir plus host callbacks
 */
declare function registerIdleHandler(host: unknown, opts: RegisterIdleOptions): {
    registered: boolean;
    reason: string;
};
/** Options for compaction registration. */
interface RegisterCompactionOptions {
    projectDir: string;
    clock?: Clock;
}
/**
 * Register compaction snapshot plus resume handlers when the host supports them.
 * Probes onCompact plus onSessionResume plus onSessionStart and fails closed
 * with a reason when none exist. Snapshot and restore never send and never claim.
 * @param host unknown host object from OpenCode V2
 * @param opts project dir plus optional clock
 */
declare function registerCompactionHandler(host: unknown, opts: RegisterCompactionOptions): {
    registered: boolean;
    reason: string;
};
/**
 * Build the work instruction posted when a goal is set through the V2 command.
 * The instruction carries the objective plus the stop verbs so the agent loop
 * knows how to report done, stuck, or cancelled.
 * @param objective active objective text
 * @param iterationCount current turn count for context
 */
declare function buildGoalWorkInstruction(objective: string, iterationCount: number): string;
/**
 * Resolve the project directory for file state from a V2 context.
 * Falls back to the process working directory when the host gives none.
 * @param ctx unknown V2 plugin context
 */
declare function resolveProjectDir(ctx: unknown): string;
/**
 * OpenCode V2 plugin definition. The host loader validates this exact shape:
 * a default export with an id plus a setup function.
 */
declare const _default: Plugin.Plugin;

export { type MinimalHost, PLUGIN_NAME, PLUGIN_VERSION, type RegisterCompactionOptions, type RegisterIdleOptions, buildGoalWorkInstruction, _default as default, defaultHasStopFile, getAvailableHooks, handleGoalCommand, handleIdleStub, registerCompactionHandler, registerIdleHandler, resolveProjectDir };
