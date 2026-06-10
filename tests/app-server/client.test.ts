import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    { data: ["thread-one"], nextCursor: "loaded-page-2" },
    { data: ["thread-two"], nextCursor: null },
  );
  rpc.respond(
    "thread/read",
    { thread: { id: "thread-one", status: { type: "active", activeFlags: [] } } },
    { thread: { id: "thread-two", status: { type: "idle" } } },
  );

  const client = new AppServerClient(rpc);
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state, {
    threads: [
      { id: "thread-one", status: { type: "active", activeFlags: [] } },
      { id: "thread-two", status: { type: "idle" } },
    ],
    loadedThreadIds: ["thread-one", "thread-two"],
  });
  assert.deepEqual(rpc.requests.map((request) => request.method), [
    "initialize",
    "thread/list",
    "thread/list",
    "thread/loaded/list",
    "thread/loaded/list",
    "thread/read",
    "thread/read",
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
      { threadId: "thread-one", includeTurns: true },
      { threadId: "thread-two", includeTurns: true },
    ],
  );
});

test("client hydrates loaded threads with live thread details", async () => {
  const rpc = new FakeRpc();
  rpc.respond("thread/list", {
    data: [{ id: "one", status: { type: "notLoaded" }, turns: [] }],
    nextCursor: null,
    backwardsCursor: null,
  });
  rpc.respond("thread/loaded/list", { data: ["one"], nextCursor: null });
  rpc.respond("thread/read", {
    thread: {
      id: "one",
      status: { type: "active", activeFlags: [] },
      turns: [{ status: "inProgress", startedAt: 1000, completedAt: null }],
    },
  });

  const client = new AppServerClient(rpc);
  const state = await client.readInitialState();

  assert.deepEqual(state.threads, [
    {
      id: "one",
      status: { type: "active", activeFlags: [] },
      turns: [{ status: "inProgress", startedAt: 1000, completedAt: null }],
    },
  ]);
  assert.deepEqual(state.loadedThreadIds, ["one"]);
  assert.deepEqual(rpc.requests.map((request) => request.method), [
    "thread/list",
    "thread/loaded/list",
    "thread/read",
  ]);
  assert.deepEqual(rpc.requests.at(-1)?.params, {
    threadId: "one",
    includeTurns: true,
  });
});

test("client hydrates recent notLoaded threads so turn evidence is visible", async () => {
  const rpc = new FakeRpc();
  rpc.respond("thread/list", {
    data: [
      {
        id: "working-not-loaded",
        status: { type: "notLoaded" },
        updatedAt: 1780067292,
        turns: [],
      },
    ],
    nextCursor: null,
  });
  rpc.respond("thread/loaded/list", { data: [], nextCursor: null });
  rpc.respond("thread/read", {
    thread: {
      id: "working-not-loaded",
      status: { type: "notLoaded" },
      updatedAt: 1780067292,
      turns: [{ status: "interrupted", startedAt: 1780067247, completedAt: null }],
    },
  });

  const client = new AppServerClient(rpc);
  const state = await client.readInitialState();

  assert.deepEqual(state.threads, [
    {
      id: "working-not-loaded",
      status: { type: "notLoaded" },
      updatedAt: 1780067292,
      turns: [{ status: "interrupted", startedAt: 1780067247, completedAt: null }],
    },
  ]);
  assert.deepEqual(state.loadedThreadIds, []);
  assert.deepEqual(rpc.requests.map((request) => request.method), [
    "thread/list",
    "thread/loaded/list",
    "thread/read",
  ]);
  assert.deepEqual(rpc.requests.at(-1)?.params, {
    threadId: "working-not-loaded",
    includeTurns: true,
  });
});

test("client marks unresolved session escalation as waiting approval evidence", async () => {
  const codexHome = await writeSession(
    "pending-approval",
    "2026/06/01",
    [
      {
        timestamp: "2026-06-01T07:39:01.119Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ sandbox_permissions: "require_escalated" }),
          call_id: "call-1",
        },
      },
    ],
  );
  const rpc = new FakeRpc();
  rpc.respond("initialize", { userAgent: "codex", codexHome });
  rpc.respond("thread/list", {
    data: [
      {
        id: "pending-approval",
        sessionId: "pending-approval",
        status: { type: "notLoaded" },
        createdAt: Date.parse("2026-06-01T06:04:20.000Z"),
        updatedAt: Date.parse("2026-06-01T07:39:01.000Z"),
        turns: [],
      },
    ],
    nextCursor: null,
  });
  rpc.respond("thread/loaded/list", { data: [], nextCursor: null });
  rpc.respond("thread/read", {
    thread: {
      id: "pending-approval",
      sessionId: "pending-approval",
      status: { type: "notLoaded" },
      createdAt: Date.parse("2026-06-01T06:04:20.000Z"),
      updatedAt: Date.parse("2026-06-01T07:39:01.000Z"),
      turns: [{ status: "interrupted", startedAt: 1780299526, completedAt: null }],
    },
  });

  const client = new AppServerClient(rpc);
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state.threads[0]?.status, {
    type: "active",
    activeFlags: ["waitingOnApproval"],
  });
});

test("client marks orphaned active sessions as unknown", async () => {
  const codexHome = await writeSession(
    "orphaned-active",
    "2026/06/02",
    [{ timestamp: "2026-06-02T15:16:53.000Z", type: "response_item", payload: {} }],
  );
  await writeShellSnapshot(codexHome, "orphaned-active", "dead-session");

  const rpc = new FakeRpc();
  rpc.respond("initialize", { userAgent: "codex", codexHome });
  rpc.respond("thread/list", {
    data: [
      {
        id: "orphaned-active",
        sessionId: "orphaned-active",
        status: { type: "active", activeFlags: [] },
        createdAt: Date.parse("2026-06-02T15:00:00.000Z"),
        updatedAt: Date.parse("2026-06-02T15:16:53.000Z"),
        turns: [{ status: "inProgress", startedAt: 1780041373, completedAt: null }],
      },
    ],
    nextCursor: null,
  });
  rpc.respond("thread/loaded/list", { data: [], nextCursor: null });
  rpc.respond("thread/read", {
    thread: {
      id: "orphaned-active",
      sessionId: "orphaned-active",
      status: { type: "active", activeFlags: [] },
      createdAt: Date.parse("2026-06-02T15:00:00.000Z"),
      updatedAt: Date.parse("2026-06-02T15:16:53.000Z"),
      turns: [{ status: "inProgress", startedAt: 1780041373, completedAt: null }],
    },
  });

  const client = new AppServerClient(rpc, {
    detectOrphanedSessions: true,
    resolveLiveCodexResumeSessionIds: async () => new Set(),
  });
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state.threads[0]?.status, {
    type: "active",
    activeFlags: ["orphanedSession"],
  });
});

test("client parses declared WT_SESSION lines when detecting orphaned sessions", async () => {
  const codexHome = await writeSession(
    "orphaned-declared",
    "2026/06/03",
    [{ timestamp: "2026-06-03T10:00:00.000Z", type: "response_item", payload: {} }],
  );
  await writeShellSnapshot(
    codexHome,
    "orphaned-declared",
    "dead-declared-session",
    "declare",
  );

  const rpc = new FakeRpc();
  rpc.respond("initialize", { userAgent: "codex", codexHome });
  rpc.respond("thread/list", {
    data: [
      {
        id: "orphaned-declared",
        sessionId: "orphaned-declared",
        status: { type: "active", activeFlags: [] },
        createdAt: Date.parse("2026-06-03T09:30:00.000Z"),
        updatedAt: Date.parse("2026-06-03T10:00:00.000Z"),
        turns: [{ status: "inProgress", startedAt: 1780381373, completedAt: null }],
      },
    ],
    nextCursor: null,
  });
  rpc.respond("thread/loaded/list", { data: [], nextCursor: null });
  rpc.respond("thread/read", {
    thread: {
      id: "orphaned-declared",
      sessionId: "orphaned-declared",
      status: { type: "active", activeFlags: [] },
      createdAt: Date.parse("2026-06-03T09:30:00.000Z"),
      updatedAt: Date.parse("2026-06-03T10:00:00.000Z"),
      turns: [{ status: "inProgress", startedAt: 1780381373, completedAt: null }],
    },
  });

  const client = new AppServerClient(rpc, {
    detectOrphanedSessions: true,
    resolveLiveCodexResumeSessionIds: async () => new Set(),
  });
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state.threads[0]?.status, {
    type: "active",
    activeFlags: ["orphanedSession"],
  });
});

test("client marks abandoned active sessions without shell snapshots as orphaned", async () => {
  const codexHome = await writeSession(
    "abandoned-active",
    "2026/06/03",
    [
      {
        timestamp: "2026-06-03T10:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", started_at: 1780480800 },
      },
      {
        timestamp: "2026-06-03T10:00:02.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "version" },
      },
    ],
  );

  const rpc = new FakeRpc();
  rpc.respond("initialize", { userAgent: "codex", codexHome });
  rpc.respond("thread/list", {
    data: [
      {
        id: "abandoned-active",
        sessionId: "abandoned-active",
        status: { type: "active", activeFlags: [] },
        createdAt: Date.parse("2026-06-03T10:00:00.000Z"),
        updatedAt: Date.parse("2026-06-03T10:00:02.000Z"),
        turns: [{ status: "inProgress", startedAt: 1780480800, completedAt: null }],
      },
    ],
    nextCursor: null,
  });
  rpc.respond("thread/loaded/list", { data: [], nextCursor: null });
  rpc.respond("thread/read", {
    thread: {
      id: "abandoned-active",
      sessionId: "abandoned-active",
      status: { type: "active", activeFlags: [] },
      createdAt: Date.parse("2026-06-03T10:00:00.000Z"),
      updatedAt: Date.parse("2026-06-03T10:00:02.000Z"),
      turns: [{ status: "inProgress", startedAt: 1780480800, completedAt: null }],
    },
  });

  const client = new AppServerClient(rpc, {
    abandonedActiveSessionMs: 60 * 60 * 1000,
    detectOrphanedSessions: true,
    now: () => Date.parse("2026-06-03T12:00:00.000Z"),
    resolveLiveCodexResumeSessionIds: async () => new Set(["live-session"]),
  });
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state.threads[0]?.status, {
    type: "active",
    activeFlags: ["orphanedSession"],
  });
});

test("client ignores resolved session escalation evidence", async () => {
  const codexHome = await writeSession(
    "resolved-approval",
    "2026/06/01",
    [
      {
        timestamp: "2026-06-01T07:39:01.119Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ sandbox_permissions: "require_escalated" }),
          call_id: "call-1",
        },
      },
      {
        timestamp: "2026-06-01T07:39:03.119Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "approved command completed",
        },
      },
    ],
  );
  const rpc = new FakeRpc();
  rpc.respond("initialize", { userAgent: "codex", codexHome });
  rpc.respond("thread/list", {
    data: [
      {
        id: "resolved-approval",
        sessionId: "resolved-approval",
        status: { type: "notLoaded" },
        createdAt: Date.parse("2026-06-01T06:04:20.000Z"),
        updatedAt: Date.parse("2026-06-01T07:39:03.000Z"),
        turns: [],
      },
    ],
    nextCursor: null,
  });
  rpc.respond("thread/loaded/list", { data: [], nextCursor: null });
  rpc.respond("thread/read", {
    thread: {
      id: "resolved-approval",
      sessionId: "resolved-approval",
      status: { type: "notLoaded" },
      createdAt: Date.parse("2026-06-01T06:04:20.000Z"),
      updatedAt: Date.parse("2026-06-01T07:39:03.000Z"),
      turns: [{ status: "interrupted", startedAt: 1780299526, completedAt: null }],
    },
  });

  const client = new AppServerClient(rpc);
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state.threads[0]?.status, { type: "notLoaded" });
});

test("client ignores unresolved non-escalated session calls", async () => {
  const codexHome = await writeSession(
    "pending-read",
    "2026/06/01",
    [
      {
        timestamp: "2026-06-01T07:39:01.119Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pwd" }),
          call_id: "call-1",
        },
      },
    ],
  );
  const rpc = new FakeRpc();
  rpc.respond("initialize", { userAgent: "codex", codexHome });
  rpc.respond("thread/list", {
    data: [
      {
        id: "pending-read",
        sessionId: "pending-read",
        status: { type: "notLoaded" },
        createdAt: Date.parse("2026-06-01T06:04:20.000Z"),
        updatedAt: Date.parse("2026-06-01T07:39:01.000Z"),
        turns: [],
      },
    ],
    nextCursor: null,
  });
  rpc.respond("thread/loaded/list", { data: [], nextCursor: null });
  rpc.respond("thread/read", {
    thread: {
      id: "pending-read",
      sessionId: "pending-read",
      status: { type: "notLoaded" },
      createdAt: Date.parse("2026-06-01T06:04:20.000Z"),
      updatedAt: Date.parse("2026-06-01T07:39:01.000Z"),
      turns: [{ status: "interrupted", startedAt: 1780299526, completedAt: null }],
    },
  });

  const client = new AppServerClient(rpc);
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state.threads[0]?.status, { type: "notLoaded" });
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

async function writeSession(
  threadId: string,
  sessionDatePath: string,
  entries: unknown[],
): Promise<string> {
  const codexHome = await mkdtemp(join(tmpdir(), "codex-status-"));
  const sessionDir = join(codexHome, "sessions", ...sessionDatePath.split("/"));
  await mkdir(sessionDir, { recursive: true });
  const sessionPath = join(sessionDir, `rollout-2026-06-01T14-04-20-${threadId}.jsonl`);
  await writeFile(
    sessionPath,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
  return codexHome;
}

async function writeShellSnapshot(
  codexHome: string,
  threadId: string,
  wtSession: string,
  format: "plain" | "declare" = "plain",
): Promise<void> {
  const shellDir = join(codexHome, "shell_snapshots");
  await mkdir(shellDir, { recursive: true });
  const line =
    format === "declare"
      ? `declare -x WT_SESSION="${wtSession}"`
      : `WT_SESSION=${wtSession}`;
  await writeFile(
    join(shellDir, `${threadId}.${Date.now()}.sh`),
    `${line}\n`,
    "utf8",
  );
}
