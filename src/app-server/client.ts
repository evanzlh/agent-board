import { EventEmitter } from "node:events";
import { applySessionApprovalEvidence } from "./session-evidence.ts";
import {
  findThreadSessionPath,
  readThreadSessionEvents,
  type SessionThreadReference,
} from "./session-files.ts";
import type { AppServerThread } from "../domain/types.ts";

const NOT_LOADED_HYDRATION_LIMIT = 25;

export type RpcLike = EventEmitter & {
  request: (method: string, params: unknown) => Promise<unknown>;
};

export type AppServerNotification = {
  method: string;
  params?: unknown;
};

export type AppServerClientOptions = {
  abandonedActiveSessionMs?: number;
  detectOrphanedSessions?: boolean;
  now?: () => number;
  resolveLiveCodexResumeSessionIds?: () => Promise<Set<string> | null>;
};

export type InitialAppServerState = {
  threads: AppServerThread[];
  loadedThreadIds: string[];
};

export class AppServerClient extends EventEmitter {
  readonly #rpc: RpcLike;
  readonly #options: AppServerClientOptions;
  #codexHome: string | null = null;

  constructor(rpc: RpcLike, options: AppServerClientOptions = {}) {
    super();
    this.#rpc = rpc;
    this.#options = options;
    this.#rpc.on("notification", (notification) => {
      this.emit("notification", notification as AppServerNotification);
    });
    this.#rpc.on("close", (event) => {
      this.emit("close", event);
    });
  }

  async initialize(): Promise<unknown> {
    const response = await this.#rpc.request("initialize", {
      clientInfo: { name: "codex-status", version: "0.1.0" },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    if (isObject(response) && typeof response.codexHome === "string") {
      this.#codexHome = response.codexHome;
    }
    return response;
  }

  async readInitialState(): Promise<InitialAppServerState> {
    const threads = await this.#readAllThreads();
    const loadedThreadIds = await this.#readAllLoadedThreadIds();
    const threadIdsToHydrate = selectThreadIdsToHydrate(threads, loadedThreadIds);
    const hydratedThreads = await this.#readThreads(threadIdsToHydrate);
    const mergedThreads = mergeHydratedThreads(threads, hydratedThreads);
    const threadsWithSessionEvidence = await applySessionApprovalEvidence(mergedThreads, {
      abandonedActiveSessionMs: this.#options.abandonedActiveSessionMs,
      codexHome: this.#codexHome,
      detectOrphanedSessions: this.#options.detectOrphanedSessions ?? false,
      now: this.#options.now,
      resolveLiveCodexResumeSessionIds: this.#options.resolveLiveCodexResumeSessionIds,
    });
    return { threads: threadsWithSessionEvidence, loadedThreadIds };
  }

  async readAgentSessionEvents(agent: SessionThreadReference): Promise<unknown[] | null> {
    if (!this.#codexHome) {
      return null;
    }
    const sessionPath = await findThreadSessionPath(this.#codexHome, agent);
    return sessionPath ? await readThreadSessionEvents(sessionPath) : null;
  }

  async #readAllThreads(): Promise<AppServerThread[]> {
    const all: AppServerThread[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();

    do {
      const response = (await this.#rpc.request("thread/list", {
        cursor,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: [
          "cli",
          "vscode",
          "exec",
          "appServer",
          "subAgent",
          "subAgentReview",
          "subAgentCompact",
          "subAgentThreadSpawn",
          "subAgentOther",
          "unknown",
        ],
        archived: false,
      })) as { data?: AppServerThread[]; nextCursor?: string | null };
      all.push(...(response.data ?? []));
      cursor = readNextCursor("thread/list", response.nextCursor ?? null, seenCursors);
    } while (cursor);

    return all;
  }

  async #readAllLoadedThreadIds(): Promise<string[]> {
    const all: string[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();

    do {
      const response = (await this.#rpc.request("thread/loaded/list", {
        cursor,
        limit: 100,
      })) as { data?: string[]; nextCursor?: string | null };
      all.push(...(response.data ?? []));
      cursor = readNextCursor("thread/loaded/list", response.nextCursor ?? null, seenCursors);
    } while (cursor);

    return all;
  }

  async #readThreads(threadIds: string[]): Promise<AppServerThread[]> {
    const threads: AppServerThread[] = [];
    for (const threadId of threadIds) {
      const response = (await this.#rpc.request("thread/read", {
        threadId,
        includeTurns: true,
      })) as { thread?: AppServerThread };
      if (response.thread) {
        threads.push(response.thread);
      }
    }
    return threads;
  }
}

function selectThreadIdsToHydrate(threads: AppServerThread[], loadedThreadIds: string[]): string[] {
  const threadIds = new Set(loadedThreadIds);
  let notLoadedCount = 0;

  for (const thread of threads) {
    if (notLoadedCount >= NOT_LOADED_HYDRATION_LIMIT) {
      break;
    }
    if (!isNotLoadedThread(thread) || threadIds.has(thread.id)) {
      continue;
    }
    threadIds.add(thread.id);
    notLoadedCount += 1;
  }

  return [...threadIds];
}

function isNotLoadedThread(thread: AppServerThread): boolean {
  return isObject(thread.status) && thread.status.type === "notLoaded";
}

function mergeHydratedThreads(
  threads: AppServerThread[],
  hydratedThreads: AppServerThread[],
): AppServerThread[] {
  if (hydratedThreads.length === 0) {
    return threads;
  }

  const loadedById = new Map(hydratedThreads.map((thread) => [thread.id, thread]));
  const seen = new Set<string>();
  const merged = threads.map((thread) => {
    seen.add(thread.id);
    return loadedById.get(thread.id) ?? thread;
  });

  for (const thread of hydratedThreads) {
    if (!seen.has(thread.id)) {
      merged.push(thread);
    }
  }

  return merged;
}

function readNextCursor(method: string, cursor: string | null, seenCursors: Set<string>): string | null {
  if (cursor === null) {
    return null;
  }
  if (seenCursors.has(cursor)) {
    throw new Error(`${method} returned repeated cursor: ${cursor}`);
  }
  seenCursors.add(cursor);
  return cursor;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
