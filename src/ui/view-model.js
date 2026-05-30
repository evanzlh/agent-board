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
