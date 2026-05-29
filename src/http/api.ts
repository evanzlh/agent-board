import http from "node:http";
import type { AddressInfo } from "node:net";
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

  options.store.on("event", onStoreEvent);

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          server.off("error", reject);
          resolve();
        });
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        options.store.off("event", onStoreEvent);
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
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
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
    const id = decodeURIComponent(url.pathname.slice("/agents/".length));
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

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
