export function renderSessionSummary(elements, summary, renderedMessageCount) {
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
  renderDiagnostics(elements, normalized);
  elements.summary.hidden = false;
}

export function renderDiagnostics(elements, summary) {
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

export function normalizeSummary(summary) {
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
      byName: normalizeToolRows(summary?.tools?.byName),
    },
    tokens: {
      last: summary?.tokens?.last ?? null,
      total: summary?.tokens?.total ?? null,
      modelContextWindow: numberOrNull(summary?.tokens?.modelContextWindow),
      contextWindowUsedPercent: numberOrNull(summary?.tokens?.contextWindowUsedPercent),
    },
    session: objectOrEmpty(summary?.session),
  };
}

export function summaryCard(label, value) {
  const card = document.createElement("article");
  card.className = "session-summary-card";
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  card.replaceChildren(labelElement, valueElement);
  return card;
}

export function diagnosticsSection(title, rows) {
  const section = document.createElement("section");
  section.className = "session-diagnostics__section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const list = document.createElement("dl");
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2 || row[0] === "") {
      continue;
    }
    const [label, value] = row;
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

export function formatContextTokens(tokens) {
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

export function formatCompactionLabel(events) {
  const base = formatNumber(events.compactions);
  return events.turnAborts > 0 ? `${base} · ${events.turnAborts} aborted` : base;
}

export function tokenRows(tokens) {
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

export function sessionRows(session) {
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

export function entriesFromRecord(record) {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

export function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

export function formatOptionalNumber(value) {
  const number = numberOrNull(value);
  return number === null ? "unknown" : formatNumber(number);
}

export function formatDiagnosticValue(value) {
  if (typeof value === "number") {
    return formatNumber(value);
  }
  if (value === null || value === undefined || value === "") {
    return "unknown";
  }
  return String(value);
}

function normalizeToolRows(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => {
    return (
      item &&
      typeof item === "object" &&
      typeof item.name === "string" &&
      item.name.length > 0 &&
      numberOrNull(item.count) !== null
    );
  });
}
