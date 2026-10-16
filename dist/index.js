// src/index.ts
import * as path4 from "path";
import { promises as fs4 } from "fs";
import { Plugin } from "@opencode/plugin";

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
    revisionCount: 0,
    wrapupSent: false
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
  if ("wrapupSent" in v && typeof v["wrapupSent"] !== "boolean") return false;
  return true;
}
function normalizeState(input) {
  const wrap = input.wrapupSent;
  return {
    ...input,
    lastTurnAtMs: input.lastTurnAtMs ?? 0,
    lastContinuedMessageId: input.lastContinuedMessageId ?? "",
    restoreCount: input.restoreCount ?? 0,
    evidencePath: input.evidencePath ?? "",
    evidenceHash: input.evidenceHash ?? null,
    pendingVerification: input.pendingVerification ?? false,
    verificationFailReason: input.verificationFailReason ?? null,
    revisionCount: input.revisionCount ?? 0,
    wrapupSent: typeof wrap === "boolean" ? wrap : false
  };
}
async function loadGoalState(statePath) {
  let raw;
  try {
    raw = await fs.readFile(statePath, "utf8");
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT") return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    await quarantineCorruptState(statePath);
    throw err;
  }
  if (!isValidState(parsed)) {
    await quarantineCorruptState(statePath);
    throw new Error("corrupt goal state at " + statePath);
  }
  return normalizeState(parsed);
}
var tmpCounter = 0;
var corruptCounter = 0;
async function fsyncFileBestEffort(tmpPath) {
  try {
    const fh = await fs.open(tmpPath, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
  }
}
async function fsyncDirBestEffort(dirPath) {
  try {
    const dh = await fs.open(dirPath, "r");
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  } catch {
  }
}
async function quarantineCorruptState(statePath) {
  try {
    corruptCounter += 1;
    const dest = statePath + ".corrupt-" + String(process.pid) + "-" + String(corruptCounter);
    try {
      await fs.rename(statePath, dest);
    } catch {
      try {
        const raw = await fs.readFile(statePath, "utf8");
        await fs.writeFile(dest, raw, "utf8");
      } catch {
      }
    }
  } catch {
  }
}
async function saveGoalState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  tmpCounter += 1;
  const tmpPath = statePath + "." + process.pid + "." + tmpCounter + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8");
  await fsyncFileBestEffort(tmpPath);
  try {
    await fs.chmod(tmpPath, 384);
  } catch {
  }
  await fs.rename(tmpPath, statePath);
  await fsyncDirBestEffort(path.dirname(statePath));
  try {
    await fs.chmod(statePath, 384);
  } catch {
  }
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
var GoalInputSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 2e3 }
  },
  required: ["title"],
  additionalProperties: false
};
function isSafeGoalTitle(title) {
  if (typeof title !== "string") return false;
  const t = title.trim();
  if (t.length === 0) return false;
  if (t.length > MAX_OBJECTIVE_LEN) return false;
  if (t === "..") return false;
  if (t.startsWith("../") || t.includes("/../") || t.endsWith("/.."))
    return false;
  if (t.startsWith("..\\") || t.includes("\\..\\")) return false;
  if (t.startsWith("/")) return false;
  if (/^[A-Za-z]:[\\/]/.test(t)) return false;
  if (/^[A-Za-z]:[^/\\]/.test(t)) return false;
  return true;
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
var perSessionLastTick = /* @__PURE__ */ new Map();
function checkPerSessionCooldown(sessionKey, nowMs, minDelayMs) {
  const last = perSessionLastTick.get(sessionKey);
  if (last === void 0) return { ok: true, reason: "ok" };
  if (nowMs - last < minDelayMs) return { ok: false, reason: "cooldown" };
  return { ok: true, reason: "ok" };
}
function recordPerSessionTick(sessionKey, nowMs) {
  if (perSessionLastTick.size >= 500 && !perSessionLastTick.has(sessionKey)) {
    const oldest = perSessionLastTick.keys().next();
    if (!oldest.done) perSessionLastTick.delete(oldest.value);
  }
  perSessionLastTick.set(sessionKey, nowMs);
}
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
var activeContinueTokens = /* @__PURE__ */ new Map();
var continueTokenCounter = 0;
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
  const sessionPart = typeof ctx.sessionId === "string" && ctx.sessionId.length > 0 ? ctx.sessionId : "default";
  const tokenKey = ctx.projectDir + ":" + sessionPart;
  if (activeContinueTokens.size > 500) {
    const oldest = activeContinueTokens.keys().next();
    if (!oldest.done) activeContinueTokens.delete(oldest.value);
  }
  if (activeContinueTokens.has(tokenKey)) {
    return { decision: "skipped", reason: "idle-inflight" };
  }
  continueTokenCounter += 1;
  const myToken = deps.ownerId + ":" + String(continueTokenCounter);
  activeContinueTokens.set(tokenKey, myToken);
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
      if ((gate.reason === "max-turns" || gate.reason === "wall-time") && current !== null && current.wrapupSent !== true) {
        try {
          await deps.saveState(statePath, {
            ...current,
            wrapupSent: true,
            updatedAtMs: now
          });
        } catch {
        }
      }
      return {
        decision: terminal ? "stopped" : "skipped",
        reason: gate.reason
      };
    }
    const perSession = checkPerSessionCooldown(
      tokenKey,
      now,
      deps.limits.minDelayMs
    );
    if (!perSession.ok) {
      return { decision: "skipped", reason: perSession.reason };
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
    try {
      recordPerSessionTick(tokenKey, afterSend);
    } catch {
    }
    return { decision: "sent", reason: "ok", messageId: sent.messageId };
  } finally {
    try {
      if (activeContinueTokens.get(tokenKey) === myToken) {
        activeContinueTokens.delete(tokenKey);
      }
    } catch {
    }
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
function buildEvidenceNudge(objective, pendingVerification) {
  const raw = typeof objective === "string" ? objective : "";
  const clean = raw.trim().length > 0 ? raw.trim().slice(0, 500) : "active goal";
  const base = 'Evidence required to complete "' + clean + '": cite files plus passing tests.';
  if (pendingVerification === true) {
    return base + " Verification pending, hold auto turns until proof lands.";
  }
  return base + " Call /goal complete only with proof, or /goal block <reason>.";
}
function pruneIdleControllers(controllers, live) {
  for (const c of [...controllers]) {
    if (c === live) continue;
    try {
      c.abort();
    } catch {
    }
    controllers.delete(c);
  }
  controllers.add(live);
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

// src/evidence.ts
import { promises as fs2 } from "fs";
import path2 from "path";
import { createHash } from "crypto";
var EVIDENCE_VERSION = 1;
var EVIDENCE_FILE_NAME = "goal-evidence.json";
var evidenceTmpCounter = 0;
function resolveEvidencePath(projectDir) {
  return path2.join(projectDir, ".opencode", EVIDENCE_FILE_NAME);
}
function emptyEvidence(nowMs) {
  return { version: EVIDENCE_VERSION, updatedAtMs: nowMs, criteria: [] };
}
function validateEvidenceShape(ev) {
  if (ev === null || typeof ev !== "object")
    return { ok: false, reason: "evidence-not-object" };
  const v = ev;
  if (v["version"] !== EVIDENCE_VERSION)
    return { ok: false, reason: "evidence-bad-version" };
  if (!Array.isArray(v["criteria"]))
    return { ok: false, reason: "evidence-bad-criteria" };
  const list = v["criteria"];
  if (list.length === 0) return { ok: false, reason: "evidence-empty" };
  for (const item of list) {
    if (item === null || typeof item !== "object")
      return { ok: false, reason: "criterion-not-object" };
    const c = item;
    if (typeof c["id"] !== "string" || c["id"].length === 0)
      return { ok: false, reason: "criterion-bad-id" };
    if (typeof c["claim"] !== "string" || c["claim"].length === 0)
      return { ok: false, reason: "criterion-bad-claim" };
    if (!Array.isArray(c["files"]) || c["files"].length === 0)
      return { ok: false, reason: "criterion-missing-files" };
    if (!Array.isArray(c["tests"]) || c["tests"].length === 0)
      return { ok: false, reason: "criterion-missing-tests" };
  }
  return { ok: true, reason: "ok" };
}
function hashEvidence(ev) {
  const raw = JSON.stringify({ version: ev.version, criteria: ev.criteria });
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}
async function loadEvidence(projectDir) {
  try {
    const raw = await fs2.readFile(resolveEvidencePath(projectDir), "utf8");
    const parsed = JSON.parse(raw);
    const shape = validateEvidenceShape(parsed);
    if (!shape.ok) return null;
    return parsed;
  } catch (e) {
    const code = e.code;
    if (code === "ENOENT") return null;
    return null;
  }
}
async function saveEvidence(projectDir, ev) {
  const target = resolveEvidencePath(projectDir);
  await fs2.mkdir(path2.dirname(target), { recursive: true });
  evidenceTmpCounter += 1;
  const tmp = target + ".tmp-" + String(process.pid) + "-" + String(evidenceTmpCounter);
  await fs2.writeFile(tmp, JSON.stringify(ev, null, 2), "utf8");
  try {
    const fh = await fs2.open(tmp, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
  }
  try {
    await fs2.chmod(tmp, 384);
  } catch {
  }
  await fs2.rename(tmp, target);
  try {
    await fs2.chmod(target, 384);
  } catch {
  }
}

// src/verifier.ts
import { promises as fs3 } from "fs";
import path3 from "path";
function isCitationInsideProjectDir(projectDir, citation) {
  try {
    if (typeof citation !== "string") {
      return false;
    }
    if (citation.trim() === "") {
      return false;
    }
    const base = path3.resolve(projectDir);
    const target = path3.resolve(base, citation);
    const rel = path3.relative(base, target);
    if (rel === "" || rel === ".") {
      return false;
    }
    if (rel === ".." || rel.startsWith(".." + path3.sep) || path3.isAbsolute(rel)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
function getSubagentRunner(host) {
  if (host === null || typeof host !== "object") return null;
  const h = host;
  for (const key of ["spawnSubagent", "runSubagent", "createTask"]) {
    if (typeof h[key] === "function") return h[key];
  }
  return null;
}
async function verifyLocal(projectDir, evidence) {
  if (evidence === null)
    return {
      ok: false,
      reason: "missing-evidence",
      failures: ["no evidence file"]
    };
  const shape = validateEvidenceShape(evidence);
  if (!shape.ok)
    return { ok: false, reason: shape.reason, failures: [shape.reason] };
  const failures = [];
  for (const c of evidence.criteria) {
    for (const f of c.files) {
      if (!isCitationInsideProjectDir(projectDir, f)) {
        failures.push("traversal-escape:" + c.id + ":" + String(f));
        continue;
      }
      try {
        const p = path3.isAbsolute(f) ? f : path3.join(projectDir, f);
        const st = await fs3.stat(p);
        if (!st.isFile()) {
          failures.push("not-a-file:" + c.id + ":" + String(f));
        }
      } catch {
        failures.push("missing-file:" + c.id + ":" + String(f));
      }
    }
    const passing = c.tests.some(
      (t) => typeof t.command === "string" && t.command.length > 0 && t.exitCode === 0
    );
    if (!passing) failures.push("missing-passing-test:" + c.id);
  }
  if (failures.length > 0)
    return { ok: false, reason: "evidence-invalid", failures };
  return { ok: true, reason: "ok:" + hashEvidence(evidence), failures: [] };
}
async function verifyCompletion(args) {
  try {
    const local = await verifyLocal(args.projectDir, args.evidence);
    if (!local.ok) return local;
    if (args.useSubagent !== true) return local;
    const runner = getSubagentRunner(args.host ?? null);
    if (runner === null) return local;
    if (args.evidence === null) return local;
    const out = await runner({
      stateSummary: args.stateSummary ?? "",
      evidence: args.evidence
    });
    if (out.pass === true)
      return {
        ok: true,
        reason: "subagent-pass:" + local.reason,
        failures: []
      };
    return {
      ok: false,
      reason: "subagent-fail:" + String(out.reason),
      failures: ["subagent rejected"]
    };
  } catch {
    return {
      ok: false,
      reason: "verifier-error",
      failures: ["verifier threw"]
    };
  }
}
async function tryCompleteWithEvidence(args) {
  const got = await verifyCompletion(args);
  if (!got.ok && got.reason === "missing-evidence") {
    return { ok: false, reason: "evidence-required", failures: got.failures };
  }
  return got;
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
    const schemaOk = GoalInputSchema.required.includes("title") && GoalInputSchema.additionalProperties === false && typeof parsed.objective === "string" && parsed.objective.trim().length >= 1 && parsed.objective.length <= 2e3;
    if (!schemaOk) {
      return "Invalid /goal usage. Try /goal <objective> or /goal status.";
    }
    if (!isSafeGoalTitle(parsed.objective)) {
      return "Invalid /goal usage. Objective must not be a path escape.";
    }
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
      const ev = await loadEvidence(projectDir);
      const check = await tryCompleteWithEvidence({
        projectDir,
        evidence: ev
      });
      if (!check.ok) {
        return "Complete blocked: " + check.reason + ". Add file citations plus passing tests to evidence.";
      }
    } catch {
      return "Complete blocked: verifier-error. Add evidence and retry.";
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
      await fs4.access(path4.join(projectDir, ".opencode", STOP_FILE_NAME));
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
function buildGoalWorkInstruction(objective, iterationCount) {
  return 'Goal accepted: "' + objective + '" (turn ' + String(iterationCount + 1) + ").\nWork toward it now with concrete steps.\nWhen done, finish with evidence and call /goal complete. If blocked, call /goal block <reason>. To cancel, call /goal clear.";
}
function resolveProjectDir(ctx) {
  try {
    const c = ctx;
    if (typeof c.location?.directory === "string" && c.location.directory.length > 0) {
      return c.location.directory;
    }
  } catch {
  }
  return process.cwd();
}
async function notifySynthetic(session, sessionID, text) {
  try {
    if (typeof session.synthetic === "function") {
      await session.synthetic({ sessionID, text });
    }
  } catch {
  }
}
var index_default = Plugin.define({
  id: PLUGIN_NAME,
  async setup(ctx) {
    const projectDir = resolveProjectDir(ctx);
    const clock = new SystemClock();
    const ownerId = "v2-" + String(process.pid) + "-" + String(Math.floor(Math.random() * 1e6));
    const hasStopFile = defaultHasStopFile(projectDir);
    try {
      const cmd = ctx.command;
      if (cmd !== null && typeof cmd === "object" && typeof cmd.transform === "function") {
        await cmd.transform((editor) => {
          editor.add({
            name: "goal",
            description: "Set a session goal and auto-continue until complete, blocked, or cleared.",
            execute: async (invocation) => {
              try {
                const inv = invocation;
                const sessionID = typeof inv.sessionID === "string" ? inv.sessionID : "";
                const text = typeof inv.prompt?.text === "string" ? inv.prompt.text : "";
                const parsed = parseGoalCommand("/goal " + text);
                if (parsed.kind === "set") {
                  if (!isSafeGoalTitle(parsed.objective)) {
                    if (sessionID !== "") {
                      const session = ctx.session;
                      try {
                        await session?.synthetic?.({
                          sessionID,
                          text: "Invalid /goal usage. Objective must not be a path escape."
                        });
                      } catch {
                      }
                    }
                    return;
                  }
                  const statePath = resolveStatePath(projectDir);
                  const current = await loadGoalState(statePath).catch(
                    () => null
                  );
                  const next = setObjective(
                    current,
                    parsed.objective,
                    clock,
                    "2.0.29"
                  );
                  await saveGoalState(statePath, next);
                  await saveEvidence(
                    projectDir,
                    emptyEvidence(clock.nowMs())
                  ).catch(() => void 0);
                  if (sessionID !== "") {
                    await ctx.session?.prompt?.({
                      sessionID,
                      text: buildGoalWorkInstruction(
                        next.objective,
                        next.iterationCount
                      )
                    }).catch(() => void 0);
                  }
                  return;
                }
                const message = await handleGoalCommand(
                  "/goal " + text,
                  projectDir,
                  clock
                );
                if (sessionID !== "") {
                  const session = ctx.session;
                  if (session !== void 0)
                    await notifySynthetic(session, sessionID, message);
                }
              } catch {
              }
            }
          });
        });
      }
    } catch {
    }
    const controller = new AbortController();
    const idleAbortControllers = /* @__PURE__ */ new Set();
    idleAbortControllers.add(controller);
    const idleTask = (async () => {
      try {
        const events = ctx.event;
        if (events === void 0 || typeof events.subscribe !== "function")
          return;
        const stream = events.subscribe({
          signal: controller.signal
        });
        for await (const event of stream) {
          try {
            if (event === null || typeof event !== "object") continue;
            if (event.type !== "session.idle") continue;
            const data = event.data;
            const props = event.properties;
            const rawID = data?.sessionID ?? props?.sessionID;
            if (typeof rawID !== "string" || rawID.length === 0) continue;
            const session = ctx.session;
            if (session === void 0 || typeof session.prompt !== "function")
              continue;
            const promptFn = session.prompt.bind(session);
            const deps = {
              clock,
              limits: DEFAULT_LIMITS,
              ownerId,
              loadState: loadGoalState,
              saveState: saveGoalState,
              tryClaim: tryClaimLease,
              sendPrompt: async (prompt) => {
                const res = await promptFn({
                  sessionID: rawID,
                  text: prompt
                }).catch(() => null);
                const messageID = typeof res?.messageID === "string" && res.messageID.length > 0 ? res.messageID : "turn-unlabeled";
                const tokenSpend = typeof res?.tokenSpend === "number" ? res.tokenSpend : 0;
                return { messageId: messageID, tokenSpend };
              },
              hasStopFile
            };
            await handleSessionIdle(
              { projectDir, lastMessageId: null, sessionId: rawID },
              deps
            );
          } catch {
          }
        }
      } catch {
      }
    })();
    try {
      const session = ctx.session;
      if (session !== void 0 && typeof session.hook === "function") {
        await session.hook("compaction", (event) => {
          try {
            const e = event;
            if (typeof e.sessionID !== "string") return;
            try {
              pruneIdleControllers(idleAbortControllers, controller);
            } catch {
              idleAbortControllers.add(controller);
            }
            void loadGoalState(resolveStatePath(projectDir)).then((state) => {
              if (state === null || state.status !== "active") return;
              if (!Array.isArray(e.messages)) return;
              e.messages.push({
                role: "user",
                content: 'Restored goal after compaction: "' + state.objective + '" (turn ' + String(state.iterationCount) + "). Continue it."
              });
            }).catch(() => void 0);
          } catch {
          }
        }).catch(() => void 0);
        await session.hook("context", (event) => {
          try {
            const e = event;
            void loadGoalState(resolveStatePath(projectDir)).then((state) => {
              if (state === null || state.status !== "active") return;
              if (!Array.isArray(e.system)) return;
              const nudge = buildEvidenceNudge(
                state.objective,
                state.pendingVerification
              );
              e.system.push({
                type: "text",
                text: 'Active goal: "' + state.objective + '". ' + nudge
              });
            }).catch(() => void 0);
          } catch {
          }
        }).catch(() => void 0);
      }
    } catch {
    }
    return () => {
      try {
        controller.abort();
      } catch {
      }
      try {
        for (const c of idleAbortControllers) {
          try {
            c.abort();
          } catch {
          }
        }
        idleAbortControllers.clear();
      } catch {
      }
      void idleTask.catch(() => void 0);
    };
  }
});
export {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  buildGoalWorkInstruction,
  index_default as default,
  defaultHasStopFile,
  getAvailableHooks,
  handleGoalCommand,
  handleIdleStub,
  registerCompactionHandler,
  registerIdleHandler,
  resolveProjectDir
};
