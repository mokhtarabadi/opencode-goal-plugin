// src/index.ts
import * as path2 from "path";
import { promises as fs2 } from "fs";

// src/state.ts
import { promises as fs } from "fs";
import * as path from "path";
var SystemClock = class {
  nowMs() {
    return Date.now();
  }
};
var STATE_FILENAME = "goal-state.json";
var LEASE_TTL_MS = 12e4;
function resolveStatePath(projectDir) {
  return path.join(projectDir, ".opencode", STATE_FILENAME);
}
function initialState(objective, clock, hostVersion) {
  const trimmed = objective.trim();
  if (trimmed.length === 0) {
    throw new Error("objective must be non-empty");
  }
  const now = clock.nowMs();
  return {
    objective: trimmed,
    status: "active",
    iterationCount: 0,
    tokenSpend: 0,
    wallTimeMs: 0,
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    lastSummary: "",
    createdAtMs: now,
    updatedAtMs: now,
    hostVersion,
    lastTurnAtMs: 0,
    lastContinuedMessageId: "",
    restoreCount: 0,
    evidencePath: "",
    evidenceHash: null,
    pendingVerification: false,
    verificationFailReason: null,
    revisionCount: 0
  };
}
function isValidState(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  if (typeof v["objective"] !== "string" || v["objective"].length === 0)
    return false;
  if (v["status"] !== "active" && v["status"] !== "complete" && v["status"] !== "blocked" && v["status"] !== "cleared")
    return false;
  if (typeof v["iterationCount"] !== "number") return false;
  if (typeof v["tokenSpend"] !== "number") return false;
  if (typeof v["wallTimeMs"] !== "number") return false;
  if (!(typeof v["leaseOwner"] === "string" || v["leaseOwner"] === null))
    return false;
  if (typeof v["leaseExpiresAtMs"] !== "number") return false;
  if (typeof v["lastSummary"] !== "string") return false;
  if (typeof v["createdAtMs"] !== "number") return false;
  if (typeof v["updatedAtMs"] !== "number") return false;
  if (typeof v["hostVersion"] !== "string") return false;
  if ("lastTurnAtMs" in v && typeof v["lastTurnAtMs"] !== "number")
    return false;
  if ("lastContinuedMessageId" in v && typeof v["lastContinuedMessageId"] !== "string")
    return false;
  if ("restoreCount" in v && typeof v["restoreCount"] !== "number")
    return false;
  if ("evidencePath" in v && typeof v["evidencePath"] !== "string")
    return false;
  if ("evidenceHash" in v && !(typeof v["evidenceHash"] === "string" || v["evidenceHash"] === null))
    return false;
  if ("pendingVerification" in v && typeof v["pendingVerification"] !== "boolean")
    return false;
  if ("verificationFailReason" in v && !(typeof v["verificationFailReason"] === "string" || v["verificationFailReason"] === null))
    return false;
  if ("revisionCount" in v && typeof v["revisionCount"] !== "number")
    return false;
  return true;
}
function normalizeState(input) {
  return {
    ...input,
    lastTurnAtMs: input.lastTurnAtMs ?? 0,
    lastContinuedMessageId: input.lastContinuedMessageId ?? "",
    restoreCount: input.restoreCount ?? 0,
    evidencePath: input.evidencePath ?? "",
    evidenceHash: input.evidenceHash ?? null,
    pendingVerification: input.pendingVerification ?? false,
    verificationFailReason: input.verificationFailReason ?? null,
    revisionCount: input.revisionCount ?? 0
  };
}
async function loadGoalState(statePath) {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isValidState(parsed)) {
      throw new Error("corrupt goal state at " + statePath);
    }
    return normalizeState(parsed);
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}
var tmpCounter = 0;
async function saveGoalState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  tmpCounter += 1;
  const tmpPath = statePath + "." + process.pid + "." + tmpCounter + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmpPath, statePath);
}
async function acquireClaimLock(lockPath, owner, ttlMs, clock) {
  const now = clock.nowMs();
  try {
    await fs.writeFile(lockPath, JSON.stringify({ owner, at: now }), {
      flag: "wx"
    });
    return true;
  } catch (err) {
    const code = err.code;
    if (code !== "EEXIST") throw err;
    try {
      const raw = await fs.readFile(lockPath, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.at === "number" && now - parsed.at > ttlMs) {
        await fs.unlink(lockPath);
        await fs.writeFile(lockPath, JSON.stringify({ owner, at: now }), {
          flag: "wx"
        });
        return true;
      }
    } catch {
    }
    return false;
  }
}
async function tryClaimLease(statePath, owner, ttlMs, clock) {
  const lockPath = statePath + ".lock";
  const locked = await acquireClaimLock(lockPath, owner, ttlMs, clock);
  if (!locked) {
    const current = await loadGoalState(statePath);
    return { claimed: false, state: current };
  }
  try {
    const current = await loadGoalState(statePath);
    const now = clock.nowMs();
    if (current !== null) {
      const held = current.leaseOwner !== null && current.leaseExpiresAtMs > now && current.leaseOwner !== owner;
      if (held) {
        return { claimed: false, state: current };
      }
    }
    if (current === null) {
      return { claimed: false, state: null };
    }
    const next = {
      ...current,
      leaseOwner: owner,
      leaseExpiresAtMs: now + ttlMs,
      updatedAtMs: now
    };
    await saveGoalState(statePath, next);
    return { claimed: true, state: next };
  } finally {
    try {
      await fs.unlink(lockPath);
    } catch {
    }
  }
}

// src/goal.ts
var MAX_OBJECTIVE_LEN = 2e3;
function parseGoalCommand(rawInput) {
  if (typeof rawInput !== "string") {
    return { kind: "invalid", raw: String(rawInput) };
  }
  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();
  const prefix = "/goal";
  if (lower === prefix) {
    return { kind: "invalid", raw: rawInput };
  }
  if (!lower.startsWith(prefix)) {
    return { kind: "invalid", raw: rawInput };
  }
  const after = trimmed.slice(prefix.length);
  if (after.length === 0) {
    return { kind: "invalid", raw: rawInput };
  }
  if (!/^\s/.test(after)) {
    return { kind: "invalid", raw: rawInput };
  }
  const body = after.trim();
  if (body.length === 0) {
    return { kind: "invalid", raw: rawInput };
  }
  const bodyLower = body.toLowerCase();
  if (bodyLower === "status") return { kind: "status" };
  if (bodyLower.startsWith("status ") || bodyLower.startsWith("status	") || bodyLower.startsWith("status\n")) {
    return { kind: "invalid", raw: rawInput };
  }
  if (bodyLower === "clear") return { kind: "clear" };
  if (bodyLower.startsWith("clear ") || bodyLower.startsWith("clear	") || bodyLower.startsWith("clear\n")) {
    return { kind: "invalid", raw: rawInput };
  }
  if (bodyLower === "complete") return { kind: "complete" };
  if (bodyLower.startsWith("complete ") || bodyLower.startsWith("complete	") || bodyLower.startsWith("complete\n")) {
    return { kind: "invalid", raw: rawInput };
  }
  if (bodyLower === "block") {
    return { kind: "invalid", raw: rawInput };
  }
  if (bodyLower.startsWith("block ") || bodyLower.startsWith("block	") || bodyLower.startsWith("block\n")) {
    const reason = body.slice(6).trim();
    if (reason.length === 0) return { kind: "invalid", raw: rawInput };
    if (reason.length > MAX_OBJECTIVE_LEN)
      return { kind: "invalid", raw: rawInput };
    return { kind: "block", reason };
  }
  if (body.length > MAX_OBJECTIVE_LEN) {
    return { kind: "invalid", raw: rawInput };
  }
  return { kind: "set", objective: body };
}
function setObjective(prev, objective, clock, hostVersion) {
  const fresh = initialState(objective, clock, hostVersion);
  if (prev !== null) {
    return { ...fresh, createdAtMs: prev.createdAtMs };
  }
  return fresh;
}
function blockGoal(current, reason, clock) {
  if (current.status !== "active") {
    throw new Error("only active goal can be blocked");
  }
  return {
    ...current,
    status: "blocked",
    lastSummary: reason,
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs()
  };
}
function completeGoal(current, clock) {
  if (current.status !== "active") {
    throw new Error("only active goal can complete");
  }
  return {
    ...current,
    status: "complete",
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs()
  };
}
function clearGoal(current, clock) {
  return {
    ...current,
    status: "cleared",
    leaseOwner: null,
    leaseExpiresAtMs: 0,
    updatedAtMs: clock.nowMs()
  };
}

// src/limits.ts
var DEFAULT_LIMITS = {
  minDelayMs: 2e4,
  maxTurns: 30,
  maxWallMs: 72e5
};
var STOP_FILE_NAME = "STOP_GOAL";
function checkBudget(state, nowMs, limits) {
  if (state.iterationCount >= limits.maxTurns) {
    return { ok: false, reason: "max-turns" };
  }
  if (nowMs - state.createdAtMs >= limits.maxWallMs) {
    return { ok: false, reason: "wall-time" };
  }
  return { ok: true, reason: "ok" };
}

// src/loop.ts
var idleInFlight = false;
function safeSpend(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}
function shouldContinue(state, nowMs, lastMessageId, limits, opts) {
  if (state === null) return { ok: false, reason: "no-state" };
  if (state.status !== "active")
    return { ok: false, reason: "stopped-" + state.status };
  if (state.pendingVerification === true)
    return { ok: false, reason: "verification-pending" };
  if (opts?.stopRequested === true) return { ok: false, reason: "stop-file" };
  if (state.lastContinuedMessageId !== "" && lastMessageId !== null && lastMessageId !== state.lastContinuedMessageId) {
    return { ok: false, reason: "human-message" };
  }
  const budget = checkBudget(state, nowMs, limits);
  if (!budget.ok) return budget;
  if (state.lastTurnAtMs !== 0 && nowMs - state.lastTurnAtMs < limits.minDelayMs) {
    return { ok: false, reason: "cooldown" };
  }
  return { ok: true, reason: "ok" };
}
function buildContinuationPrompt(state) {
  const summary = state.lastSummary !== "" ? state.lastSummary : "none yet";
  return 'Continue goal: "' + state.objective + '"\nStatus: ' + state.status + " | Turn: " + String(state.iterationCount + 1) + " | Last: " + summary + "\nTake exactly one concrete next step toward the objective.\nIf done call /goal complete. If stuck call /goal block <reason>. To cancel call /goal clear.\nDo not repeat questions. Keep output concise.";
}
async function handleSessionIdle(ctx, deps) {
  if (idleInFlight) {
    return { decision: "skipped", reason: "idle-inflight" };
  }
  if (ctx === null || typeof ctx !== "object") {
    return { decision: "stopped", reason: "invalid-context" };
  }
  if (deps === null || typeof deps !== "object") {
    return { decision: "stopped", reason: "invalid-deps" };
  }
  if (typeof ctx.projectDir !== "string" || ctx.projectDir.trim().length === 0) {
    return { decision: "stopped", reason: "invalid-project-dir" };
  }
  if (typeof deps.loadState !== "function" || typeof deps.saveState !== "function") {
    return { decision: "stopped", reason: "invalid-deps" };
  }
  if (typeof deps.tryClaim !== "function" || typeof deps.sendPrompt !== "function") {
    return { decision: "stopped", reason: "invalid-deps" };
  }
  if (typeof deps.hasStopFile !== "function") {
    return { decision: "stopped", reason: "invalid-deps" };
  }
  if (deps.clock === null || typeof deps.clock !== "object" || typeof deps.clock.nowMs !== "function") {
    return { decision: "stopped", reason: "invalid-deps" };
  }
  if (deps.limits === null || typeof deps.limits !== "object") {
    return { decision: "stopped", reason: "invalid-limits" };
  }
  if (typeof deps.limits.minDelayMs !== "number" || typeof deps.limits.maxTurns !== "number" || typeof deps.limits.maxWallMs !== "number") {
    return { decision: "stopped", reason: "invalid-limits" };
  }
  if (typeof deps.ownerId !== "string" || deps.ownerId.length === 0) {
    return { decision: "stopped", reason: "invalid-owner" };
  }
  idleInFlight = true;
  try {
    const statePath = resolveStatePath(ctx.projectDir);
    let current;
    try {
      current = await deps.loadState(statePath);
    } catch {
      return { decision: "stopped", reason: "corrupt-state" };
    }
    const now = deps.clock.nowMs();
    let stopRequested = false;
    try {
      stopRequested = await deps.hasStopFile();
    } catch {
      return { decision: "stopped", reason: "stop-check-failed" };
    }
    const gate = shouldContinue(
      current,
      now,
      ctx.lastMessageId ?? null,
      deps.limits,
      { stopRequested }
    );
    if (!gate.ok) {
      const terminal = gate.reason === "no-state" || gate.reason.startsWith("stopped-") || gate.reason === "max-turns" || gate.reason === "wall-time" || gate.reason === "stop-file";
      return {
        decision: terminal ? "stopped" : "skipped",
        reason: gate.reason
      };
    }
    let claimed;
    try {
      claimed = await deps.tryClaim(
        statePath,
        deps.ownerId,
        LEASE_TTL_MS,
        deps.clock
      );
    } catch {
      return { decision: "stopped", reason: "claim-failed" };
    }
    if (!claimed.claimed || claimed.state === null) {
      return { decision: "skipped", reason: "lease-held" };
    }
    const prompt = buildContinuationPrompt(claimed.state);
    let sent;
    try {
      sent = await deps.sendPrompt(prompt);
    } catch {
      try {
        await deps.saveState(statePath, {
          ...claimed.state,
          leaseOwner: null,
          leaseExpiresAtMs: 0,
          updatedAtMs: deps.clock.nowMs()
        });
      } catch {
      }
      return { decision: "stopped", reason: "send-failed" };
    }
    if (typeof sent !== "object" || sent === null || typeof sent.messageId !== "string" || sent.messageId.length === 0) {
      try {
        await deps.saveState(statePath, {
          ...claimed.state,
          leaseOwner: null,
          leaseExpiresAtMs: 0,
          updatedAtMs: deps.clock.nowMs()
        });
      } catch {
      }
      return { decision: "stopped", reason: "send-failed" };
    }
    const afterSend = deps.clock.nowMs();
    const next = {
      ...claimed.state,
      iterationCount: claimed.state.iterationCount + 1,
      lastTurnAtMs: afterSend,
      lastContinuedMessageId: sent.messageId,
      tokenSpend: claimed.state.tokenSpend + safeSpend(sent.tokenSpend),
      updatedAtMs: afterSend,
      leaseOwner: null,
      leaseExpiresAtMs: 0
    };
    try {
      await deps.saveState(statePath, next);
    } catch {
      return { decision: "stopped", reason: "save-failed" };
    }
    return { decision: "sent", reason: "ok", messageId: sent.messageId };
  } finally {
    idleInFlight = false;
  }
}

// src/compaction.ts
async function snapshotForCompaction(statePath, clock, store) {
  const raw = await store.loadState(statePath);
  if (raw === null) return null;
  const now = clock.nowMs();
  const next = { ...raw, updatedAtMs: now };
  await store.saveState(statePath, next);
  return {
    iterationCount: typeof next["iterationCount"] === "number" ? next["iterationCount"] : 0,
    lastTurnAtMs: typeof next["lastTurnAtMs"] === "number" ? next["lastTurnAtMs"] : 0,
    lastContinuedMessageId: typeof next["lastContinuedMessageId"] === "string" ? next["lastContinuedMessageId"] : "",
    restoreCount: typeof next["restoreCount"] === "number" ? next["restoreCount"] : 0
  };
}
async function restoreAfterCompaction(statePath, clock, store) {
  const raw = await store.loadState(statePath);
  if (raw === null) return null;
  const now = clock.nowMs();
  const prev = typeof raw["restoreCount"] === "number" ? raw["restoreCount"] : 0;
  const last = typeof raw["lastTurnAtMs"] === "number" ? raw["lastTurnAtMs"] : 0;
  const clampedLast = last > now ? now : last;
  const next = {
    ...raw,
    restoreCount: prev + 1,
    lastTurnAtMs: clampedLast,
    updatedAtMs: now
  };
  await store.saveState(statePath, next);
  return {
    iterationCount: typeof next["iterationCount"] === "number" ? next["iterationCount"] : 0,
    lastTurnAtMs: clampedLast,
    lastContinuedMessageId: typeof next["lastContinuedMessageId"] === "string" ? next["lastContinuedMessageId"] : "",
    restoreCount: prev + 1
  };
}

// src/index.ts
var PLUGIN_NAME = "opencode-goal-plugin";
var PLUGIN_VERSION = "0.2.0";
function getAvailableHooks(host) {
  try {
    if (typeof host !== "object" || host === null) return [];
    const h = host;
    const out = [];
    if (typeof h["registerCommand"] === "function") out.push("registerCommand");
    if (typeof h["onIdle"] === "function") out.push("onIdle");
    if (typeof h["onCompact"] === "function") out.push("onCompact");
    if (typeof h["onSessionEnd"] === "function") out.push("onSessionEnd");
    return out;
  } catch {
    return [];
  }
}
async function handleGoalCommand(rawInput, projectDir, clock = new SystemClock(), hostVersion = "2.0.29") {
  if (typeof rawInput !== "string") {
    return "Invalid /goal usage. Try /goal <objective> or /goal status.";
  }
  if (typeof projectDir !== "string" || projectDir.trim().length === 0) {
    return "Invalid project directory.";
  }
  const parsed = parseGoalCommand(rawInput);
  if (parsed.kind === "invalid") {
    return "Invalid /goal usage. Try /goal <objective> or /goal status.";
  }
  const statePath = resolveStatePath(projectDir);
  let current;
  try {
    current = await loadGoalState(statePath);
  } catch {
    return "Goal state is corrupt at " + statePath + ". Back up the file then clear it.";
  }
  if (parsed.kind === "status") {
    if (current === null) return "No goal set. Use /goal <objective>.";
    return "Goal " + current.status + ": " + current.objective;
  }
  if (parsed.kind === "set") {
    const next = setObjective(current, parsed.objective, clock, hostVersion);
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return "Failed to save goal state: " + err.message;
    }
    return "Goal set to active: " + next.objective;
  }
  if (current === null) {
    return "No goal set. Use /goal <objective> first.";
  }
  if (parsed.kind === "block") {
    let next;
    try {
      next = blockGoal(current, parsed.reason, clock);
    } catch {
      return "Only an active goal can be blocked. Current status: " + current.status + ".";
    }
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return "Failed to save goal state: " + err.message;
    }
    return "Goal marked blocked: " + parsed.reason;
  }
  if (parsed.kind === "complete") {
    let next;
    try {
      next = completeGoal(current, clock);
    } catch {
      return "Only an active goal can complete. Current status: " + current.status + ".";
    }
    try {
      await saveGoalState(statePath, next);
    } catch (err) {
      return "Failed to save goal state: " + err.message;
    }
    return "Goal marked complete.";
  }
  const cleared = clearGoal(current, clock);
  try {
    await saveGoalState(statePath, cleared);
  } catch (err) {
    return "Failed to save goal state: " + err.message;
  }
  return "Goal cleared.";
}
function handleIdleStub() {
  return "phase2-not-implemented";
}
function defaultHasStopFile(projectDir) {
  return async () => {
    try {
      await fs2.access(path2.join(projectDir, ".opencode", STOP_FILE_NAME));
      return true;
    } catch (e) {
      const code = e.code;
      if (code === "ENOENT") return false;
      throw e;
    }
  };
}
function registerIdleHandler(host, opts) {
  if (opts === null || typeof opts !== "object") {
    return { registered: false, reason: "invalid-opts" };
  }
  if (typeof opts.projectDir !== "string" || opts.projectDir.trim().length === 0) {
    return { registered: false, reason: "invalid-opts" };
  }
  if (typeof opts.getLastMessageId !== "function" || typeof opts.sendPrompt !== "function") {
    return { registered: false, reason: "invalid-opts" };
  }
  const hooks = getAvailableHooks(host);
  if (!hooks.includes("onIdle")) {
    return { registered: false, reason: "idle-hook-unavailable" };
  }
  const h = host;
  if (typeof h.onIdle !== "function") {
    return { registered: false, reason: "idle-hook-unavailable" };
  }
  const clock = opts.clock ?? new SystemClock();
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const ownerId = opts.ownerId ?? "idle-" + String(process.pid) + "-" + String(Math.floor(Math.random() * 1e6));
  if (typeof ownerId !== "string" || ownerId.length === 0) {
    return { registered: false, reason: "invalid-opts" };
  }
  const hasStopFile = defaultHasStopFile(opts.projectDir);
  const cb = async () => {
    let lastId = null;
    try {
      lastId = opts.getLastMessageId() ?? null;
    } catch {
      lastId = null;
    }
    const ctx = { projectDir: opts.projectDir, lastMessageId: lastId };
    const deps = {
      clock,
      limits,
      ownerId,
      loadState: loadGoalState,
      saveState: saveGoalState,
      tryClaim: tryClaimLease,
      sendPrompt: opts.sendPrompt,
      hasStopFile
    };
    try {
      await handleSessionIdle(ctx, deps);
    } catch {
    }
  };
  try {
    h.onIdle(cb);
    return { registered: true, reason: "ok" };
  } catch {
    return { registered: false, reason: "register-failed" };
  }
}
var plugin = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  getAvailableHooks,
  handleGoalCommand,
  handleIdleStub,
  registerIdleHandler,
  defaultHasStopFile,
  registerCompactionHandler
};
function registerCompactionHandler(host, opts) {
  try {
    if (opts === null || typeof opts !== "object") {
      return { registered: false, reason: "invalid-opts" };
    }
    if (typeof opts.projectDir !== "string" || opts.projectDir.trim().length === 0) {
      return { registered: false, reason: "invalid-opts" };
    }
    if (host === null || typeof host !== "object") {
      return { registered: false, reason: "compaction-hook-unavailable" };
    }
    const hooks = getAvailableHooks(host);
    const hasCompact = hooks.includes("onCompact");
    const h = host;
    const resumeFn = typeof h.onSessionResume === "function" ? h.onSessionResume : typeof h.onSessionStart === "function" ? h.onSessionStart : null;
    if (!hasCompact && resumeFn === null) {
      return { registered: false, reason: "compaction-hook-unavailable" };
    }
    const clock = opts.clock ?? new SystemClock();
    const statePath = resolveStatePath(opts.projectDir);
    const store = { loadState: loadGoalState, saveState: saveGoalState };
    if (hasCompact && typeof h.onCompact === "function") {
      h.onCompact(async () => {
        try {
          await snapshotForCompaction(statePath, clock, store);
        } catch {
        }
      });
    }
    if (resumeFn !== null) {
      resumeFn(async () => {
        try {
          await restoreAfterCompaction(statePath, clock, store);
        } catch {
        }
      });
    }
    return { registered: true, reason: "ok" };
  } catch {
    return { registered: false, reason: "register-failed" };
  }
}
var index_default = plugin;
export {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  index_default as default,
  defaultHasStopFile,
  getAvailableHooks,
  handleGoalCommand,
  handleIdleStub,
  registerCompactionHandler,
  registerIdleHandler
};
