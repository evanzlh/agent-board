import { parseCodexSession } from "/ui/vendor/euphony/euphony.js";
import { formatTimestamp, valueOrEmpty } from "/ui/view-model.js";
import { renderSessionSummary } from "/ui/session-summary.js";

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
    renderSessionSummary(elements, payload.summary, renderedMessageCount);
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
