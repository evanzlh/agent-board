import type {
  AgentKind,
  AgentLastTurn,
  AgentPublicStatus,
  AgentStatus,
  AppServerLastTurn,
  AppServerThread,
  AppServerThreadStatus,
  NormalizeOptions,
} from "./types.ts";

export function mapThreadStatus(
  status: AppServerThreadStatus | unknown,
  lastTurn: Pick<AgentLastTurn, "status" | "completedAt"> | null,
): AgentPublicStatus {
  if (lastTurn?.status === "failed") {
    return "error";
  }

  if (!isObject(status) || typeof status.type !== "string") {
    if (hasTerminalTurnEvidence(lastTurn)) {
      return "finished";
    }
    if (hasActiveTurnEvidence(lastTurn)) {
      return "working";
    }
    return "unknown";
  }

  if (status.type === "systemError") {
    return "error";
  }

  if (status.type === "active") {
    const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
    if (flags.includes("waitingOnApproval")) {
      return "waiting_approval";
    }
    if (flags.includes("waitingOnUserInput")) {
      return "waiting_input";
    }
    return "working";
  }

  if (hasTerminalTurnEvidence(lastTurn) && status.type !== "idle") {
    return "finished";
  }

  if (hasActiveTurnEvidence(lastTurn) && isInactiveThreadStatus(status)) {
    return "working";
  }

  if (status.type === "idle") {
    return "idle";
  }

  if (status.type === "notLoaded") {
    return "unknown";
  }

  return "unknown";
}

export function inferRawStatusFromTurn(
  status: AppServerThreadStatus | unknown,
  lastTurn: Pick<AgentLastTurn, "status" | "completedAt"> | null,
): AppServerThreadStatus | unknown {
  if (hasActiveTurnEvidence(lastTurn) && isInactiveThreadStatus(status)) {
    return activeRawStatus();
  }
  return status;
}

export function inferRawStatusFromActivity(
  status: AppServerThreadStatus | unknown,
): AppServerThreadStatus | unknown {
  if (isInactiveThreadStatus(status)) {
    return activeRawStatus();
  }
  return status;
}

export function normalizeTimestampMs(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000 && absolute < 100_000_000_000) {
    return value * 1000;
  }
  return value;
}

export function deriveAgentKind(thread: AppServerThread): AgentKind {
  if (thread.agentNickname || thread.agentRole || getSubAgentSource(thread.source) !== null) {
    return "sub_agent";
  }

  if (thread.forkedFromId) {
    return "unknown";
  }

  return "main_agent";
}

export function deriveParentThreadId(thread: AppServerThread): string | null {
  const subAgentSource = getSubAgentSource(thread.source);
  const threadSpawn = getObjectProperty(subAgentSource, "thread_spawn");
  const parentThreadId = getStringProperty(threadSpawn, "parent_thread_id");

  return parentThreadId ?? thread.forkedFromId ?? null;
}

export function deriveDisplayName(thread: AppServerThread): string {
  return firstNonEmpty([
    thread.agentNickname,
    thread.agentRole,
    thread.name,
    thread.preview,
    thread.id,
  ]);
}

export function normalizeThread(thread: AppServerThread, options: NormalizeOptions): AgentStatus {
  const previous = options.previous ?? null;
  const currentLastTurn = normalizeLastTurn(selectLatestTurn(thread.turns));
  const shouldPreservePrevious =
    currentLastTurn === null && shouldPreservePreviousEvidence(thread.status, previous);
  const lastTurn =
    currentLastTurn ?? (shouldPreservePrevious ? previous.lastTurn : null);
  const statusInput = shouldPreservePrevious ? previous.rawStatus : thread.status;
  const rawStatus = inferRawStatusFromTurn(statusInput, lastTurn);
  const publicStatus = mapThreadStatus(rawStatus, lastTurn);
  const waitingSince = isWaitingStatus(publicStatus)
    ? previous && previous.status === publicStatus
      ? previous.waitingSince
      : options.nowMs
    : null;

  return {
    id: thread.id,
    sessionId: thread.sessionId,
    kind: deriveAgentKind(thread),
    displayName: deriveDisplayName(thread),
    status: publicStatus,
    rawStatus,
    cwd: thread.cwd,
    preview: thread.preview,
    modelProvider: thread.modelProvider,
    cliVersion: thread.cliVersion,
    createdAt: normalizeTimestampMs(thread.createdAt),
    updatedAt: normalizeTimestampMs(thread.updatedAt),
    parentThreadId: deriveParentThreadId(thread),
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    lastTurn,
    waitingSince,
    lastEventAt: options.nowMs,
    stale: false,
  };
}

function normalizeLastTurn(turn: AppServerLastTurn | null): AgentLastTurn | null {
  if (!turn) {
    return null;
  }

  const knownStatuses = new Set(["completed", "interrupted", "failed", "inProgress"]);
  return {
    status: knownStatuses.has(turn.status) ? (turn.status as AgentLastTurn["status"]) : "unknown",
    startedAt: typeof turn.startedAt === "number" ? normalizeTimestampMs(turn.startedAt) : null,
    completedAt: typeof turn.completedAt === "number" ? normalizeTimestampMs(turn.completedAt) : null,
  };
}

function selectLatestTurn(turns: AppServerLastTurn[]): AppServerLastTurn | null {
  let latest: AppServerLastTurn | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const turn of turns) {
    const time = appServerTurnTimeMs(turn);
    if (latest === null || time >= latestTime) {
      latest = turn;
      latestTime = time;
    }
  }

  return latest;
}

function appServerTurnTimeMs(turn: AppServerLastTurn): number {
  const startedAt = typeof turn.startedAt === "number" ? normalizeTimestampMs(turn.startedAt) : null;
  const completedAt = typeof turn.completedAt === "number" ? normalizeTimestampMs(turn.completedAt) : null;
  return Math.max(startedAt ?? Number.NEGATIVE_INFINITY, completedAt ?? Number.NEGATIVE_INFINITY);
}

function isWaitingStatus(status: AgentPublicStatus): boolean {
  return status === "waiting_approval" || status === "waiting_input";
}

function shouldPreservePreviousEvidence(
  status: AppServerThreadStatus | unknown,
  previous: AgentStatus | null,
): previous is AgentStatus {
  return isNotLoadedThreadStatus(status) && previous !== null && hasLiveEvidence(previous);
}

function hasLiveEvidence(agent: AgentStatus): boolean {
  return (
    (agent.status === "working" ||
      agent.status === "waiting_approval" ||
      agent.status === "waiting_input") &&
    !isNotLoadedThreadStatus(agent.rawStatus)
  );
}

function isInactiveThreadStatus(status: unknown): boolean {
  if (!isObject(status) || typeof status.type !== "string") {
    return true;
  }
  return status.type === "notLoaded" || status.type === "idle";
}

function hasActiveTurnEvidence(
  turn: Pick<AgentLastTurn, "status" | "completedAt"> | null,
): boolean {
  if (!turn) {
    return false;
  }
  return turn.status === "inProgress" || (turn.status === "interrupted" && turn.completedAt === null);
}

function hasTerminalTurnEvidence(
  turn: Pick<AgentLastTurn, "status" | "completedAt"> | null,
): boolean {
  if (!turn) {
    return false;
  }
  return turn.status === "completed" || (turn.status === "interrupted" && turn.completedAt !== null);
}

function isNotLoadedThreadStatus(status: unknown): boolean {
  return isObject(status) && status.type === "notLoaded";
}

function activeRawStatus(): AppServerThreadStatus {
  return { type: "active", activeFlags: [] };
}

function getSubAgentSource(source: unknown): unknown {
  if (!isObject(source) || !("subAgent" in source)) {
    return null;
  }
  return source.subAgent ?? null;
}

function getObjectProperty(value: unknown, key: string): Record<string, unknown> | null {
  if (!isObject(value)) {
    return null;
  }
  const child = value[key];
  return isObject(child) ? child : null;
}

function getStringProperty(value: unknown, key: string): string | null {
  if (!isObject(value)) {
    return null;
  }
  const child = value[key];
  return typeof child === "string" && child.length > 0 ? child : null;
}

function firstNonEmpty(values: Array<string | null>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "unknown";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
