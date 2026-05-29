import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { startDaemon } from "../src/daemon.ts";
import type { AppServerThread } from "../src/domain/types.ts";

const execFileAsync = promisify(execFile);

class FakeClient extends EventEmitter {
  initializeCalls = 0;
  readCalls = 0;
  initializeError: Error | null = null;
  threads: AppServerThread[] = [];

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
    if (this.initializeError) {
      throw this.initializeError;
    }
  }

  async readInitialState(): Promise<{ threads: AppServerThread[]; loadedThreadIds: [] }> {
    this.readCalls += 1;
    return { threads: this.threads, loadedThreadIds: [] };
  }
}

function thread(id: string, status: AppServerThread["status"]): AppServerThread {
  return {
    id,
    sessionId: `session-${id}`,
    forkedFromId: null,
    preview: "Preview",
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

test("startDaemon wires supervisor, client, store, and http api", async () => {
  const calls: string[] = [];
  const daemon = await startDaemon({
    config: {
      host: "127.0.0.1",
      port: 0,
      autoStartAppServer: true,
      refreshIntervalMs: 100,
      staleAfterMs: 1000,
    },
    now: () => 1000,
    supervisor: {
      async start() {
        calls.push("supervisor.start");
        return {
          mode: "managed-child",
          cliVersion: "codex-cli 0.135.0",
          process: { kill: () => true },
          stop: () => calls.push("appServer.stop"),
        };
      },
    },
    clientFactory: () => ({
      on() {},
      async initialize() {
        calls.push("client.initialize");
      },
      async readInitialState() {
        calls.push("client.readInitialState");
        return {
          loadedThreadIds: [],
          threads: [
            {
              id: "one",
              sessionId: "session-one",
              forkedFromId: null,
              preview: "Preview",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 2,
              status: { type: "idle" },
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
            },
          ],
        };
      },
    }),
  });

  const health = await (await fetch(`${daemon.url}/health`)).json();
  assert.equal(health.appServer.connected, true);

  const status = await (await fetch(`${daemon.url}/status`)).json();
  assert.equal(status.summary.total, 1);

  await daemon.stop();
  assert.deepEqual(calls, [
    "supervisor.start",
    "client.initialize",
    "client.readInitialState",
    "appServer.stop",
  ]);
});

test("startDaemon applies client notifications to the status store", async () => {
  const client = new FakeClient();
  client.threads = [thread("one", { type: "idle" })];
  const daemon = await startDaemon({
    config: {
      host: "127.0.0.1",
      port: 0,
      autoStartAppServer: true,
      refreshIntervalMs: 100,
      staleAfterMs: 1000,
    },
    now: () => 1000,
    supervisor: {
      async start() {
        return {
          mode: "managed-child",
          cliVersion: "codex-cli 0.135.0",
          process: { kill: () => true },
          stop: () => {},
        };
      },
    },
    clientFactory: () => client,
  });

  client.emit("notification", {
    method: "thread/status/changed",
    params: { threadId: "one", status: { type: "active", activeFlags: ["waitingOnApproval"] } },
  });

  const agent = await (await fetch(`${daemon.url}/agents/one`)).json();
  assert.equal(agent.status, "waiting_approval");

  await daemon.stop();
});

test("startDaemon stops app server when client initialization fails", async () => {
  const client = new FakeClient();
  client.initializeError = new Error("initialize failed");
  const calls: string[] = [];

  await assert.rejects(
    () =>
      startDaemon({
        config: {
          host: "127.0.0.1",
          port: 0,
          autoStartAppServer: true,
          refreshIntervalMs: 100,
          staleAfterMs: 1000,
        },
        supervisor: {
          async start() {
            calls.push("supervisor.start");
            return {
              mode: "managed-child",
              cliVersion: "codex-cli 0.135.0",
              process: { kill: () => true },
              stop: () => calls.push("appServer.stop"),
            };
          },
        },
        clientFactory: () => client,
      }),
    /initialize failed/,
  );

  assert.deepEqual(calls, ["supervisor.start", "appServer.stop"]);
});

test("daemon stop is idempotent", async () => {
  const calls: string[] = [];
  const daemon = await startDaemon({
    config: {
      host: "127.0.0.1",
      port: 0,
      autoStartAppServer: true,
      refreshIntervalMs: 100,
      staleAfterMs: 1000,
    },
    supervisor: {
      async start() {
        return {
          mode: "managed-child",
          cliVersion: "codex-cli 0.135.0",
          process: { kill: () => true },
          stop: () => calls.push("appServer.stop"),
        };
      },
    },
    clientFactory: () => new FakeClient(),
  });

  await daemon.stop();
  await daemon.stop();

  assert.deepEqual(calls, ["appServer.stop"]);
});

test("daemon stop attempts app server cleanup when http stop fails", async () => {
  const calls: string[] = [];
  const daemon = await startDaemon({
    config: {
      host: "127.0.0.1",
      port: 0,
      autoStartAppServer: true,
      refreshIntervalMs: 100,
      staleAfterMs: 1000,
    },
    supervisor: {
      async start() {
        return {
          mode: "managed-child",
          cliVersion: "codex-cli 0.135.0",
          process: { kill: () => true },
          stop: () => calls.push("appServer.stop"),
        };
      },
    },
    clientFactory: () => new FakeClient(),
    httpApiFactory: () => ({
      start: async () => {},
      stop: async () => {
        calls.push("api.stop");
        throw new Error("api stop failed");
      },
      url: () => "http://127.0.0.1:0",
    }),
  });

  await assert.rejects(() => daemon.stop(), /api stop failed/);

  assert.deepEqual(calls, ["api.stop", "appServer.stop"]);
});

test("CLI without a command exits non-zero and prints Unknown command", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, ["src/cli.ts"], { cwd: process.cwd() }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const childError = error as Error & {
        code?: number;
        stderr?: string;
      };
      assert.equal(childError.code, 1);
      assert.match(childError.stderr ?? "", /Unknown command/);
      return true;
    },
  );
});
