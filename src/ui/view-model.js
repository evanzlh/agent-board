export const EMPTY_VALUE = "-";

export function filterAgents(agents, filters = {}, nowMs = Date.now()) {
  const status = normalizeFilter(filters.status);
  const kind = normalizeFilter(filters.kind);
  const cwd = normalizeSearch(filters.cwd);
  const search = normalizeSearch(filters.search);
  const activeSince = readActiveSince(nowMs, filters.activeWithinMs);

  return agents.filter((agent) => {
    if (status !== "all" && agent.status !== status) {
      return false;
    }
    if (kind !== "all" && agent.kind !== kind) {
      return false;
    }
    if (cwd && !String(agent.cwd ?? "").toLowerCase().includes(cwd)) {
      return false;
    }
    if (search && !agentSearchText(agent).includes(search)) {
      return false;
    }
    if (activeSince !== null && agentActivityAt(agent) < activeSince) {
      return false;
    }
    return true;
  });
}

export function buildAgentRows(agents) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const childrenByParent = new Map();

  for (const agent of agents) {
    const parentId = visibleParentId(agent, byId);
    if (!parentId) {
      continue;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(agent);
    childrenByParent.set(parentId, children);
  }

  const rootIds = [];
  const seenRoots = new Set();
  for (const agent of agents) {
    const root = findVisibleRoot(agent, byId);
    if (!seenRoots.has(root.id)) {
      seenRoots.add(root.id);
      rootIds.push(root.id);
    }
  }

  const rows = [];
  const emitted = new Set();
  for (const rootId of rootIds) {
    const root = byId.get(rootId);
    if (root && !emitted.has(root.id)) {
      rows.push(buildAgentRow(root, 0, childrenByParent, emitted));
    }
  }

  return rows;
}

export function buildOfficePods(agents) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const childrenByParent = new Map();
  const unassignedSubAgents = [];
  const otherAgents = [];

  for (const agent of agents) {
    if (agent.kind !== "sub_agent") {
      continue;
    }
    const parentId = visibleMainParentId(agent, byId);
    if (!parentId) {
      continue;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(agent);
    childrenByParent.set(parentId, children);
  }

  const pods = [];
  for (const agent of agents) {
    if (agent.kind === "main_agent") {
      pods.push({
        id: agent.id,
        type: "main",
        agent,
        children: childrenByParent.get(agent.id) ?? [],
      });
      continue;
    }

    if (agent.kind === "sub_agent") {
      if (!visibleMainParentId(agent, byId)) {
        unassignedSubAgents.push(agent);
      }
      continue;
    }

    if (!visibleParentId(agent, byId)) {
      otherAgents.push(agent);
    }
  }

  const groupedPods = [];
  if (unassignedSubAgents.length > 0) {
    groupedPods.push({
      id: "unassigned-sub-agents",
      type: "unassigned",
      agent: null,
      children: unassignedSubAgents,
    });
  }
  if (otherAgents.length > 0) {
    groupedPods.push({
      id: "other-agents",
      type: "other",
      agent: null,
      children: otherAgents,
    });
  }
  groupedPods.push(...pods);

  return groupedPods;
}

export function formatTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  return date.toLocaleString();
}

export function valueOrEmpty(value) {
  if (value === null || value === undefined) {
    return EMPTY_VALUE;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : EMPTY_VALUE;
}

export function compactJson(value) {
  if (value === undefined) {
    return EMPTY_VALUE;
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? EMPTY_VALUE : json;
  } catch (error) {
    return `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

export function safeJson(value) {
  if (value === undefined) {
    return EMPTY_VALUE;
  }
  try {
    const json = JSON.stringify(value, null, 2);
    return json === undefined ? EMPTY_VALUE : json;
  } catch (error) {
    return `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function buildAgentRow(agent, depth, childrenByParent, emitted) {
  emitted.add(agent.id);
  const children = [];
  for (const child of childrenByParent.get(agent.id) ?? []) {
    if (!emitted.has(child.id)) {
      children.push(buildAgentRow(child, depth + 1, childrenByParent, emitted));
    }
  }

  return {
    agent,
    depth,
    relationship: rowRelationship(agent, depth),
    children,
  };
}

function rowRelationship(agent, depth) {
  if (depth > 0) {
    return "child";
  }
  const hasMissingParent =
    agent.kind === "sub_agent" && valueOrEmpty(agent.parentThreadId) !== EMPTY_VALUE;
  return hasMissingParent ? "orphan" : "root";
}

function findVisibleRoot(agent, byId) {
  let root = agent;
  const seen = new Set([agent.id]);
  let parentId = visibleParentId(root, byId);
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) {
      break;
    }
    root = parent;
    seen.add(parent.id);
    parentId = visibleParentId(root, byId);
  }
  return root;
}

function visibleParentId(agent, byId) {
  const parentId =
    typeof agent.parentThreadId === "string" && agent.parentThreadId.length > 0
      ? agent.parentThreadId
      : null;
  return parentId && parentId !== agent.id && byId.has(parentId) ? parentId : null;
}

function visibleMainParentId(agent, byId) {
  const parentId =
    typeof agent.parentThreadId === "string" && agent.parentThreadId.length > 0
      ? agent.parentThreadId
      : null;
  if (!parentId || parentId === agent.id) {
    return null;
  }
  const parent = byId.get(parentId);
  return parent?.kind === "main_agent" ? parentId : null;
}

function normalizeFilter(value) {
  return value && value !== "all" ? String(value) : "all";
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function readActiveSince(nowMs, activeWithinMs) {
  const number = Number(activeWithinMs);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return nowMs - number;
}

function agentActivityAt(agent) {
  return Math.max(
    numberOrNegativeInfinity(agent.updatedAt),
    numberOrNegativeInfinity(agent.lastTurn?.startedAt),
    numberOrNegativeInfinity(agent.lastTurn?.completedAt),
  );
}

function numberOrNegativeInfinity(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function agentSearchText(agent) {
  return [
    agent.id,
    agent.displayName,
    agent.preview,
    agent.cwd,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join("\n");
}
