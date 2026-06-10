import { parseCodexSession } from "/ui/vendor/euphony/euphony.js";
import { formatTimestamp, valueOrEmpty } from "/ui/view-model.js";
import { renderSessionSummary } from "/ui/session-summary.js";

const SESSION_MESSAGE_PAGE_SIZE = 200;

const elements = {
  title: requiredElement("session-title"),
  meta: requiredElement("session-meta"),
  error: requiredElement("session-error"),
  summary: requiredElement("session-summary"),
  summaryGrid: requiredElement("session-summary-grid"),
  diagnostics: requiredElement("session-diagnostics"),
  diagnosticsContent: requiredElement("session-diagnostics-content"),
  state: requiredElement("session-state"),
  messageControls: requiredElement("session-message-controls"),
  messages: requiredElement("session-messages"),
};

let sessionConversation = null;
let sessionCustomLabels = [];
let sessionMessagePageStart = 0;

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
  const messages = Array.isArray(parsed?.conversation?.messages) ? parsed.conversation.messages : [];
  if (!parsed?.conversation || messages.length === 0) {
    showEmpty("No renderable Codex session messages found.");
    return 0;
  }

  sessionConversation = parsed.conversation;
  sessionCustomLabels = parsed.customLabels ?? [];
  sessionMessagePageStart = Math.max(0, messages.length - SESSION_MESSAGE_PAGE_SIZE);
  renderConversationPage();
  return messages.length;
}

function renderConversationPage() {
  if (!sessionConversation) {
    showEmpty("No renderable Codex session messages found.");
    return;
  }

  const messages = Array.isArray(sessionConversation.messages) ? sessionConversation.messages : [];
  if (messages.length === 0) {
    showEmpty("No renderable Codex session messages found.");
    return;
  }

  const maxStart = Math.max(0, messages.length - SESSION_MESSAGE_PAGE_SIZE);
  const pageStart = Math.min(Math.max(0, sessionMessagePageStart), maxStart);
  const pageEnd = Math.min(messages.length, pageStart + SESSION_MESSAGE_PAGE_SIZE);
  sessionMessagePageStart = pageStart;

  const pageConversation = {
    ...sessionConversation,
    messages: messages.slice(pageStart, pageEnd),
    metadata: {
      ...(sessionConversation.metadata ?? {}),
      agentboard_message_window: {
        start: pageStart + 1,
        end: pageEnd,
        total: messages.length,
        pageSize: SESSION_MESSAGE_PAGE_SIZE,
      },
    },
  };

  const conversation = document.createElement("euphony-conversation");
  conversation.conversationData = pageConversation;
  conversation.customLabels = conversationLabelsForPage(messages.length, pageStart, pageEnd);
  conversation.conversationLabel = "Session";
  conversation.shouldRenderMarkdown = true;
  elements.messages.replaceChildren(conversation);
  renderMessageControls(messages.length, pageStart, pageEnd);
  elements.state.hidden = true;
  elements.error.hidden = true;
}

function conversationLabelsForPage(total, pageStart, pageEnd) {
  const labels = [...sessionCustomLabels];
  if (total > SESSION_MESSAGE_PAGE_SIZE) {
    labels.push(["Messages", `${pageStart + 1}-${pageEnd}/${total}`, "Currently rendered message range"]);
  }
  return labels;
}

function renderMessageControls(total, pageStart, pageEnd) {
  elements.messageControls.replaceChildren();
  if (total <= SESSION_MESSAGE_PAGE_SIZE) {
    elements.messageControls.hidden = true;
    return;
  }

  const maxStart = Math.max(0, total - SESSION_MESSAGE_PAGE_SIZE);
  const summary = document.createElement("div");
  summary.className = "session-message-controls__summary";
  summary.textContent = `Showing messages ${pageStart + 1}-${pageEnd} of ${total}`;

  const actions = document.createElement("div");
  actions.className = "session-message-controls__actions";
  actions.append(
    messagePageButton("First", pageStart === 0, () => setSessionMessagePageStart(0)),
    messagePageButton("Previous", pageStart === 0, () =>
      setSessionMessagePageStart(pageStart - SESSION_MESSAGE_PAGE_SIZE),
    ),
    messagePageButton("Next", pageEnd >= total, () => setSessionMessagePageStart(pageStart + SESSION_MESSAGE_PAGE_SIZE)),
    messagePageButton("Latest", pageStart === maxStart, () => setSessionMessagePageStart(maxStart)),
  );

  elements.messageControls.hidden = false;
  elements.messageControls.append(summary, actions);
}

function messagePageButton(label, disabled, onClick) {
  const button = document.createElement("button");
  button.className = "button session-message-controls__button";
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function setSessionMessagePageStart(nextStart) {
  sessionMessagePageStart = nextStart;
  renderConversationPage();
}

function resetConversationState() {
  sessionConversation = null;
  sessionCustomLabels = [];
  sessionMessagePageStart = 0;
  elements.messageControls.hidden = true;
  elements.messageControls.replaceChildren();
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
  resetConversationState();
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
  resetConversationState();
  elements.state.hidden = false;
  elements.state.textContent = message;
  elements.messages.replaceChildren();
  elements.error.hidden = true;
  elements.error.textContent = "";
}

function showError(message) {
  resetConversationState();
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
