import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { StatusStore } from "../../src/store/status-store.ts";
import { createHttpApi } from "../../src/http/api.ts";
import type { AppServerThread } from "../../src/domain/types.ts";

function thread(id: string, status: AppServerThread["status"]): AppServerThread {
  return {
    id,
    sessionId: `session-${id}`,
    forkedFromId: null,
    preview: `Preview ${id}`,
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    status,
    path: null,
    cwd: "/repo",
    cliVersion: "0.135.0",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

async function withServer(
  run: (baseUrl: string, store: StatusStore) => Promise<void>,
): Promise<void> {
  const store = new StatusStore({ staleAfterMs: 30000, now: () => 1000 });
  store.setAppServerConnection({
    connected: true,
    autoStarted: true,
    mode: "managed-child",
    cliVersion: "0.135.0",
  });
  store.replaceThreads([
    thread("idle-1", { type: "idle" }),
    thread("work-1", { type: "active", activeFlags: [] }),
  ]);
  const api = createHttpApi({ host: "127.0.0.1", port: 0, store });
  await api.start();
  try {
    await run(api.url(), store);
  } finally {
    await api.stop();
  }
}

async function listenOnEphemeralPort(): Promise<http.Server> {
  const server = http.createServer((_request, response) => response.end("busy"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function sendRawHttpRequest(port: number, request: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw HTTP request timed out"));
    }, 1000);

    socket.on("connect", () => socket.write(request));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("error", reject);
    socket.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

test("GET /health returns health JSON", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.appServer.connected, true);
  });
});

test("GET /status and /agents return snapshots", async () => {
  await withServer(async (baseUrl) => {
    const status = await (await fetch(`${baseUrl}/status`)).json();
    assert.equal(status.summary.total, 2);
    assert.equal(status.summary.working, 1);

    const agents = await (await fetch(`${baseUrl}/agents?status=working`)).json();
    assert.deepEqual(
      agents.map((agent: { id: string }) => agent.id),
      ["work-1"],
    );
  });
});

test("GET /agents/:id returns one agent or JSON 404", async () => {
  await withServer(async (baseUrl) => {
    const found = await fetch(`${baseUrl}/agents/idle-1`);
    assert.equal(found.status, 200);
    assert.equal((await found.json()).id, "idle-1");

    const missing = await fetch(`${baseUrl}/agents/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "agent_not_found", id: "missing" });
  });
});

test("GET /agents/:id returns JSON 400 for malformed encoded IDs", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/agents/%E0%A4%A`, {
      signal: AbortSignal.timeout(1000),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "bad_request",
      message: "malformed_agent_id",
    });
  });
});

test("API returns JSON errors for non-GET methods and unknown paths", async () => {
  await withServer(async (baseUrl) => {
    const method = await fetch(`${baseUrl}/status`, { method: "POST" });
    assert.equal(method.status, 405);
    assert.deepEqual(await method.json(), { error: "method_not_allowed" });

    const missing = await fetch(`${baseUrl}/missing-route`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "not_found" });
  });
});

test("API returns JSON 400 for malformed request targets", async () => {
  await withServer(async (baseUrl) => {
    const port = Number(new URL(baseUrl).port);
    const raw = await sendRawHttpRequest(
      port,
      "GET http://% HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    );

    assert.match(raw, /^HTTP\/1\.1 400 Bad Request/);
    assert.match(raw, /"error":"bad_request"/);
    assert.match(raw, /"message":"malformed_request_target"/);
  });
});

test("GET /events streams agent.updated events", async () => {
  await withServer(async (baseUrl, store) => {
    const abort = new AbortController();
    const response = await fetch(`${baseUrl}/events`, {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type")?.split(";")[0].trim(), "text/event-stream");

    const reader = response.body!.getReader();
    store.upsertThread(thread("work-1", { type: "active", activeFlags: ["waitingOnApproval"] }));
    const { value } = await reader.read();
    abort.abort();

    const chunk = new TextDecoder().decode(value);
    assert.match(chunk, /event: agent.updated/);
    assert.match(chunk, /"agentId":"work-1"/);
    await new Promise((resolve) => setImmediate(resolve));
  });
});

test("start failure does not leave a store event listener attached", async () => {
  const blocker = await listenOnEphemeralPort();
  try {
    const address = blocker.address() as AddressInfo;
    const store = new StatusStore({ staleAfterMs: 30000, now: () => 1000 });
    const api = createHttpApi({ host: "127.0.0.1", port: address.port, store });

    await assert.rejects(() => api.start());

    assert.equal(store.listenerCount("event"), 0);
  } finally {
    await closeServer(blocker);
  }
});
