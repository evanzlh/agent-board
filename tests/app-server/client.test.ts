import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AppServerClient } from "../../src/app-server/client.ts";

class FakeRpc extends EventEmitter {
  requests: Array<{ method: string; params: unknown }> = [];
  responses = new Map<string, unknown>();

  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    return this.responses.get(method);
  }
}

test("client initializes and fetches all thread pages", async () => {
  const rpc = new FakeRpc();
  rpc.responses.set("initialize", { userAgent: "codex", codexHome: "/home/me/.codex" });
  rpc.responses.set("thread/list", {
    data: [],
    nextCursor: null,
    backwardsCursor: null,
  });
  rpc.responses.set("thread/loaded/list", { data: ["one"], nextCursor: null });

  const client = new AppServerClient(rpc);
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state, { threads: [], loadedThreadIds: ["one"] });
  assert.deepEqual(rpc.requests.map((request) => request.method), [
    "initialize",
    "thread/list",
    "thread/loaded/list",
  ]);
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
