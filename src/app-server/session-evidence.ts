import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { normalizeTimestampMs } from "../domain/mapper.ts";
import type { AppServerThread } from "../domain/types.ts";
import { findThreadSessionPath } from "./session-files.ts";

const execFile = promisify(execFileCallback);
const DEFAULT_ABANDONED_ACTIVE_SESSION_MS = 6 * 60 * 60 * 1000;

export type SessionEvidenceOptions = {
  abandonedActiveSessionMs?: number;
  codexHome: string | null;
  detectOrphanedSessions?: boolean;
  now?: () => number;
  resolveLiveCodexResumeSessionIds?: () => Promise<Set<string> | null>;
};

type SessionLifecycleEvidence = {
  hasCompletionEvidence: boolean;
  lastEventAtMs: number | null;
};

export async function applySessionApprovalEvidence(
  threads: AppServerThread[],
  options: SessionEvidenceOptions,
): Promise<AppServerThread[]> {
  if (!options.codexHome) {
    return threads;
  }

  const shouldDetectOrphaned = options.detectOrphanedSessions === true;
  const abandonedActiveSessionMs = readPositiveDurationMs(
    options.abandonedActiveSessionMs,
    DEFAULT_ABANDONED_ACTIVE_SESSION_MS,
  );
  const nowMs = options.now?.() ?? Date.now();
  const liveSessions =
    shouldDetectOrphaned && options.resolveLiveCodexResumeSessionIds
      ? await options.resolveLiveCodexResumeSessionIds()
      : shouldDetectOrphaned
        ? await findLiveCodexResumeSessionIds()
        : null;
  const disableOrphanCheck = shouldDetectOrphaned && liveSessions === null;

  const nextThreads: AppServerThread[] = [];
  let changed = false;

  for (const thread of threads) {
    if (
      shouldDetectOrphaned &&
      !disableOrphanCheck &&
      !hasWaitingApprovalFlag(thread.status) &&
      isWorkingThread(thread) &&
      ((await isThreadOrphaned(thread, options.codexHome, liveSessions)) ||
        (await isAbandonedActiveSession(
          thread,
          options.codexHome,
          nowMs,
          abandonedActiveSessionMs,
        )))
    ) {
      const status = withOrphanedActiveStatus(thread.status);
      if (status !== thread.status) {
        nextThreads.push({ ...thread, status });
        changed = true;
        continue;
      }
    }

    if (!isApprovalEvidenceCandidate(thread)) {
      nextThreads.push(thread);
      continue;
    }

    const sessionPath = await findThreadSessionPath(options.codexHome, thread);
    if (!sessionPath || !(await hasUnresolvedEscalationCall(sessionPath))) {
      nextThreads.push(thread);
      continue;
    }

    nextThreads.push(withWaitingApprovalStatus(thread));
    changed = true;
  }

  return changed ? nextThreads : threads;
}

export async function findLiveCodexResumeSessionIds(): Promise<Set<string> | null> {
  const processIds = await listCodexAgentProcessIds();
  if (processIds === null) {
    return null;
  }
  if (processIds.length === 0) {
    return new Set();
  }

  const sessions = new Set<string>();
  for (const processId of processIds) {
    const session = await readProcWtSession(processId);
    if (session) {
      sessions.add(session);
    }
  }
  return sessions;
}

export function isCodexAgentCommand(command: string[]): boolean {
  if (command.length === 0) {
    return false;
  }

  const executable = command[0];
  const executableName = basename(executable);
  const codexIndex =
    executableName === "node" && isCodexExecutable(command[1])
      ? 1
      : isCodexExecutable(executable)
        ? 0
        : -1;

  if (codexIndex === -1) {
    return false;
  }

  const subcommand = command[codexIndex + 1];
  if (!subcommand || subcommand.startsWith("-")) {
    return true;
  }

  return !NON_AGENT_CODEX_SUBCOMMANDS.has(subcommand);
}

async function findLatestShellSnapshotPath(
  codexHome: string,
  thread: AppServerThread,
): Promise<string | null> {
  let entries: Dirent[];
  const snapshotDir = join(codexHome, "shell_snapshots");
  try {
    entries = await readdir(snapshotDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const matches = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(`${thread.id}.`) && name.endsWith(".sh"))
    .sort();

  const newest = matches.at(-1);
  if (!newest) {
    return null;
  }
  return join(snapshotDir, newest);
}

async function isThreadOrphaned(
  thread: AppServerThread,
  codexHome: string,
  liveSessions: Set<string> | null,
): Promise<boolean> {
  if (!liveSessions) {
    return false;
  }
  const snapshotPath = await findLatestShellSnapshotPath(codexHome, thread);
  if (!snapshotPath) {
    return false;
  }
  const wtSession = await readWtSessionFromSnapshot(snapshotPath);
  if (!wtSession) {
    return false;
  }
  return !liveSessions.has(wtSession);
}

async function isAbandonedActiveSession(
  thread: AppServerThread,
  codexHome: string,
  nowMs: number,
  abandonedActiveSessionMs: number,
): Promise<boolean> {
  if (!Number.isFinite(nowMs)) {
    return false;
  }

  const sessionPath = await findThreadSessionPath(codexHome, thread);
  if (!sessionPath) {
    return false;
  }

  const evidence = await readSessionLifecycleEvidence(sessionPath);
  if (evidence.hasCompletionEvidence) {
    return false;
  }

  const activityAt = Math.max(
    evidence.lastEventAtMs ?? Number.NEGATIVE_INFINITY,
    latestThreadActivityAtMs(thread) ?? Number.NEGATIVE_INFINITY,
  );
  return Number.isFinite(activityAt) && nowMs - activityAt >= abandonedActiveSessionMs;
}

function withOrphanedActiveStatus(status: unknown): AppServerThread["status"] {
  if (!isActiveThreadStatus(status)) {
    return {
      type: "active",
      activeFlags: ["orphanedSession"],
    };
  }

  const activeFlags = Array.isArray(status.activeFlags)
    ? status.activeFlags.filter((flag) => flag !== "orphanedSession")
    : [];
  return {
    ...status,
    type: "active",
    activeFlags: [...activeFlags, "orphanedSession"],
  };
}

async function hasUnresolvedEscalationCall(sessionPath: string): Promise<boolean> {
  let content;
  try {
    content = await readFile(sessionPath, "utf8");
  } catch {
    return false;
  }

  const pendingEscalationCalls = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const entry = parseJsonObject(line);
    const payload = getObjectProperty(entry, "payload");
    const payloadType = getStringProperty(payload, "type");
    if (payloadType === "function_call") {
      const callId = getStringProperty(payload, "call_id");
      if (callId && isEscalatedFunctionCall(payload)) {
        pendingEscalationCalls.add(callId);
      }
      continue;
    }

    if (payloadType === "function_call_output") {
      const callId = getStringProperty(payload, "call_id");
      if (callId) {
        pendingEscalationCalls.delete(callId);
      }
    }
  }

  return pendingEscalationCalls.size > 0;
}

async function readSessionLifecycleEvidence(
  sessionPath: string,
): Promise<SessionLifecycleEvidence> {
  let content;
  try {
    content = await readFile(sessionPath, "utf8");
  } catch {
    return { hasCompletionEvidence: false, lastEventAtMs: null };
  }

  let hasCompletionEvidence = false;
  let lastEventAtMs: number | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const entry = parseJsonObject(line);
    if (!entry) {
      continue;
    }

    const timestamp = getStringProperty(entry, "timestamp");
    if (timestamp) {
      const timestampMs = Date.parse(timestamp);
      if (Number.isFinite(timestampMs)) {
        lastEventAtMs =
          lastEventAtMs === null ? timestampMs : Math.max(lastEventAtMs, timestampMs);
      }
    }
    hasCompletionEvidence ||= hasSessionCompletionEvidence(entry);
  }

  return { hasCompletionEvidence, lastEventAtMs };
}

function hasSessionCompletionEvidence(entry: Record<string, unknown>): boolean {
  const payload = getObjectProperty(entry, "payload");
  return (
    getStringProperty(payload, "type") === "task_complete" ||
    getStringProperty(payload, "phase") === "final_answer"
  );
}

function isEscalatedFunctionCall(payload: Record<string, unknown>): boolean {
  const argumentsText = getStringProperty(payload, "arguments");
  if (!argumentsText) {
    return false;
  }

  const args = parseJsonObject(argumentsText);
  return getStringProperty(args, "sandbox_permissions") === "require_escalated";
}

function isApprovalEvidenceCandidate(thread: AppServerThread): boolean {
  if (hasWaitingApprovalFlag(thread.status)) {
    return false;
  }
  if (isActiveThreadStatus(thread.status)) {
    return true;
  }

  const lastTurn = selectLatestTurn(thread);
  return lastTurn?.status === "inProgress" || lastTurn?.status === "interrupted";
}

function isWorkingThread(thread: AppServerThread): boolean {
  return isActiveThreadStatus(thread.status) || hasActiveTurnEvidence(thread);
}

function latestThreadActivityAtMs(thread: AppServerThread): number | null {
  let latest = Number.NEGATIVE_INFINITY;
  for (const value of [thread.createdAt, thread.updatedAt]) {
    const timestampMs = normalizeOptionalTimestampMs(value);
    if (timestampMs !== null) {
      latest = Math.max(latest, timestampMs);
    }
  }

  for (const turn of thread.turns ?? []) {
    for (const value of [turn.startedAt, turn.completedAt]) {
      const timestampMs = normalizeOptionalTimestampMs(value);
      if (timestampMs !== null) {
        latest = Math.max(latest, timestampMs);
      }
    }
  }

  return Number.isFinite(latest) ? latest : null;
}

function normalizeOptionalTimestampMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? normalizeTimestampMs(value)
    : null;
}

function readPositiveDurationMs(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function withWaitingApprovalStatus(thread: AppServerThread): AppServerThread {
  const activeFlags = isActiveThreadStatus(thread.status) && Array.isArray(thread.status.activeFlags)
    ? thread.status.activeFlags
    : [];
  return {
    ...thread,
    status: {
      type: "active",
      activeFlags: ["waitingOnApproval", ...activeFlags.filter((flag) => flag !== "waitingOnApproval")],
    },
  };
}

function selectLatestTurn(thread: AppServerThread): AppServerThread["turns"][number] | null {
  let latest: AppServerThread["turns"][number] | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const turn of thread.turns ?? []) {
    const startedAt =
      typeof turn.startedAt === "number" ? normalizeTimestampMs(turn.startedAt) : null;
    const completedAt =
      typeof turn.completedAt === "number" ? normalizeTimestampMs(turn.completedAt) : null;
    const time = Math.max(
      startedAt ?? Number.NEGATIVE_INFINITY,
      completedAt ?? Number.NEGATIVE_INFINITY,
    );
    if (!latest || time >= latestTime) {
      latest = turn;
      latestTime = time;
    }
  }

  return latest;
}

function hasActiveTurnEvidence(thread: AppServerThread): boolean {
  const lastTurn = selectLatestTurn(thread);
  if (!lastTurn) {
    return false;
  }

  if (lastTurn.status === "inProgress") {
    return true;
  }

  return lastTurn.status === "interrupted" && lastTurn.completedAt == null;
}

function hasWaitingApprovalFlag(status: unknown): boolean {
  return isActiveThreadStatus(status) && status.activeFlags?.includes("waitingOnApproval") === true;
}

function isActiveThreadStatus(
  status: unknown,
): status is { type: "active"; activeFlags?: string[] } {
  return isObject(status) && status.type === "active";
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getObjectProperty(
  value: Record<string, unknown> | null,
  property: string,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  const propertyValue = value[property];
  return isObject(propertyValue) ? propertyValue : null;
}

function getStringProperty(
  value: Record<string, unknown> | null,
  property: string,
): string | null {
  if (!value) {
    return null;
  }
  const propertyValue = value[property];
  return typeof propertyValue === "string" ? propertyValue : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function listCodexAgentProcessIds(): Promise<number[] | null> {
  let response;
  try {
    response = await execFile("pgrep", ["-f", "codex"], { encoding: "utf8" });
  } catch (error) {
    if (isProcessSearchNoMatch(error)) {
      return [];
    }
    return null;
  }

  const stdout = response.stdout ?? "";
  const processIds = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.split(/\s+/, 1)[0])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const codexAgentProcessIds: number[] = [];
  for (const processId of processIds) {
    const command = await readProcCmdline(processId);
    if (command && isCodexAgentCommand(command)) {
      codexAgentProcessIds.push(processId);
    }
  }
  return codexAgentProcessIds;
}

async function readProcWtSession(processId: number): Promise<string | null> {
  let environ;
  try {
    environ = await readFile(`/proc/${processId}/environ`, "utf8");
  } catch {
    return null;
  }

  for (const variable of environ.split("\0")) {
    if (variable.startsWith("WT_SESSION=")) {
      return variable.slice("WT_SESSION=".length);
    }
  }
  return null;
}

async function readProcCmdline(processId: number): Promise<string[] | null> {
  let cmdline;
  try {
    cmdline = await readFile(`/proc/${processId}/cmdline`, "utf8");
  } catch {
    return null;
  }

  const command = cmdline.split("\0").filter((value) => value.length > 0);
  return command.length > 0 ? command : null;
}

async function readWtSessionFromSnapshot(path: string): Promise<string | null> {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return null;
  }

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("WT_SESSION=")) {
      return line.slice("WT_SESSION=".length).trim();
    }
    if (line.startsWith("declare -x WT_SESSION=")) {
      const value = line.slice("declare -x WT_SESSION=".length).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        return value.slice(1, -1);
      }
      return value;
    }
  }
  return null;
}

const NON_AGENT_CODEX_SUBCOMMANDS = new Set([
  "app-server",
  "apply",
  "cloud",
  "completion",
  "debug",
  "doctor",
  "features",
  "help",
  "login",
  "logout",
  "mcp",
  "mcp-server",
  "plugin",
  "remote-control",
  "sandbox",
  "update",
]);

function isCodexExecutable(value: string | undefined): boolean {
  return basename(value ?? "") === "codex";
}

function basename(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function isProcessSearchNoMatch(error: unknown): boolean {
  return isObject(error) && error.code === 1;
}
