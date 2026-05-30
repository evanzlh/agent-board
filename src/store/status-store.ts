import { EventEmitter } from "node:events";
import { VERSION } from "../version.ts";
import {
  inferRawStatusFromActivity,
  inferRawStatusFromTurn,
  mapThreadStatus,
  normalizeTimestampMs,
  normalizeThread,
  normalizeTurnStatus,
} from "../domain/mapper.ts";
import type {
  AgentKind,
  AgentLastTurn,
  AgentPublicStatus,
  AgentStatus,
  AppServerThread,
} from "../domain/types.ts";

export type StatusSummary = {
  total: number;
  working: number;
  idle: number;
  finished: number;
  waitingApproval: number;
  waitingInput: number;
  error: number;
  unknown: number;
};

export type StatusSnapshot = {
  generatedAt: number;
  summary: StatusSummary;
  agents: AgentStatus[];
};

export type AgentFilters = {
  status?: AgentPublicStatus;
  kind?: AgentKind;
  cwd?: string;
  activeWithinMs?: number;
};

export type StoreEvent = {
  type: "agent.updated";
  agentId: string;
  status: AgentPublicStatus;
  at: number;
};

export type StoreNotification = {
  method: string;
  params?: unknown;
};

export type HealthSnapshot = {
  ok: boolean;
  daemon: {
    version: string;
    startedAt: number;
  };
  appServer: {
    connected: boolean;
    autoStarted: boolean;
    mode: "external-daemon" | "managed-child" | "unknown";
    cliVersion: string | null;
    lastConnectedAt: number | null;
    lastError: string | null;
  };
};

export type StoreOptions = {
  staleAfterMs: number;
  now: () => number;
  startedAt?: number;
};

export class StatusStore extends EventEmitter {
  readonly #agents = new Map<string, AgentStatus>();
  readonly #staleAfterMs: number;
  readonly #now: () => number;
  readonly #health: HealthSnapshot;

  constructor(options: StoreOptions) {
    super();
    this.#staleAfterMs = options.staleAfterMs;
    this.#now = options.now;
    this.#health = {
      ok: true,
      daemon: {
        version: VERSION,
        startedAt: options.startedAt ?? options.now(),
      },
      appServer: {
        connected: false,
        autoStarted: false,
        mode: "unknown",
        cliVersion: null,
        lastConnectedAt: null,
        lastError: null,
      },
    };
  }

  replaceThreads(threads: AppServerThread[]): void {
    const next = new Map<string, AgentStatus>();
    const nowMs = this.#now();
    for (const thread of threads) {
      next.set(thread.id, normalizeThread(thread, { nowMs, previous: this.#agents.get(thread.id) }));
    }
    this.#agents.clear();
    for (const agent of next.values()) {
      this.#setAgent(agent);
    }
  }

  upsertThread(thread: AppServerThread): AgentStatus {
    const agent = normalizeThread(thread, {
      nowMs: this.#now(),
      previous: this.#agents.get(thread.id),
    });
    this.#setAgent(agent);
    return agent;
  }

  applyNotification(notification: StoreNotification): void {
    if (notification.method === "thread/started") {
      this.#applyThreadStarted(notification.params);
      return;
    }

    if (notification.method === "thread/status/changed") {
      this.#applyThreadStatusChanged(notification.params);
      return;
    }

    if (notification.method === "turn/started" || notification.method === "turn/completed") {
      this.#applyTurnNotification(notification.params);
      return;
    }

    if (notification.method === "item/started") {
      this.#touchAgent(notification.params, { activeEvidence: true });
      return;
    }

    if (notification.method === "item/completed" || notification.method === "serverRequest/resolved") {
      this.#touchAgent(notification.params);
    }
  }

  getStatus(): StatusSnapshot {
    const agents = this.getAgents();
    return {
      generatedAt: this.#now(),
      summary: summarizeAgents(agents),
      agents,
    };
  }

  getAgents(filters: AgentFilters = {}): AgentStatus[] {
    const activeSince = readActiveSince(this.#now(), filters.activeWithinMs);
    return [...this.#agents.values()]
      .filter((agent) => !filters.status || agent.status === filters.status)
      .filter((agent) => !filters.kind || agent.kind === filters.kind)
      .filter((agent) => !filters.cwd || agent.cwd === filters.cwd)
      .filter((agent) => activeSince === null || agentActivityAt(agent) >= activeSince)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  getAgent(id: string): AgentStatus | null {
    return this.#agents.get(id) ?? null;
  }

  setAppServerConnection(input: {
    connected: boolean;
    autoStarted?: boolean;
    mode?: HealthSnapshot["appServer"]["mode"];
    cliVersion?: string | null;
    lastError?: string | null;
  }): void {
    this.#health.appServer.connected = input.connected;
    if (typeof input.autoStarted === "boolean") {
      this.#health.appServer.autoStarted = input.autoStarted;
    }
    if (input.mode) {
      this.#health.appServer.mode = input.mode;
    }
    if (input.cliVersion !== undefined) {
      this.#health.appServer.cliVersion = input.cliVersion;
    }
    this.#health.appServer.lastError = input.lastError ?? null;
    if (input.connected) {
      this.#health.appServer.lastConnectedAt = this.#now();
    }
  }

  getHealth(): HealthSnapshot {
    return structuredClone(this.#health);
  }

  markStaleAgents(): void {
    if (this.#health.appServer.connected) {
      return;
    }
    const nowMs = this.#now();
    for (const agent of this.#agents.values()) {
      if (!agent.stale && nowMs - agent.lastEventAt > this.#staleAfterMs) {
        this.#setAgent({ ...agent, stale: true });
      }
    }
  }

  #applyThreadStarted(params: unknown): void {
    if (!isObject(params) || !isObject(params.thread)) {
      return;
    }
    this.upsertThread(params.thread as AppServerThread);
  }

  #applyThreadStatusChanged(params: unknown): void {
    if (!isObject(params) || typeof params.threadId !== "string" || !("status" in params)) {
      return;
    }
    const current = this.#agents.get(params.threadId);
    if (!current) {
      return;
    }
    const nextStatus = mapThreadStatus(params.status, null);
    const waitingSince =
      nextStatus === "waiting_approval" || nextStatus === "waiting_input"
        ? current.status === nextStatus
          ? current.waitingSince
          : this.#now()
        : null;
    const updated = {
      ...current,
      status: nextStatus,
      rawStatus: params.status,
      waitingSince,
      lastEventAt: this.#now(),
      stale: false,
    };
    this.#setAgent(updated);
  }

  #applyTurnNotification(params: unknown): void {
    if (!isObject(params) || typeof params.threadId !== "string") {
      return;
    }
    const current = this.#agents.get(params.threadId);
    if (!current) {
      return;
    }
    const turn = isObject(params.turn) ? params.turn : params;
    const previousTurn = current.lastTurn;
    const completedAt = readTimestampMs(turn.completedAt);
    const nextTurn: AgentLastTurn = {
      status: normalizeTurnStatus(turn.status, completedAt),
      startedAt: readTimestampMs(turn.startedAt) ?? previousTurn?.startedAt ?? null,
      completedAt,
    };
    if (isOlderTurn(nextTurn, previousTurn)) {
      this.#setAgent({
        ...current,
        lastEventAt: this.#now(),
        stale: false,
      });
      return;
    }
    const rawStatus = inferRawStatusFromTurn(current.rawStatus, nextTurn);
    const nextStatus = turnPublicStatus(nextTurn, current.status);
    const updated = {
      ...current,
      lastTurn: nextTurn,
      status: nextStatus,
      rawStatus,
      waitingSince:
        nextStatus === "waiting_approval" || nextStatus === "waiting_input"
          ? current.status === nextStatus
            ? current.waitingSince
            : this.#now()
          : null,
      lastEventAt: this.#now(),
      stale: false,
    } satisfies AgentStatus;
    this.#setAgent(updated);
  }

  #touchAgent(params: unknown, options: { activeEvidence?: boolean } = {}): void {
    if (!isObject(params) || typeof params.threadId !== "string") {
      return;
    }
    const current = this.#agents.get(params.threadId);
    if (!current) {
      return;
    }
    const rawStatus = options.activeEvidence
      ? inferRawStatusFromActivity(current.rawStatus)
      : current.rawStatus;
    this.#setAgent({
      ...current,
      status: options.activeEvidence ? mapThreadStatus(rawStatus, current.lastTurn) : current.status,
      rawStatus,
      lastEventAt: this.#now(),
      stale: false,
    });
  }

  #setAgent(agent: AgentStatus): void {
    this.#agents.set(agent.id, agent);
    this.#emitAgentUpdated(agent);
  }

  #emitAgentUpdated(agent: AgentStatus): void {
    this.emit("event", {
      type: "agent.updated",
      agentId: agent.id,
      status: agent.status,
      at: this.#now(),
    } satisfies StoreEvent);
  }
}

function summarizeAgents(agents: AgentStatus[]): StatusSummary {
  const summary: StatusSummary = {
    total: agents.length,
    working: 0,
    idle: 0,
    finished: 0,
    waitingApproval: 0,
    waitingInput: 0,
    error: 0,
    unknown: 0,
  };

  for (const agent of agents) {
    if (agent.status === "working") summary.working += 1;
    else if (agent.status === "idle") summary.idle += 1;
    else if (agent.status === "finished") summary.finished += 1;
    else if (agent.status === "waiting_approval") summary.waitingApproval += 1;
    else if (agent.status === "waiting_input") summary.waitingInput += 1;
    else if (agent.status === "error") summary.error += 1;
    else if (agent.status === "unknown") summary.unknown += 1;
  }

  return summary;
}

function readActiveSince(nowMs: number, activeWithinMs: number | undefined): number | null {
  if (typeof activeWithinMs !== "number" || !Number.isFinite(activeWithinMs) || activeWithinMs <= 0) {
    return null;
  }
  return nowMs - activeWithinMs;
}

function agentActivityAt(agent: AgentStatus): number {
  return Math.max(
    agent.updatedAt,
    agent.lastTurn?.startedAt ?? Number.NEGATIVE_INFINITY,
    agent.lastTurn?.completedAt ?? Number.NEGATIVE_INFINITY,
  );
}

function turnPublicStatus(
  turn: AgentLastTurn,
  currentStatus: AgentPublicStatus,
): AgentPublicStatus {
  if (turn.status === "failed") {
    return "error";
  }
  if (turn.status === "completed" || (turn.status === "interrupted" && turn.completedAt !== null)) {
    return "finished";
  }
  if (turn.status === "inProgress" || (turn.status === "interrupted" && turn.completedAt === null)) {
    return "working";
  }
  return currentStatus;
}

function readTimestampMs(value: unknown): number | null {
  return typeof value === "number" ? normalizeTimestampMs(value) : null;
}

function isOlderTurn(candidate: AgentLastTurn, current: AgentLastTurn | null): boolean {
  if (!current) {
    return false;
  }
  const candidateTime = turnTimeMs(candidate);
  const currentTime = turnTimeMs(current);
  return Number.isFinite(candidateTime) && Number.isFinite(currentTime) && candidateTime < currentTime;
}

function turnTimeMs(turn: AgentLastTurn): number {
  return Math.max(turn.startedAt ?? Number.NEGATIVE_INFINITY, turn.completedAt ?? Number.NEGATIVE_INFINITY);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
