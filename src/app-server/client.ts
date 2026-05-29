import { EventEmitter } from "node:events";
import type { AppServerThread } from "../domain/types.ts";

export type RpcLike = EventEmitter & {
  request: (method: string, params: unknown) => Promise<unknown>;
};

export type AppServerNotification = {
  method: string;
  params?: unknown;
};

export type InitialAppServerState = {
  threads: AppServerThread[];
  loadedThreadIds: string[];
};

export class AppServerClient extends EventEmitter {
  readonly #rpc: RpcLike;

  constructor(rpc: RpcLike) {
    super();
    this.#rpc = rpc;
    this.#rpc.on("notification", (notification) => {
      this.emit("notification", notification as AppServerNotification);
    });
    this.#rpc.on("close", (event) => {
      this.emit("close", event);
    });
  }

  async initialize(): Promise<unknown> {
    return await this.#rpc.request("initialize", {
      clientInfo: { name: "codex-status", version: "0.1.0" },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
  }

  async readInitialState(): Promise<InitialAppServerState> {
    const threads = await this.#readAllThreads();
    const loadedThreadIds = await this.#readAllLoadedThreadIds();
    const loadedThreads = await this.#readLoadedThreads(loadedThreadIds);
    return { threads: mergeLoadedThreads(threads, loadedThreads), loadedThreadIds };
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

  async #readLoadedThreads(threadIds: string[]): Promise<AppServerThread[]> {
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

function mergeLoadedThreads(
  threads: AppServerThread[],
  loadedThreads: AppServerThread[],
): AppServerThread[] {
  if (loadedThreads.length === 0) {
    return threads;
  }

  const loadedById = new Map(loadedThreads.map((thread) => [thread.id, thread]));
  const seen = new Set<string>();
  const merged = threads.map((thread) => {
    seen.add(thread.id);
    return loadedById.get(thread.id) ?? thread;
  });

  for (const thread of loadedThreads) {
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
