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
 * Phase 1 stub kept for compatibility.
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
declare const plugin: {
    name: string;
    version: string;
    getAvailableHooks: typeof getAvailableHooks;
    handleGoalCommand: typeof handleGoalCommand;
    handleIdleStub: typeof handleIdleStub;
    registerIdleHandler: typeof registerIdleHandler;
    defaultHasStopFile: typeof defaultHasStopFile;
    registerCompactionHandler: typeof registerCompactionHandler;
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

export { type MinimalHost, PLUGIN_NAME, PLUGIN_VERSION, type RegisterCompactionOptions, type RegisterIdleOptions, plugin as default, defaultHasStopFile, getAvailableHooks, handleGoalCommand, handleIdleStub, registerCompactionHandler, registerIdleHandler };
