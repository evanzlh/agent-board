import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { JsonRpcStdioClient } from "../../src/app-server/json-rpc.ts";

function fakeProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  return {
    stdin,
    stdout,
    stderr,
    kill: () => true,
    on: events.on.bind(events),
    once: events.once.bind(events),
    emit: events.emit.bind(events),
    written: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of stdin) {
        chunks.push(Buffer.from(chunk));
        break;
      }
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

test("request writes newline-delimited JSON and resolves matching response", async () => {
  const proc = fakeProcess();
  const client = new JsonRpcStdioClient(proc);
  const request = client.request("thread/list", { limit: 1 });

  const written = await proc.written();
  assert.match(written, /"method":"thread\/list"/);
  const parsed = JSON.parse(written);
  proc.stdout.write(`${JSON.stringify({ id: parsed.id, result: { data: [], nextCursor: null } })}\n`);

  assert.deepEqual(await request, { data: [], nextCursor: null });
});

test("notifications are emitted without resolving a request", async () => {
  const proc = fakeProcess();
  const client = new JsonRpcStdioClient(proc);
  const notifications: unknown[] = [];
  client.on("notification", (message) => notifications.push(message));

  proc.stdout.write(`${JSON.stringify({ method: "thread/status/changed", params: { threadId: "one" } })}\n`);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(notifications, [
    { method: "thread/status/changed", params: { threadId: "one" } },
  ]);
});

test("JSON-RPC error rejects the matching request", async () => {
  const proc = fakeProcess();
  const client = new JsonRpcStdioClient(proc);
  const request = client.request("thread/list", {});
  const written = JSON.parse(await proc.written());

  proc.stdout.write(
    `${JSON.stringify({ id: written.id, error: { code: -32601, message: "method not found" } })}\n`,
  );

  await assert.rejects(request, /method not found/);
});
