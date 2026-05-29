import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_VALUE,
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

test("formatTimestamp renders numbers and falls back for nullish values", () => {
  assert.equal(formatTimestamp(null), EMPTY_VALUE);
  assert.equal(formatTimestamp(undefined), EMPTY_VALUE);
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
