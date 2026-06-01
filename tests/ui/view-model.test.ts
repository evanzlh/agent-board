import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_VALUE,
  buildAgentRows,
  buildOfficePods,
  compactJson,
  filterAgents,
  formatTimestamp,
  safeJson,
  valueOrEmpty,
} from "../../src/ui/view-model.js";

const baseAgent = {
  id: "agent-main",
  kind: "main_agent",
  displayName: "Main Agent",
  status: "idle",
  rawStatus: { type: "idle" },
  cwd: "/repo/main",
  preview: "Implement status dashboard",
  updatedAt: 1780010100000,
  waitingSince: null,
  lastTurn: { status: "completed", startedAt: 1780010000000, completedAt: 1780010050000 },
};

test("filterAgents applies each filter independently", () => {
  const agents = [
    baseAgent,
    {
      ...baseAgent,
      id: "agent-sub",
      kind: "sub_agent",
      displayName: "Review Worker",
      status: "working",
      cwd: "/repo/sub",
      preview: "Check raw status mapping",
      rawStatus: { type: "active", activeFlags: [] },
      lastTurn: { status: "inProgress", startedAt: 1780010200000, completedAt: null },
    },
    {
      ...baseAgent,
      id: "agent-worker",
      displayName: "Dashboard Worker",
      status: "working",
      cwd: "/repo/worker",
      preview: "Render status dashboard",
      rawStatus: { type: "active", activeFlags: [] },
      lastTurn: { status: "inProgress", startedAt: 1780010300000, completedAt: null },
    },
  ];

  assert.deepEqual(
    filterAgents(agents, { status: "working" }).map((agent) => agent.id),
    ["agent-sub", "agent-worker"],
  );
  assert.deepEqual(
    filterAgents(agents, { kind: "sub_agent" }).map((agent) => agent.id),
    ["agent-sub"],
  );
  assert.deepEqual(
    filterAgents(agents, { cwd: "SUB" }).map((agent) => agent.id),
    ["agent-sub"],
  );
  assert.deepEqual(
    filterAgents(agents, { search: "RAW STATUS" }).map((agent) => agent.id),
    ["agent-sub"],
  );
});

test("filterAgents treats all and empty filters as no filter", () => {
  const agents = [baseAgent];

  assert.deepEqual(
    filterAgents(agents, {
      status: "all",
      kind: "all",
      cwd: "",
      search: "",
    }).map((agent) => agent.id),
    ["agent-main"],
  );
});

test("filterAgents filters by active window using thread and turn timestamps", () => {
  const agents = [
    {
      ...baseAgent,
      id: "old",
      updatedAt: 1780010000000,
      lastTurn: { status: "completed", startedAt: 1780010000000, completedAt: 1780010010000 },
    },
    {
      ...baseAgent,
      id: "recent-thread",
      updatedAt: 1780010095000,
      lastTurn: null,
    },
    {
      ...baseAgent,
      id: "recent-turn",
      updatedAt: 1780010000000,
      lastTurn: { status: "completed", startedAt: 1780010090000, completedAt: 1780010092500 },
    },
  ];

  assert.deepEqual(
    filterAgents(agents, { activeWithinMs: 10_000 }, 1780010100000).map((agent) => agent.id),
    ["recent-thread", "recent-turn"],
  );
});

test("buildAgentRows nests visible sub agents under their parent rows", () => {
  const parent = {
    ...baseAgent,
    id: "main-1",
    kind: "main_agent",
    parentThreadId: null,
  };
  const child = {
    ...baseAgent,
    id: "sub-1",
    kind: "sub_agent",
    parentThreadId: "main-1",
  };
  const other = {
    ...baseAgent,
    id: "main-2",
    kind: "main_agent",
    parentThreadId: null,
  };

  assert.deepEqual(
    summarizeAgentRows(buildAgentRows([child, parent, other])),
    [
      {
        id: "main-1",
        depth: 0,
        relationship: "root",
        children: [{ id: "sub-1", depth: 1, relationship: "child", children: [] }],
      },
      { id: "main-2", depth: 0, relationship: "root", children: [] },
    ],
  );
});

test("buildAgentRows keeps sub agents visible when their parent is filtered out", () => {
  const child = {
    ...baseAgent,
    id: "sub-orphan",
    kind: "sub_agent",
    parentThreadId: "missing-main",
  };

  assert.deepEqual(
    summarizeAgentRows(buildAgentRows([child])),
    [{ id: "sub-orphan", depth: 0, relationship: "orphan", children: [] }],
  );
});

test("buildOfficePods groups visible main agents with their sub agents", () => {
  const parent = {
    ...baseAgent,
    id: "main-1",
    kind: "main_agent",
    displayName: "Main One",
    parentThreadId: null,
  };
  const child = {
    ...baseAgent,
    id: "sub-1",
    kind: "sub_agent",
    displayName: "Sub One",
    parentThreadId: "main-1",
  };
  const otherParent = {
    ...baseAgent,
    id: "main-2",
    kind: "main_agent",
    displayName: "Main Two",
    parentThreadId: null,
  };

  assert.deepEqual(summarizeOfficePods(buildOfficePods([child, parent, otherParent])), [
    { id: "main-1", type: "main", agentId: "main-1", children: ["sub-1"] },
    { id: "main-2", type: "main", agentId: "main-2", children: [] },
  ]);
});

test("buildOfficePods groups visible sub agents without visible parents into an unassigned pod", () => {
  const child = {
    ...baseAgent,
    id: "sub-orphan",
    kind: "sub_agent",
    displayName: "Filtered Sub",
    parentThreadId: "missing-main",
  };
  const parent = {
    ...baseAgent,
    id: "main-visible",
    kind: "main_agent",
    displayName: "Visible Main",
    parentThreadId: null,
  };

  assert.deepEqual(summarizeOfficePods(buildOfficePods([child, parent])), [
    { id: "unassigned-sub-agents", type: "unassigned", agentId: null, children: ["sub-orphan"] },
    { id: "main-visible", type: "main", agentId: "main-visible", children: [] },
  ]);
});

test("buildOfficePods groups rootless unknown agents into an other pod", () => {
  const unknown = {
    ...baseAgent,
    id: "unknown-1",
    kind: "unknown",
    displayName: "Unknown Agent",
    parentThreadId: null,
  };
  const parent = {
    ...baseAgent,
    id: "main-visible",
    kind: "main_agent",
    displayName: "Visible Main",
    parentThreadId: null,
  };

  assert.deepEqual(summarizeOfficePods(buildOfficePods([unknown, parent])), [
    { id: "other-agents", type: "other", agentId: null, children: ["unknown-1"] },
    { id: "main-visible", type: "main", agentId: "main-visible", children: [] },
  ]);
});

test("buildOfficePods keeps non-sub agents with visible parents in the other pod", () => {
  const parent = {
    ...baseAgent,
    id: "main-1",
    kind: "main_agent",
    displayName: "Main One",
    parentThreadId: null,
  };
  const nestedUnknown = {
    ...baseAgent,
    id: "unknown-nested",
    kind: "unknown",
    displayName: "Nested Unknown",
    parentThreadId: "main-1",
  };
  const rootlessUnknown = {
    ...baseAgent,
    id: "unknown-rootless",
    kind: "unknown",
    displayName: "Rootless Unknown",
    parentThreadId: null,
  };

  assert.deepEqual(summarizeOfficePods(buildOfficePods([nestedUnknown, parent, rootlessUnknown])), [
    { id: "other-agents", type: "other", agentId: null, children: ["unknown-nested", "unknown-rootless"] },
    { id: "main-1", type: "main", agentId: "main-1", children: [] },
  ]);
});

test("formatTimestamp renders numbers and falls back for nullish values", () => {
  assert.equal(formatTimestamp(null), EMPTY_VALUE);
  assert.equal(formatTimestamp(undefined), EMPTY_VALUE);
  assert.equal(formatTimestamp(9e99), EMPTY_VALUE);
  assert.match(formatTimestamp(1780010100000), /2026/);
});

test("safeJson and compactJson render unknown values safely", () => {
  assert.equal(safeJson(undefined), EMPTY_VALUE);
  assert.equal(compactJson(undefined), EMPTY_VALUE);
  assert.equal(compactJson(null), "null");
  assert.equal(compactJson({ type: "active", activeFlags: [] }), "{\"type\":\"active\",\"activeFlags\":[]}");
  assert.equal(safeJson({ type: "idle" }), "{\n  \"type\": \"idle\"\n}");

  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.match(compactJson(circular), /^\[unserializable:/);
  assert.match(safeJson(circular), /^\[unserializable:/);
});

test("valueOrEmpty trims strings and handles missing values", () => {
  assert.equal(valueOrEmpty("  cwd  "), "cwd");
  assert.equal(valueOrEmpty(""), EMPTY_VALUE);
  assert.equal(valueOrEmpty(null), EMPTY_VALUE);
});

function summarizeAgentRows(rows) {
  return rows.map((row) => ({
    id: row.agent.id,
    depth: row.depth,
    relationship: row.relationship,
    children: summarizeAgentRows(row.children),
  }));
}

function summarizeOfficePods(pods) {
  return pods.map((pod) => ({
    id: pod.id,
    type: pod.type,
    agentId: pod.agent?.id ?? null,
    children: pod.children.map((agent) => agent.id),
  }));
}
