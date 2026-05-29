import { EventEmitter } from "node:events";
import { VERSION } from "../version.ts";
import { inferRawStatusFromTurn, mapThreadStatus, normalizeThread } from "../domain/mapper.ts";
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

    if (
      notification.method === "item/started" ||
      notification.method === "item/completed" ||
      notification.method === "serverRequest/resolved"
    ) {
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
    return [...this.#agents.values()]
      .filter((agent) => !filters.status || agent.status === filters.status)
      .filter((agent) => !filters.kind || agent.kind === filters.kind)
      .filter((agent) => !filters.cwd || agent.cwd === filters.cwd)
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
    const nextStatus = mapThreadStatus(params.status, current.lastTurn);
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
    const nextTurn: AgentLastTurn = {
      status: readTurnStatus(turn.status),
      startedAt: readNumber(turn.startedAt) ?? previousTurn?.startedAt ?? null,
      completedAt: readNumber(turn.completedAt) ?? null,
    };
    const updated = {
      ...current,
      lastTurn: nextTurn,
      status: turnPublicStatus(nextTurn.status, current.status),
      rawStatus: inferRawStatusFromTurn(current.rawStatus, nextTurn),
      lastEventAt: this.#now(),
      stale: false,
    } satisfies AgentStatus;
    this.#setAgent(updated);
  }

  #touchAgent(params: unknown): void {
    if (!isObject(params) || typeof params.threadId !== "string") {
      return;
    }
    const current = this.#agents.get(params.threadId);
    if (!current) {
      return;
    }
    this.#setAgent({
      ...current,
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
    waitingApproval: 0,
    waitingInput: 0,
    error: 0,
    unknown: 0,
  };

  for (const agent of agents) {
    if (agent.status === "working") summary.working += 1;
    else if (agent.status === "idle") summary.idle += 1;
    else if (agent.status === "waiting_approval") summary.waitingApproval += 1;
    else if (agent.status === "waiting_input") summary.waitingInput += 1;
    else if (agent.status === "error") summary.error += 1;
    else if (agent.status === "unknown") summary.unknown += 1;
  }

  return summary;
}

function readTurnStatus(value: unknown): AgentLastTurn["status"] {
  return value === "completed" || value === "interrupted" || value === "failed" || value === "inProgress"
    ? value
    : "unknown";
}

function turnPublicStatus(
  turnStatus: AgentLastTurn["status"],
  currentStatus: AgentPublicStatus,
): AgentPublicStatus {
  if (turnStatus === "failed") {
    return "error";
  }
  if (turnStatus === "inProgress") {
    return "working";
  }
  return currentStatus;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
