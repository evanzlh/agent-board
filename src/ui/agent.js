import { parseCodexSession } from "/ui/vendor/euphony/euphony.js";
import { formatTimestamp, valueOrEmpty } from "/ui/view-model.js";

const elements = {
  title: requiredElement("session-title"),
  meta: requiredElement("session-meta"),
  error: requiredElement("session-error"),
  summary: requiredElement("session-summary"),
  summaryGrid: requiredElement("session-summary-grid"),
  diagnostics: requiredElement("session-diagnostics"),
  diagnosticsContent: requiredElement("session-diagnostics-content"),
  state: requiredElement("session-state"),
  messages: requiredElement("session-messages"),
};

void loadAgentSession();

async function loadAgentSession() {
  const agentId = new URLSearchParams(window.location.search).get("id");
  if (!agentId) {
    showError("Missing agent id.");
    return;
  }

  setLoading();
  try {
    const payload = await fetchJson(`/agents/${encodeURIComponent(agentId)}/session`);
    renderHeader(payload.agent);
    const renderedMessageCount = renderConversation(payload.events);
    renderSessionSummary(payload.summary, renderedMessageCount);
  } catch (error) {
    showError(readError(error));
  }
}

function renderHeader(agent) {
  elements.title.textContent = valueOrEmpty(agent?.displayName ?? agent?.id);
  elements.meta.textContent = [
    valueOrEmpty(agent?.status),
    valueOrEmpty(agent?.kind),
    `updated ${formatTimestamp(agent?.updatedAt)}`,
    valueOrEmpty(agent?.cwd),
  ].join(" · ");
}

function renderConversation(events) {
  const parsed = parseCodexSession(Array.isArray(events) ? events : []);
  if (!parsed?.conversation) {
    showEmpty("No renderable Codex session messages found.");
    return 0;
  }

  const conversation = document.createElement("euphony-conversation");
  conversation.conversationData = parsed.conversation;
  conversation.customLabels = parsed.customLabels ?? [];
  conversation.conversationLabel = "Session";
  conversation.shouldRenderMarkdown = true;
  elements.messages.replaceChildren(conversation);
  elements.state.hidden = true;
  elements.error.hidden = true;
  return Array.isArray(parsed.conversation.messages) ? parsed.conversation.messages.length : 0;
}

function renderSessionSummary(summary, renderedMessageCount) {
  const normalized = normalizeSummary(summary);
  const contextLabel = formatContextTokens(normalized.tokens);
  elements.summaryGrid.replaceChildren(
    summaryCard("Messages", formatNumber(renderedMessageCount)),
    summaryCard("Raw events", formatNumber(normalized.events.total)),
    summaryCard("Tool calls", formatNumber(normalized.tools.calls)),
    summaryCard("Reasoning", formatNumber(normalized.messages.reasoning)),
    summaryCard("Context tokens", contextLabel),
    summaryCard("Total tokens", formatOptionalNumber(normalized.tokens.total?.totalTokens)),
    summaryCard("Compactions", formatCompactionLabel(normalized.events)),
  );
  renderDiagnostics(normalized);
  elements.summary.hidden = false;
}

function renderDiagnostics(summary) {
  elements.diagnosticsContent.replaceChildren(
    diagnosticsSection("Roles", entriesFromRecord(summary.messages.roles)),
    diagnosticsSection("Events", entriesFromRecord(summary.events.byType)),
    diagnosticsSection("Response items", entriesFromRecord(summary.events.responseItems)),
    diagnosticsSection("Event messages", entriesFromRecord(summary.events.eventMessages)),
    diagnosticsSection("Tools", summary.tools.byName.map((item) => [item.name, item.count])),
    diagnosticsSection("Token usage", tokenRows(summary.tokens)),
    diagnosticsSection("Session", sessionRows(summary.session)),
  );
  elements.diagnostics.open = false;
}

function summaryCard(label, value) {
  const card = document.createElement("article");
  card.className = "session-summary-card";
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  card.replaceChildren(labelElement, valueElement);
  return card;
}

function diagnosticsSection(title, rows) {
  const section = document.createElement("section");
  section.className = "session-diagnostics__section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const list = document.createElement("dl");
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = formatDiagnosticValue(value);
    list.append(term, description);
  }
  if (list.childElementCount === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No data";
    section.replaceChildren(heading, empty);
    return section;
  }
  section.replaceChildren(heading, list);
  return section;
}

function normalizeSummary(summary) {
  return {
    events: {
      total: numberOrNull(summary?.events?.total) ?? 0,
      byType: objectOrEmpty(summary?.events?.byType),
      responseItems: objectOrEmpty(summary?.events?.responseItems),
      eventMessages: objectOrEmpty(summary?.events?.eventMessages),
      compactions: numberOrNull(summary?.events?.compactions) ?? 0,
      turnAborts: numberOrNull(summary?.events?.turnAborts) ?? 0,
    },
    messages: {
      roles: objectOrEmpty(summary?.messages?.roles),
      reasoning: numberOrNull(summary?.messages?.reasoning) ?? 0,
    },
    tools: {
      calls: numberOrNull(summary?.tools?.calls) ?? 0,
      outputs: numberOrNull(summary?.tools?.outputs) ?? 0,
      byName: Array.isArray(summary?.tools?.byName) ? summary.tools.byName : [],
    },
    tokens: {
      last: summary?.tokens?.last ?? null,
      total: summary?.tokens?.total ?? null,
      modelContextWindow: numberOrNull(summary?.tokens?.modelContextWindow),
      contextWindowUsedPercent: numberOrNull(summary?.tokens?.contextWindowUsedPercent),
    },
    session: summary?.session && typeof summary.session === "object" ? summary.session : {},
  };
}

function formatContextTokens(tokens) {
  const input = numberOrNull(tokens.last?.inputTokens);
  const window = numberOrNull(tokens.modelContextWindow);
  if (input === null || window === null) {
    return "unknown";
  }
  const percent = numberOrNull(tokens.contextWindowUsedPercent);
  return percent === null
    ? `${formatNumber(input)} / ${formatNumber(window)}`
    : `${formatNumber(input)} / ${formatNumber(window)} (${percent}%)`;
}

function formatCompactionLabel(events) {
  const base = formatNumber(events.compactions);
  return events.turnAborts > 0 ? `${base} · ${events.turnAborts} aborted` : base;
}

function tokenRows(tokens) {
  return [
    ["Last input", tokens.last?.inputTokens],
    ["Last cached input", tokens.last?.cachedInputTokens],
    ["Last output", tokens.last?.outputTokens],
    ["Last reasoning output", tokens.last?.reasoningOutputTokens],
    ["Last total", tokens.last?.totalTokens],
    ["Total input", tokens.total?.inputTokens],
    ["Total cached input", tokens.total?.cachedInputTokens],
    ["Total output", tokens.total?.outputTokens],
    ["Total reasoning output", tokens.total?.reasoningOutputTokens],
    ["Total tokens", tokens.total?.totalTokens],
    ["Model context window", tokens.modelContextWindow],
  ];
}

function sessionRows(session) {
  return [
    ["Session id", session.id],
    ["Started", session.startedAt],
    ["Cwd", session.cwd],
    ["Originator", session.originator],
    ["CLI", session.cliVersion],
    ["Model provider", session.modelProvider],
    ["Model", session.model],
    ["Git branch", session.gitBranch],
    ["Git commit", session.gitCommitHash],
    ["Approval policy", session.approvalPolicy],
    ["Sandbox policy", session.sandboxPolicy],
    ["Collaboration mode", session.collaborationMode],
    ["Effort", session.effort],
    ["Timezone", session.timezone],
    ["Current date", session.currentDate],
  ];
}

function entriesFromRecord(record) {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function formatOptionalNumber(value) {
  const number = numberOrNull(value);
  return number === null ? "unknown" : formatNumber(number);
}

function formatDiagnosticValue(value) {
  if (typeof value === "number") {
    return formatNumber(value);
  }
  if (value === null || value === undefined || value === "") {
    return "unknown";
  }
  return String(value);
}

async function fetchJson(path) {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
  });
  const body = await readJsonBody(response);
  if (!response.ok) {
    throw new Error(formatResponseError(response, body));
  }
  return body;
}

async function readJsonBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatResponseError(response, body) {
  if (body?.error === "agent_not_found") {
    return `Agent not found: ${valueOrEmpty(body.id)}`;
  }
  if (body?.error === "session_not_found") {
    return "No Codex session file was found for this agent.";
  }
  if (body?.error === "session_reader_unavailable") {
    return "Session reading is unavailable while the app server client is disconnected.";
  }
  if (body?.message) {
    return String(body.message);
  }
  return `${response.status} ${response.statusText}`;
}

function setLoading() {
  elements.state.hidden = false;
  elements.state.textContent = "Loading session...";
  elements.messages.replaceChildren();
  elements.error.hidden = true;
  elements.error.textContent = "";
  elements.summary.hidden = true;
  elements.summaryGrid.replaceChildren();
  elements.diagnosticsContent.replaceChildren();
}

function showEmpty(message) {
  elements.state.hidden = false;
  elements.state.textContent = message;
  elements.messages.replaceChildren();
  elements.error.hidden = true;
  elements.error.textContent = "";
}

function showError(message) {
  elements.state.hidden = true;
  elements.messages.replaceChildren();
  elements.error.hidden = false;
  elements.error.textContent = message;
  elements.summary.hidden = true;
  elements.summaryGrid.replaceChildren();
  elements.diagnosticsContent.replaceChildren();
}

function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required UI element #${id}`);
  }
  return element;
}

function readError(error) {
  return error instanceof Error ? error.message : String(error);
}
