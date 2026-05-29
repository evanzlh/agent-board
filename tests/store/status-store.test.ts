import test from "node:test";
import assert from "node:assert/strict";
import { StatusStore } from "../../src/store/status-store.ts";
import type { AppServerThread } from "../../src/domain/types.ts";

function thread(id: string, status: AppServerThread["status"], cwd = "/repo"): AppServerThread {
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
    cwd,
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

test("ingests initial threads and computes summary", () => {
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => 1000 });
  const finished = thread("finished-1", { type: "notLoaded" });
  finished.turns = [{ status: "completed", startedAt: 1, completedAt: 2 }];

  store.replaceThreads([
    thread("idle-1", { type: "idle" }),
    thread("work-1", { type: "active", activeFlags: [] }),
    thread("approval-1", { type: "active", activeFlags: ["waitingOnApproval"] }),
    finished,
  ]);

  const snapshot = store.getStatus();
  assert.equal(snapshot.summary.total, 4);
  assert.equal(snapshot.summary.idle, 1);
  assert.equal(snapshot.summary.working, 1);
  assert.equal(snapshot.summary.finished, 1);
  assert.equal(snapshot.summary.waitingApproval, 1);
});

test("filters agents by status, kind, and cwd", () => {
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => 1000 });
  const sub = thread("sub-1", { type: "active", activeFlags: [] }, "/other");
  sub.agentRole = "builder";

  store.replaceThreads([thread("idle-1", { type: "idle" }, "/repo"), sub]);

  assert.deepEqual(store.getAgents({ status: "working" }).map((agent) => agent.id), ["sub-1"]);
  assert.deepEqual(store.getAgents({ kind: "sub_agent" }).map((agent) => agent.id), ["sub-1"]);
  assert.deepEqual(store.getAgents({ cwd: "/repo" }).map((agent) => agent.id), ["idle-1"]);
});

test("updates a single thread and emits agent.updated", () => {
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => 1000 });
  const events: unknown[] = [];
  store.on("event", (event) => events.push(event));

  store.replaceThreads([thread("one", { type: "idle" })]);
  store.upsertThread(thread("one", { type: "active", activeFlags: ["waitingOnUserInput"] }));

  assert.equal(store.getAgent("one")?.status, "waiting_input");
  assert.deepEqual(events.at(-1), {
    type: "agent.updated",
    agentId: "one",
    status: "waiting_input",
    at: 1000,
  });
});

test("preserves waitingSince across same waiting status", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });

  store.upsertThread(thread("one", { type: "active", activeFlags: ["waitingOnApproval"] }));
  now = 2000;
  store.upsertThread(thread("one", { type: "active", activeFlags: ["waitingOnApproval"] }));

  assert.equal(store.getAgent("one")?.waitingSince, 1000);
});

test("marks stale agents when disconnected beyond staleAfterMs", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 5000, now: () => now });

  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);
  store.setAppServerConnection({ connected: false, lastError: "lost connection" });
  now = 7001;
  store.markStaleAgents();

  assert.equal(store.getAgent("one")?.stale, true);
  assert.equal(store.getHealth().appServer.connected, false);
  assert.equal(store.getHealth().appServer.lastError, "lost connection");
});

test("markStaleAgents emits agent.updated when an agent becomes stale", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 5000, now: () => now });
  const events: unknown[] = [];

  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);
  store.on("event", (event) => events.push(event));
  store.setAppServerConnection({ connected: false });
  now = 7001;

  store.markStaleAgents();

  assert.equal(store.getAgent("one")?.stale, true);
  assert.deepEqual(events, [
    {
      type: "agent.updated",
      agentId: "one",
      status: "working",
      at: 7001,
    },
  ]);
});

test("applies turn lifecycle notifications to lastTurn", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);

  now = 2000;
  store.applyNotification({
    method: "turn/started",
    params: { threadId: "one", turn: { status: "inProgress", startedAt: 2000 } },
  });
  assert.deepEqual(store.getAgent("one")?.lastTurn, {
    status: "inProgress",
    startedAt: 2000,
    completedAt: null,
  });

  now = 3000;
  store.applyNotification({
    method: "turn/completed",
    params: { threadId: "one", turn: { status: "completed", completedAt: 3000 } },
  });
  assert.equal(store.getAgent("one")?.status, "finished");
  assert.deepEqual(store.getAgent("one")?.lastTurn, {
    status: "completed",
    startedAt: 2000,
    completedAt: 3000,
  });
});

test("completed turn clears stale waiting approval evidence", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "active", activeFlags: ["waitingOnApproval"] })]);

  now = 2000;
  store.applyNotification({
    method: "turn/completed",
    params: { threadId: "one", turn: { status: "completed", completedAt: 2000 } },
  });

  const agent = store.getAgent("one");
  assert.equal(agent?.status, "finished");
  assert.equal(agent?.waitingSince, null);
});

test("failed turn followed by in-progress turn moves public status to working", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);

  now = 2000;
  store.applyNotification({
    method: "turn/completed",
    params: { threadId: "one", turn: { status: "failed", completedAt: 2000 } },
  });
  assert.equal(store.getAgent("one")?.status, "error");

  now = 3000;
  store.applyNotification({
    method: "turn/started",
    params: { threadId: "one", turn: { status: "inProgress", startedAt: 3000 } },
  });

  const agent = store.getAgent("one");
  assert.equal(agent?.lastTurn?.status, "inProgress");
  assert.equal(agent?.status, "working");
});

test("fresh idle status overrides stale in-progress turn evidence", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "notLoaded" })]);

  now = 2000;
  store.applyNotification({
    method: "turn/started",
    params: { threadId: "one", turn: { status: "inProgress", startedAt: 2000 } },
  });

  now = 3000;
  store.applyNotification({
    method: "thread/status/changed",
    params: { threadId: "one", status: { type: "idle" } },
  });

  const agent = store.getAgent("one");
  assert.equal(agent?.status, "idle");
  assert.deepEqual(agent?.rawStatus, { type: "idle" });
});

test("fresh active status overrides stale failed turn evidence", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);

  now = 2000;
  store.applyNotification({
    method: "turn/completed",
    params: { threadId: "one", turn: { status: "failed", completedAt: 2000 } },
  });

  now = 3000;
  store.applyNotification({
    method: "thread/status/changed",
    params: { threadId: "one", status: { type: "active", activeFlags: [] } },
  });

  const agent = store.getAgent("one");
  assert.equal(agent?.status, "working");
  assert.deepEqual(agent?.rawStatus, { type: "active", activeFlags: [] });
});

test("idle agent receiving in-progress turn becomes working", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "idle" })]);

  now = 2000;
  store.applyNotification({
    method: "turn/started",
    params: { threadId: "one", turn: { status: "inProgress", startedAt: 2000 } },
  });

  const agent = store.getAgent("one");
  assert.equal(agent?.lastTurn?.status, "inProgress");
  assert.equal(agent?.status, "working");
});

test("turn started replaces notLoaded rawStatus with active evidence", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "notLoaded" })]);

  now = 2000;
  store.applyNotification({
    method: "turn/started",
    params: { threadId: "one", turn: { status: "inProgress", startedAt: 2000 } },
  });

  const agent = store.getAgent("one");
  assert.equal(agent?.status, "working");
  assert.deepEqual(agent?.rawStatus, { type: "active", activeFlags: [] });
});

test("item started treats notLoaded thread metadata as active evidence", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "notLoaded" })]);

  now = 2000;
  store.applyNotification({
    method: "item/started",
    params: { threadId: "one", item: { type: "agentMessage" }, startedAtMs: 2000 },
  });

  const agent = store.getAgent("one");
  assert.equal(agent?.status, "working");
  assert.deepEqual(agent?.rawStatus, { type: "active", activeFlags: [] });
});

test("notLoaded refresh preserves previous active evidence", () => {
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => 1000 });
  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);

  store.replaceThreads([thread("one", { type: "notLoaded" })]);

  const agent = store.getAgent("one");
  assert.equal(agent?.status, "working");
  assert.deepEqual(agent?.rawStatus, { type: "active", activeFlags: [] });
});

test("applies thread status changed notifications and emits agent.updated", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 5000, now: () => now });
  const events: unknown[] = [];
  store.on("event", (event) => events.push(event));

  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);
  store.setAppServerConnection({ connected: false });
  now = 7001;
  store.markStaleAgents();

  const status = { type: "active" as const, activeFlags: ["waitingOnApproval"] };
  now = 8000;
  store.applyNotification({
    method: "thread/status/changed",
    params: { threadId: "one", status },
  });

  const agent = store.getAgent("one");
  assert.equal(agent?.status, "waiting_approval");
  assert.deepEqual(agent?.rawStatus, status);
  assert.equal(agent?.waitingSince, 8000);
  assert.equal(agent?.lastEventAt, 8000);
  assert.equal(agent?.stale, false);
  assert.deepEqual(events.at(-1), {
    type: "agent.updated",
    agentId: "one",
    status: "waiting_approval",
    at: 8000,
  });
});

test("applies thread started notifications by adding a new agent", () => {
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => 1000 });

  store.applyNotification({
    method: "thread/started",
    params: { thread: thread("new", { type: "active", activeFlags: [] }) },
  });

  const agent = store.getAgent("new");
  assert.equal(agent?.id, "new");
  assert.equal(agent?.status, "working");
});

test("applies item lifecycle notifications by refreshing lastEventAt", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  const events: unknown[] = [];
  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);
  store.on("event", (event) => events.push(event));

  now = 4000;
  store.applyNotification({ method: "item/started", params: { threadId: "one" } });
  assert.equal(store.getAgent("one")?.lastEventAt, 4000);

  now = 5000;
  store.applyNotification({ method: "item/completed", params: { threadId: "one" } });
  assert.equal(store.getAgent("one")?.lastEventAt, 5000);
  assert.deepEqual(events.at(-1), {
    type: "agent.updated",
    agentId: "one",
    status: "working",
    at: 5000,
  });

  now = 6000;
  store.applyNotification({ method: "serverRequest/resolved", params: { threadId: "one" } });
  assert.equal(store.getAgent("one")?.lastEventAt, 6000);
});
