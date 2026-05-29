import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { AgentFilters, StatusStore, StoreEvent } from "../store/status-store.ts";

export type HttpApiOptions = {
  host: string;
  port: number;
  store: StatusStore;
};

export type HttpApi = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  url: () => string;
};

type UiAsset = {
  path: string;
  contentType: string;
};

const UI_INDEX_PATH = fileURLToPath(new URL("../ui/index.html", import.meta.url));
const UI_APP_PATH = fileURLToPath(new URL("../ui/app.js", import.meta.url));
const UI_VIEW_MODEL_PATH = fileURLToPath(new URL("../ui/view-model.js", import.meta.url));
const UI_STYLES_PATH = fileURLToPath(new URL("../ui/styles.css", import.meta.url));

const UI_ASSETS = new Map<string, UiAsset>([
  ["/ui", { path: UI_INDEX_PATH, contentType: "text/html; charset=utf-8" }],
  ["/ui/", { path: UI_INDEX_PATH, contentType: "text/html; charset=utf-8" }],
  ["/ui/app.js", { path: UI_APP_PATH, contentType: "text/javascript; charset=utf-8" }],
  [
    "/ui/view-model.js",
    { path: UI_VIEW_MODEL_PATH, contentType: "text/javascript; charset=utf-8" },
  ],
  ["/ui/styles.css", { path: UI_STYLES_PATH, contentType: "text/css; charset=utf-8" }],
]);

export function createHttpApi(options: HttpApiOptions): HttpApi {
  const sseClients = new Set<http.ServerResponse>();
  const server = http.createServer((request, response) => {
    void handleRequest(options.store, sseClients, request, response);
  });

  const onStoreEvent = (event: StoreEvent): void => {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  };
  let subscribed = false;

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          server.off("error", reject);
          if (!subscribed) {
            options.store.on("event", onStoreEvent);
            subscribed = true;
          }
          resolve();
        });
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        if (subscribed) {
          options.store.off("event", onStoreEvent);
          subscribed = false;
        }
        for (const client of sseClients) {
          client.end();
        }
        sseClients.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: () => {
      const address = server.address() as AddressInfo;
      return `http://${address.address}:${address.port}`;
    },
  };
}

async function handleRequest(
  store: StatusStore,
  sseClients: Set<http.ServerResponse>,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const url = parseRequestUrl(request.url ?? "/");
  if (url === null) {
    sendJson(response, 400, { error: "bad_request", message: "malformed_request_target" });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  const rawPathname = request.url?.split("?", 1)[0] ?? "/";
  if (await sendUiAsset(rawPathname, response)) {
    return;
  }

  if (rawPathname === "/ui" || rawPathname.startsWith("/ui/")) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (url.pathname === "/health") {
    sendJson(response, 200, store.getHealth());
    return;
  }

  if (url.pathname === "/status") {
    sendJson(response, 200, store.getStatus());
    return;
  }

  if (url.pathname === "/agents") {
    sendJson(response, 200, store.getAgents(parseFilters(url)));
    return;
  }

  if (url.pathname.startsWith("/agents/")) {
    const id = decodePathSegment(url.pathname.slice("/agents/".length));
    if (id === null) {
      sendJson(response, 400, { error: "bad_request", message: "malformed_agent_id" });
      return;
    }
    const agent = store.getAgent(id);
    if (!agent) {
      sendJson(response, 404, { error: "agent_not_found", id });
      return;
    }
    sendJson(response, 200, agent);
    return;
  }

  if (url.pathname === "/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.flushHeaders();
    sseClients.add(response);
    request.on("close", () => sseClients.delete(response));
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

async function sendUiAsset(pathname: string, response: http.ServerResponse): Promise<boolean> {
  const asset = UI_ASSETS.get(pathname);
  if (!asset) {
    return false;
  }

  try {
    const body = await readFile(asset.path);
    response.writeHead(200, {
      "content-type": asset.contentType,
      "cache-control": "no-cache",
    });
    response.end(body);
  } catch {
    sendJson(response, 500, {
      error: "ui_asset_unavailable",
      message: "UI asset unavailable",
    });
  }
  return true;
}

function parseFilters(url: URL): AgentFilters {
  const filters: AgentFilters = {};
  const status = url.searchParams.get("status");
  const kind = url.searchParams.get("kind");
  const cwd = url.searchParams.get("cwd");
  if (status) {
    filters.status = status as AgentFilters["status"];
  }
  if (kind) {
    filters.kind = kind as AgentFilters["kind"];
  }
  if (cwd) {
    filters.cwd = cwd;
  }
  return filters;
}

function parseRequestUrl(value: string): URL | null {
  try {
    return new URL(value, "http://127.0.0.1");
  } catch {
    return null;
  }
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
