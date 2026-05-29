import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AppServerClient } from "../../src/app-server/client.ts";

class FakeRpc extends EventEmitter {
  requests: Array<{ method: string; params: unknown }> = [];
  responses = new Map<string, unknown[]>();

  respond(method: string, ...responses: unknown[]): void {
    this.responses.set(method, responses);
  }

  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    const responses = this.responses.get(method) ?? [];
    return responses.shift();
  }
}

test("client initializes and fetches all thread pages", async () => {
  const rpc = new FakeRpc();
  rpc.respond("initialize", { userAgent: "codex", codexHome: "/home/me/.codex" });
  rpc.respond(
    "thread/list",
    {
      data: [{ id: "thread-one" }],
      nextCursor: "threads-page-2",
      backwardsCursor: null,
    },
    { data: [{ id: "thread-two" }], nextCursor: null, backwardsCursor: null },
  );
  rpc.respond(
    "thread/loaded/list",
    { data: ["one"], nextCursor: "loaded-page-2" },
    { data: ["two"], nextCursor: null },
  );

  const client = new AppServerClient(rpc);
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state, {
    threads: [{ id: "thread-one" }, { id: "thread-two" }],
    loadedThreadIds: ["one", "two"],
  });
  assert.deepEqual(rpc.requests.map((request) => request.method), [
    "initialize",
    "thread/list",
    "thread/list",
    "thread/loaded/list",
    "thread/loaded/list",
  ]);
  assert.deepEqual(
    rpc.requests.map((request) => request.params),
    [
      {
        clientInfo: { name: "codex-status", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
      {
        cursor: null,
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
      },
      {
        cursor: "threads-page-2",
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
      },
      { cursor: null, limit: 100 },
      { cursor: "loaded-page-2", limit: 100 },
    ],
  );
});

test("client rejects repeated pagination cursors", async () => {
  const rpc = new FakeRpc();
  rpc.respond(
    "thread/list",
    { data: [], nextCursor: "same" },
    { data: [], nextCursor: "same" },
  );

  const client = new AppServerClient(rpc);

  await assert.rejects(() => client.readInitialState(), /thread\/list returned repeated cursor: same/);
});

test("client rejects repeated loaded-thread pagination cursors", async () => {
  const rpc = new FakeRpc();
  rpc.respond("thread/list", { data: [], nextCursor: null });
  rpc.respond(
    "thread/loaded/list",
    { data: [], nextCursor: "same" },
    { data: [], nextCursor: "same" },
  );

  const client = new AppServerClient(rpc);

  await assert.rejects(
    () => client.readInitialState(),
    /thread\/loaded\/list returned repeated cursor: same/,
  );
});

test("client emits normalized notifications", async () => {
  const rpc = new FakeRpc();
  const client = new AppServerClient(rpc);
  const notifications: unknown[] = [];
  client.on("notification", (notification) => notifications.push(notification));

  rpc.emit("notification", {
    method: "thread/status/changed",
    params: { threadId: "one", status: { type: "idle" } },
  });

  assert.deepEqual(notifications, [
    { method: "thread/status/changed", params: { threadId: "one", status: { type: "idle" } } },
  ]);
});

test("client forwards close events from the RPC transport", () => {
  const rpc = new FakeRpc();
  const client = new AppServerClient(rpc);
  const closes: unknown[] = [];
  client.on("close", (event) => closes.push(event));

  rpc.emit("close", { code: 1, signal: null });

  assert.deepEqual(closes, [{ code: 1, signal: null }]);
});
