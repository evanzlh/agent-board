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
    return { threads, loadedThreadIds };
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
