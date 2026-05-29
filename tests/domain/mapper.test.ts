import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveAgentKind,
  deriveDisplayName,
  deriveParentThreadId,
  mapThreadStatus,
  normalizeThread,
} from "../../src/domain/mapper.ts";
import type { AppServerThread } from "../../src/domain/types.ts";

function thread(overrides: Partial<AppServerThread> = {}): AppServerThread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    preview: "Build the thing",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1780010000,
    updatedAt: 1780010100,
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
    ...overrides,
  };
}

test("mapThreadStatus maps idle", () => {
  assert.equal(mapThreadStatus({ type: "idle" }, null), "idle");
});

test("mapThreadStatus maps notLoaded to unknown", () => {
  assert.equal(mapThreadStatus({ type: "notLoaded" }, null), "unknown");
});

test("mapThreadStatus maps active without flags to working", () => {
  assert.equal(mapThreadStatus({ type: "active", activeFlags: [] }, null), "working");
});

test("mapThreadStatus maps waiting approval before generic working", () => {
  assert.equal(
    mapThreadStatus({ type: "active", activeFlags: ["waitingOnApproval"] }, null),
    "waiting_approval",
  );
});

test("mapThreadStatus maps waiting input", () => {
  assert.equal(
    mapThreadStatus({ type: "active", activeFlags: ["waitingOnUserInput"] }, null),
    "waiting_input",
  );
});

test("mapThreadStatus maps systemError and failed turn to error", () => {
  assert.equal(mapThreadStatus({ type: "systemError" }, null), "error");
  assert.equal(mapThreadStatus({ type: "idle" }, { status: "failed" }), "error");
});

test("mapThreadStatus maps terminal notLoaded turns to finished", () => {
  assert.equal(
    mapThreadStatus({ type: "notLoaded" }, { status: "completed", completedAt: 1780067891 }),
    "finished",
  );
  assert.equal(
    mapThreadStatus({ type: "notLoaded" }, { status: "interrupted", completedAt: 1780067891 }),
    "finished",
  );
});

test("mapThreadStatus maps unrecognized shape to unknown", () => {
  assert.equal(mapThreadStatus({ type: "newState" }, null), "unknown");
});

test("deriveAgentKind detects sub-agent metadata", () => {
  assert.equal(deriveAgentKind(thread({ agentNickname: "builder" })), "sub_agent");
  assert.equal(deriveAgentKind(thread({ agentRole: "reviewer" })), "sub_agent");
  assert.equal(deriveAgentKind(thread({ source: { subAgent: "review" } })), "sub_agent");
  assert.equal(
    deriveAgentKind(
      thread({
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "parent-1",
              depth: 1,
              agent_path: null,
              agent_nickname: "worker",
              agent_role: "builder",
            },
          },
        },
      }),
    ),
    "sub_agent",
  );
});

test("deriveAgentKind treats plain fork without sub-agent marker as unknown", () => {
  assert.equal(deriveAgentKind(thread({ forkedFromId: "parent-1" })), "unknown");
});

test("deriveParentThreadId prefers subAgent thread_spawn parent", () => {
  assert.equal(
    deriveParentThreadId(
      thread({
        forkedFromId: "fork-parent",
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "spawn-parent",
              depth: 2,
              agent_path: null,
              agent_nickname: null,
              agent_role: null,
            },
          },
        },
      }),
    ),
    "spawn-parent",
  );
});

test("deriveDisplayName follows nickname, role, name, preview, id order", () => {
  assert.equal(deriveDisplayName(thread({ agentNickname: "alpha" })), "alpha");
  assert.equal(deriveDisplayName(thread({ agentRole: "reviewer" })), "reviewer");
  assert.equal(deriveDisplayName(thread({ name: "Named Thread" })), "Named Thread");
  assert.equal(deriveDisplayName(thread({ preview: "Preview Text" })), "Preview Text");
  assert.equal(deriveDisplayName(thread({ preview: "", id: "thread-x" })), "thread-x");
});

test("normalizeThread returns stable public fields and preserves rawStatus", () => {
  const agent = normalizeThread(
    thread({
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
      agentNickname: "worker-1",
    }),
    { nowMs: 1780010200000 },
  );

  assert.equal(agent.id, "thread-1");
  assert.equal(agent.kind, "sub_agent");
  assert.equal(agent.displayName, "worker-1");
  assert.equal(agent.status, "waiting_approval");
  assert.deepEqual(agent.rawStatus, { type: "active", activeFlags: ["waitingOnApproval"] });
  assert.equal(agent.waitingSince, 1780010200000);
  assert.equal(agent.stale, false);
});

test("normalizeThread uses in-progress turn as active evidence for notLoaded threads", () => {
  const agent = normalizeThread(
    thread({
      status: { type: "notLoaded" },
      turns: [{ status: "inProgress", startedAt: 1780010200, completedAt: null }],
    }),
    { nowMs: 1780010200000 },
  );

  assert.equal(agent.status, "working");
  assert.deepEqual(agent.rawStatus, { type: "active", activeFlags: [] });
  assert.deepEqual(agent.lastTurn, {
    status: "inProgress",
    startedAt: 1780010200,
    completedAt: null,
  });
});

test("normalizeThread uses unresolved interrupted turn as active evidence for notLoaded threads", () => {
  const agent = normalizeThread(
    thread({
      status: { type: "notLoaded" },
      turns: [{ status: "interrupted", startedAt: 1780067247, completedAt: null }],
    }),
    { nowMs: 1780067292000 },
  );

  assert.equal(agent.status, "working");
  assert.deepEqual(agent.rawStatus, { type: "active", activeFlags: [] });
  assert.deepEqual(agent.lastTurn, {
    status: "interrupted",
    startedAt: 1780067247,
    completedAt: null,
  });
});

test("normalizeThread preserves previous active evidence across notLoaded snapshots", () => {
  const previous = normalizeThread(
    thread({ status: { type: "active", activeFlags: [] } }),
    { nowMs: 1780010200000 },
  );

  const agent = normalizeThread(
    thread({ status: { type: "notLoaded" } }),
    { nowMs: 1780010300000, previous },
  );

  assert.equal(agent.status, "working");
  assert.deepEqual(agent.rawStatus, { type: "active", activeFlags: [] });
});

test("normalizeThread stops preserving previous active evidence when current turn is terminal", () => {
  const previous = normalizeThread(
    thread({
      status: { type: "notLoaded" },
      turns: [{ status: "interrupted", startedAt: 1780067668, completedAt: null }],
    }),
    { nowMs: 1780067700000 },
  );

  const agent = normalizeThread(
    thread({
      status: { type: "notLoaded" },
      turns: [{ status: "interrupted", startedAt: 1780067668, completedAt: 1780067891 }],
    }),
    { nowMs: 1780068062000, previous },
  );

  assert.equal(agent.status, "finished");
  assert.deepEqual(agent.rawStatus, { type: "notLoaded" });
  assert.deepEqual(agent.lastTurn, {
    status: "interrupted",
    startedAt: 1780067668,
    completedAt: 1780067891,
  });
});
