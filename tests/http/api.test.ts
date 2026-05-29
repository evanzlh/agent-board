import test from "node:test";
import assert from "node:assert/strict";
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
