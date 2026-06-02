import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { access, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { normalizeTimestampMs } from "../domain/mapper.ts";
import type { AppServerThread } from "../domain/types.ts";

const execFile = promisify(execFileCallback);

export type SessionEvidenceOptions = {
  codexHome: string | null;
  detectOrphanedSessions?: boolean;
  resolveLiveCodexResumeSessionIds?: () => Promise<Set<string> | null>;
};

export async function applySessionApprovalEvidence(
  threads: AppServerThread[],
  options: SessionEvidenceOptions,
): Promise<AppServerThread[]> {
  if (!options.codexHome) {
    return threads;
  }

  const shouldDetectOrphaned = options.detectOrphanedSessions === true;
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
      (await isThreadOrphaned(thread, options.codexHome, liveSessions))
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
  const processIds = await listCodexResumeProcessIds();
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

async function findThreadSessionPath(
  codexHome: string,
  thread: AppServerThread,
): Promise<string | null> {
  if (typeof thread.path === "string" && thread.path.endsWith(".jsonl")) {
    if (await fileExists(thread.path)) {
      return thread.path;
    }
  }

  const dates = sessionDateCandidates(thread);
  for (const dateParts of dates) {
    const dir = join(codexHome, "sessions", ...dateParts);
    const fileName = await findThreadSessionFileName(dir, thread);
    if (fileName) {
      return join(dir, fileName);
    }
  }

  return null;
}

async function findThreadSessionFileName(
  dir: string,
  thread: AppServerThread,
): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  const identifiers = [thread.sessionId, thread.id].filter(
    (identifier): identifier is string => typeof identifier === "string" && identifier.length > 0,
  );
  const matches = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (fileName) =>
        fileName.endsWith(".jsonl") &&
        identifiers.some((identifier) => fileName.includes(identifier)),
    )
    .sort();

  return matches.at(-1) ?? null;
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

function sessionDateCandidates(thread: AppServerThread): string[][] {
  const candidates = new Map<string, string[]>();
  for (const value of [thread.createdAt, thread.updatedAt]) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    const timestampMs = normalizeTimestampMs(value);
    for (const offsetDays of [-1, 0, 1]) {
      const date = new Date(timestampMs + offsetDays * 24 * 60 * 60 * 1000);
      addDateCandidate(candidates, localDateParts(date));
      addDateCandidate(candidates, utcDateParts(date));
    }
  }
  return [...candidates.values()];
}

function addDateCandidate(candidates: Map<string, string[]>, parts: string[]): void {
  candidates.set(parts.join("/"), parts);
}

function localDateParts(date: Date): string[] {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];
}

function utcDateParts(date: Date): string[] {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ];
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listCodexResumeProcessIds(): Promise<number[] | null> {
  let response;
  try {
    response = await execFile("pgrep", ["-f", "codex resume"], { encoding: "utf8" });
  } catch {
    return null;
  }

  const stdout = response.stdout ?? "";
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.split(/\s+/, 1)[0])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
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
