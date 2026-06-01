import {
  EMPTY_VALUE,
  buildAgentRows,
  compactJson,
  filterAgents,
  formatTimestamp,
  safeJson,
  valueOrEmpty,
} from "/ui/view-model.js";

const REFRESH_INTERVAL_MS = 3000;

const state = {
  agents: [],
  summary: null,
  health: null,
  filters: {
    status: "all",
    kind: "all",
    activeWithinMs: "all",
    cwd: "",
    search: "",
  },
  expandedAgentId: null,
  expandedParentIds: new Set(),
  autoRefreshEnabled: true,
  isLoading: false,
  lastLoadedAt: null,
  lastError: null,
  lastErrorAt: null,
  generatedAt: null,
};

const elements = {
  healthLine: requiredElement("health-line"),
  errorBanner: requiredElement("error-banner"),
  summary: requiredElement("summary"),
  tableBody: requiredElement("agent-table-body"),
  visibleCount: requiredElement("visible-count"),
  generatedAt: requiredElement("generated-at"),
  statusFilter: requiredElement("status-filter"),
  kindFilter: requiredElement("kind-filter"),
  activeWithinFilter: requiredElement("active-within-filter"),
  cwdFilter: requiredElement("cwd-filter"),
  searchFilter: requiredElement("search-filter"),
  autoRefresh: requiredElement("auto-refresh"),
  refreshButton: requiredElement("refresh-button"),
};

wireControls();
render();
void loadSnapshot();
setInterval(() => {
  if (state.autoRefreshEnabled) {
    void loadSnapshot();
  }
}, REFRESH_INTERVAL_MS);

function wireControls() {
  elements.refreshButton.addEventListener("click", () => {
    void loadSnapshot();
  });
  elements.autoRefresh.addEventListener("change", () => {
    state.autoRefreshEnabled = elements.autoRefresh.checked;
    renderHealth();
  });
  elements.statusFilter.addEventListener("change", () => {
    state.filters.status = elements.statusFilter.value;
    renderTable();
  });
  elements.kindFilter.addEventListener("change", () => {
    state.filters.kind = elements.kindFilter.value;
    renderTable();
  });
  elements.activeWithinFilter.addEventListener("change", () => {
    state.filters.activeWithinMs = elements.activeWithinFilter.value;
    renderTable();
  });
  elements.cwdFilter.addEventListener("input", () => {
    state.filters.cwd = elements.cwdFilter.value;
    renderTable();
  });
  elements.searchFilter.addEventListener("input", () => {
    state.filters.search = elements.searchFilter.value;
    renderTable();
  });
}

async function loadSnapshot() {
  if (state.isLoading) {
    return;
  }
  state.isLoading = true;
  elements.refreshButton.disabled = true;
  try {
    const [healthResult, statusResult] = await Promise.allSettled([
      fetchJson("/health"),
      fetchJson("/status"),
    ]);

    const errors = [];
    let succeeded = false;
    if (healthResult.status === "fulfilled") {
      state.health = healthResult.value;
      succeeded = true;
    } else {
      errors.push(`health: ${readError(healthResult.reason)}`);
    }

    if (statusResult.status === "fulfilled") {
      state.summary = statusResult.value.summary ?? null;
      state.agents = Array.isArray(statusResult.value.agents) ? statusResult.value.agents : [];
      state.generatedAt = statusResult.value.generatedAt ?? null;
      succeeded = true;
      if (state.expandedAgentId && !state.agents.some((agent) => agent.id === state.expandedAgentId)) {
        state.expandedAgentId = null;
      }
      pruneExpandedParentIds();
    } else {
      errors.push(`status: ${readError(statusResult.reason)}`);
    }

    const completedAt = Date.now();
    if (succeeded) {
      state.lastLoadedAt = completedAt;
    }
    if (errors.length > 0) {
      state.lastError = errors.join("; ");
      state.lastErrorAt = completedAt;
    } else {
      state.lastError = null;
      state.lastErrorAt = null;
    }
  } finally {
    state.isLoading = false;
    elements.refreshButton.disabled = false;
    render();
  }
}

function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required UI element #${id}`);
  }
  return element;
}

async function fetchJson(path) {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return await response.json();
}

function render() {
  renderHealth();
  renderError();
  renderSummary();
  renderTable();
}

function renderHealth() {
  const appServer = state.health?.appServer;
  const daemon = state.health?.daemon;
  const connected = appServer?.connected ? "connected" : "disconnected";
  const mode = valueOrEmpty(appServer?.mode);
  const cliVersion = valueOrEmpty(appServer?.cliVersion);
  const daemonVersion = valueOrEmpty(daemon?.version);
  const loaded = state.lastLoadedAt ? formatTimestamp(state.lastLoadedAt) : EMPTY_VALUE;
  const refresh = state.autoRefreshEnabled ? "auto 3s" : "paused";
  elements.healthLine.textContent = `${connected} · mode ${mode} · cli ${cliVersion} · daemon ${daemonVersion} · loaded ${loaded} · ${refresh}`;
}

function renderError() {
  const healthError = state.health?.appServer?.lastError;
  const requestError =
    state.lastError && state.lastErrorAt
      ? `${state.lastError} at ${formatTimestamp(state.lastErrorAt)}`
      : state.lastError;
  const errors = [requestError, healthError].filter(Boolean);
  if (errors.length === 0) {
    elements.errorBanner.hidden = true;
    elements.errorBanner.textContent = "";
    return;
  }
  elements.errorBanner.hidden = false;
  elements.errorBanner.textContent = errors.join(" · ");
}

function renderSummary() {
  const summary = state.summary ?? {};
  const items = [
    ["total", summary.total],
    ["working", summary.working],
    ["idle", summary.idle],
    ["finished", summary.finished],
    ["waiting_approval", summary.waitingApproval],
    ["waiting_input", summary.waitingInput],
    ["error", summary.error],
    ["unknown", summary.unknown],
  ];

  elements.summary.replaceChildren(
    ...items.map(([label, value]) => {
      const card = document.createElement("article");
      card.className = "summary-card";
      const labelElement = document.createElement("span");
      labelElement.textContent = label;
      const valueElement = document.createElement("strong");
      valueElement.textContent = String(value ?? 0);
      card.append(labelElement, valueElement);
      return card;
    }),
  );
}

function renderTable() {
  const visibleAgents = filterAgents(state.agents, state.filters, state.generatedAt ?? Date.now());
  elements.visibleCount.textContent = `${visibleAgents.length} agent${visibleAgents.length === 1 ? "" : "s"}`;
  elements.generatedAt.textContent = state.generatedAt
    ? `snapshot ${formatTimestamp(state.generatedAt)}`
    : "No snapshot loaded";

  if (visibleAgents.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-state";
    cell.colSpan = 9;
    cell.textContent = state.agents.length === 0 ? "No agents loaded." : "No agents match the filters.";
    row.append(cell);
    elements.tableBody.replaceChildren(row);
    return;
  }

  const rows = [];
  for (const agentRow of buildAgentRows(visibleAgents)) {
    appendVisibleAgentRows(agentRow, rows);
  }
  elements.tableBody.replaceChildren(...rows);
}

function appendVisibleAgentRows(agentRow, rows) {
  const agent = agentRow.agent;
  rows.push(renderAgentRow(agentRow));
  if (agent.id === state.expandedAgentId) {
    rows.push(renderDetailRow(agent));
  }

  if (!state.expandedParentIds.has(agent.id)) {
    return;
  }

  for (const childRow of agentRow.children) {
    appendVisibleAgentRows(childRow, rows);
  }
}

function renderAgentRow(agentRow) {
  const { agent } = agentRow;
  const row = document.createElement("tr");
  row.className = "agent-row";
  row.dataset.depth = String(agentRow.depth);
  row.dataset.relationship = agentRow.relationship;
  row.dataset.childCount = String(agentRow.children.length);
  if (agent.id === state.expandedAgentId) {
    row.classList.add("is-expanded");
  }
  if (agentRow.children.length > 0) {
    row.classList.add("has-sub-agents");
  }
  if (state.expandedParentIds.has(agent.id)) {
    row.classList.add("is-subtree-expanded");
  }
  if (agentRow.relationship === "child") {
    row.classList.add("is-child-agent");
  }
  if (agentRow.relationship === "orphan") {
    row.classList.add("is-orphan-sub-agent");
  }
  if (agent.stale) {
    row.classList.add("is-stale");
  }
  row.addEventListener("click", () => {
    state.expandedAgentId = state.expandedAgentId === agent.id ? null : agent.id;
    renderTable();
  });

  row.append(
    cell(renderStatus(agent.status, agent.stale)),
    textCell(agent.kind),
    cell(renderName(agentRow)),
    textCell(compactJson(agent.rawStatus), "json-inline"),
    textCell(agent.lastTurn?.status),
    textCell(formatTimestamp(agent.waitingSince)),
    textCell(formatTimestamp(agent.updatedAt)),
    textCell(agent.cwd),
    textCell(agent.id, "json-inline"),
  );
  return row;
}

function renderName(agentRow) {
  const { agent } = agentRow;
  const wrap = document.createElement("span");
  wrap.className = "agent-name";
  if (agentRow.children.length > 0) {
    wrap.append(renderHierarchyToggle(agentRow));
  }
  if (agentRow.relationship === "child") {
    wrap.classList.add("agent-name--child");
    wrap.style.setProperty("--agent-depth", String(Math.min(agentRow.depth, 4)));
    wrap.append(hierarchyMarker("sub"));
  } else if (agentRow.relationship === "orphan") {
    wrap.classList.add("agent-name--orphan");
    wrap.append(hierarchyMarker("orphan"));
  }

  const name = document.createElement("span");
  name.className = "cell-truncate";
  name.textContent = valueOrEmpty(agent.displayName);
  name.title = name.textContent;
  wrap.append(name);
  if (agentRow.children.length > 0) {
    wrap.append(hierarchyMarker(`${agentRow.children.length} sub`));
  }
  return wrap;
}

function renderHierarchyToggle(agentRow) {
  const { agent } = agentRow;
  const expanded = state.expandedParentIds.has(agent.id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hierarchy-toggle";
  button.textContent = expanded ? "-" : "+";
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute(
    "aria-label",
    `${expanded ? "Hide" : "Show"} ${agentRow.children.length} sub agent${
      agentRow.children.length === 1 ? "" : "s"
    } for ${valueOrEmpty(agent.displayName)}`,
  );
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.expandedParentIds.has(agent.id)) {
      state.expandedParentIds.delete(agent.id);
    } else {
      state.expandedParentIds.add(agent.id);
    }
    renderTable();
  });
  return button;
}

function hierarchyMarker(label) {
  const marker = document.createElement("span");
  marker.className = "hierarchy-marker";
  marker.textContent = label;
  return marker;
}

function renderDetailRow(agent) {
  const row = document.createElement("tr");
  row.className = "detail-row";
  const detail = document.createElement("td");
  detail.colSpan = 9;
  const pre = document.createElement("pre");
  pre.className = "detail-json";
  pre.textContent = safeJson(agent);
  detail.append(pre);
  row.append(detail);
  return row;
}

function renderStatus(status, stale = false) {
  const wrap = document.createElement("span");
  wrap.className = "status-stack";
  const pill = document.createElement("span");
  pill.className = "status-pill";
  pill.dataset.status = valueOrEmpty(status);
  pill.textContent = valueOrEmpty(status);
  wrap.append(pill);
  if (stale) {
    const staleBadge = document.createElement("span");
    staleBadge.className = "stale-badge";
    staleBadge.textContent = "stale";
    wrap.append(staleBadge);
  }
  return wrap;
}

function textCell(value, extraClass = "") {
  const span = document.createElement("span");
  span.className = `cell-truncate ${extraClass}`.trim();
  span.textContent = valueOrEmpty(value);
  span.title = span.textContent;
  return cell(span);
}

function cell(child) {
  const td = document.createElement("td");
  td.append(child);
  return td;
}

function readError(error) {
  return error instanceof Error ? error.message : String(error);
}

function pruneExpandedParentIds() {
  const currentAgentIds = new Set(state.agents.map((agent) => agent.id));
  for (const id of state.expandedParentIds) {
    if (!currentAgentIds.has(id)) {
      state.expandedParentIds.delete(id);
    }
  }
}
