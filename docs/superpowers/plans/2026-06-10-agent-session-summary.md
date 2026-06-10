# Agent Session Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact summary strip and expandable diagnostics section to the agent session message page.

**Architecture:** Compute Codex session statistics on the server from the same JSONL events already returned by `/agents/:id/session`, then render those metrics in the static session page. Keep Euphony as the only conversation renderer; the new summary code only calculates counts, token usage, and safe metadata.

**Tech Stack:** Node 22 built-in test runner, TypeScript stripped by Node, static HTML/CSS/JavaScript, vendored Euphony.

---

## File Structure

- Create `src/app-server/session-summary.ts`: focused summary builder for Codex session events.
- Create `tests/app-server/session-summary.test.ts`: unit tests for event, role, tool, token, compaction, and metadata metrics.
- Modify `src/http/api.ts`: import `summarizeSessionEvents()` and include `summary` in `GET /agents/:id/session`.
- Modify `tests/http/api.test.ts`: assert the session endpoint returns the summary and UI assets contain summary hooks.
- Modify `tests/daemon.test.ts`: assert daemon-wired session responses include summary.
- Modify `src/ui/agent.html`: add summary and diagnostics containers above the message panel.
- Modify `src/ui/agent.js`: render summary KPI cards, diagnostics details, and unknown token fallbacks.
- Modify `src/ui/styles.css`: style the compact KPI strip and diagnostics block using existing AgentBoard colors and responsive patterns.

## Task 1: Backend Summary Unit Tests

**Files:**
- Create: `tests/app-server/session-summary.test.ts`
- Create in next task: `src/app-server/session-summary.ts`

- [ ] **Step 1: Write the failing summary tests**

Create `tests/app-server/session-summary.test.ts` with:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSessionEvents } from "../../src/app-server/session-summary.ts";

test("summarizeSessionEvents counts messages, tools, reasoning, tokens, compactions, and metadata", () => {
  const events = [
    {
      timestamp: "2026-06-10T01:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "session-one",
        timestamp: "2026-06-10T01:00:00.000Z",
        cwd: "/repo",
        originator: "codex_cli",
        cli_version: "0.135.0",
        model_provider: "openai",
        git: { branch: "main", commit_hash: "abc123" },
      },
    },
    {
      timestamp: "2026-06-10T01:00:01.000Z",
      type: "turn_context",
      payload: {
        model: "gpt-5-codex",
        approval_policy: "on-request",
        sandbox_policy: "workspace-write",
        collaboration_mode: "Default",
        effort: "medium",
        timezone: "Asia/Shanghai",
        current_date: "2026-06-10",
      },
    },
    {
      timestamp: "2026-06-10T01:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    },
    {
      timestamp: "2026-06-10T01:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "hi" }],
      },
    },
    {
      timestamp: "2026-06-10T01:00:04.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "rules" }],
      },
    },
    {
      timestamp: "2026-06-10T01:00:05.000Z",
      type: "response_item",
      payload: { type: "reasoning", summary: [{ text: "thinking" }] },
    },
    {
      timestamp: "2026-06-10T01:00:06.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call-1",
        arguments: "{}",
      },
    },
    {
      timestamp: "2026-06-10T01:00:07.000Z",
      type: "response_item",
      payload: { type: "function_call_output", call_id: "call-1", output: "ok" },
    },
    {
      timestamp: "2026-06-10T01:00:08.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "apply_patch",
        call_id: "call-2",
        input: "patch",
        status: "completed",
      },
    },
    {
      timestamp: "2026-06-10T01:00:09.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call_output", call_id: "call-2", output: "ok" },
    },
    {
      timestamp: "2026-06-10T01:00:10.000Z",
      type: "response_item",
      payload: { type: "web_search_call", status: "completed" },
    },
    {
      timestamp: "2026-06-10T01:00:11.000Z",
      type: "response_item",
      payload: { type: "unknown_payload" },
    },
    {
      timestamp: "2026-06-10T01:00:12.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 142000,
            cached_input_tokens: 2400,
            output_tokens: 300,
            reasoning_output_tokens: 12,
            total_tokens: 142312,
          },
          total_token_usage: {
            input_tokens: 1800000,
            cached_input_tokens: 400000,
            output_tokens: 54000,
            reasoning_output_tokens: 12000,
            total_tokens: 1866000,
          },
          model_context_window: 258400,
        },
      },
    },
    {
      timestamp: "2026-06-10T01:00:13.000Z",
      type: "event_msg",
      payload: { type: "context_compacted" },
    },
    {
      timestamp: "2026-06-10T01:00:14.000Z",
      type: "compacted",
      payload: {},
    },
    {
      timestamp: "2026-06-10T01:00:15.000Z",
      type: "event_msg",
      payload: { type: "turn_aborted" },
    },
    {
      timestamp: "2026-06-10T01:00:16.000Z",
      type: "unknown_top",
      payload: {},
    },
  ];

  const summary = summarizeSessionEvents(events);

  assert.equal(summary.events.total, 17);
  assert.equal(summary.events.byType.session_meta, 1);
  assert.equal(summary.events.byType.response_item, 10);
  assert.equal(summary.events.byType.event_msg, 3);
  assert.equal(summary.events.byType.turn_context, 1);
  assert.equal(summary.events.byType.compacted, 1);
  assert.equal(summary.events.byType.unknown_top, 1);
  assert.equal(summary.events.responseItems.message, 3);
  assert.equal(summary.events.responseItems.reasoning, 1);
  assert.equal(summary.events.responseItems.function_call, 1);
  assert.equal(summary.events.responseItems.function_call_output, 1);
  assert.equal(summary.events.responseItems.custom_tool_call, 1);
  assert.equal(summary.events.responseItems.custom_tool_call_output, 1);
  assert.equal(summary.events.responseItems.web_search_call, 1);
  assert.equal(summary.events.responseItems.unknown_payload, 1);
  assert.equal(summary.events.eventMessages.token_count, 1);
  assert.equal(summary.events.eventMessages.context_compacted, 1);
  assert.equal(summary.events.eventMessages.turn_aborted, 1);
  assert.equal(summary.events.compactions, 2);
  assert.equal(summary.events.turnAborts, 1);

  assert.deepEqual(summary.messages.roles, {
    user: 1,
    assistant: 1,
    developer: 1,
    system: 0,
    tool: 0,
    unknown: 0,
  });
  assert.equal(summary.messages.reasoning, 1);

  assert.equal(summary.tools.calls, 3);
  assert.equal(summary.tools.outputs, 2);
  assert.deepEqual(summary.tools.byName, [
    { name: "apply_patch", count: 1 },
    { name: "exec_command", count: 1 },
    { name: "web_search", count: 1 },
  ]);

  assert.deepEqual(summary.tokens.last, {
    inputTokens: 142000,
    cachedInputTokens: 2400,
    outputTokens: 300,
    reasoningOutputTokens: 12,
    totalTokens: 142312,
  });
  assert.deepEqual(summary.tokens.total, {
    inputTokens: 1800000,
    cachedInputTokens: 400000,
    outputTokens: 54000,
    reasoningOutputTokens: 12000,
    totalTokens: 1866000,
  });
  assert.equal(summary.tokens.modelContextWindow, 258400);
  assert.equal(summary.tokens.contextWindowUsedPercent, 55);

  assert.deepEqual(summary.session, {
    id: "session-one",
    startedAt: "2026-06-10T01:00:00.000Z",
    cwd: "/repo",
    originator: "codex_cli",
    cliVersion: "0.135.0",
    modelProvider: "openai",
    model: "gpt-5-codex",
    gitBranch: "main",
    gitCommitHash: "abc123",
    approvalPolicy: "on-request",
    sandboxPolicy: "workspace-write",
    collaborationMode: "Default",
    effort: "medium",
    timezone: "Asia/Shanghai",
    currentDate: "2026-06-10",
  });
});

test("summarizeSessionEvents falls back to event_msg reasoning when response-item reasoning is absent", () => {
  const summary = summarizeSessionEvents([
    { type: "event_msg", payload: { type: "agent_reasoning", text: "thinking" } },
  ]);

  assert.equal(summary.messages.reasoning, 1);
});

test("summarizeSessionEvents reports unknown token fields without estimating values", () => {
  const summary = summarizeSessionEvents([
    { type: "session_meta", payload: { id: "session-without-tokens" } },
  ]);

  assert.equal(summary.tokens.last, null);
  assert.equal(summary.tokens.total, null);
  assert.equal(summary.tokens.modelContextWindow, null);
  assert.equal(summary.tokens.contextWindowUsedPercent, null);
});

test("summarizeSessionEvents ignores non-object session entries", () => {
  const summary = summarizeSessionEvents([
    null,
    "not an object",
    { type: "response_item", payload: { type: "message", role: "assistant" } },
  ]);

  assert.equal(summary.events.total, 1);
  assert.equal(summary.messages.roles.assistant, 1);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/app-server/session-summary.test.ts
```

Expected: FAIL with an import error for `../../src/app-server/session-summary.ts`.

## Task 2: Backend Summary Implementation

**Files:**
- Create: `src/app-server/session-summary.ts`
- Test: `tests/app-server/session-summary.test.ts`

- [ ] **Step 1: Add the summary module**

Create `src/app-server/session-summary.ts` with:

```ts
export type TokenUsageSummary = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
};

export type SessionSummary = {
  events: {
    total: number;
    byType: Record<string, number>;
    responseItems: Record<string, number>;
    eventMessages: Record<string, number>;
    compactions: number;
    turnAborts: number;
  };
  messages: {
    roles: Record<"user" | "assistant" | "developer" | "system" | "tool" | "unknown", number>;
    reasoning: number;
  };
  tools: {
    calls: number;
    outputs: number;
    byName: Array<{ name: string; count: number }>;
  };
  tokens: {
    last: TokenUsageSummary | null;
    total: TokenUsageSummary | null;
    modelContextWindow: number | null;
    contextWindowUsedPercent: number | null;
  };
  session: {
    id: string | null;
    startedAt: string | null;
    cwd: string | null;
    originator: string | null;
    cliVersion: string | null;
    modelProvider: string | null;
    model: string | null;
    gitBranch: string | null;
    gitCommitHash: string | null;
    approvalPolicy: string | null;
    sandboxPolicy: string | null;
    collaborationMode: string | null;
    effort: string | null;
    timezone: string | null;
    currentDate: string | null;
  };
};

type SessionEvent = {
  type?: string;
  payload?: unknown;
};

const KNOWN_ROLES = ["user", "assistant", "developer", "system", "tool"] as const;
const TOOL_CALL_TYPES = new Set(["function_call", "custom_tool_call", "tool_search_call", "web_search_call"]);
const TOOL_OUTPUT_TYPES = new Set([
  "function_call_output",
  "custom_tool_call_output",
  "tool_search_output",
]);

export function summarizeSessionEvents(rawEvents: unknown[]): SessionSummary {
  const events = rawEvents.filter(isRecord) as SessionEvent[];
  const byType: Record<string, number> = {};
  const responseItems: Record<string, number> = {};
  const eventMessages: Record<string, number> = {};
  const roles = emptyRoleCounts();
  const toolCounts = new Map<string, number>();

  let hasResponseItemReasoning = false;
  let eventMsgReasoning = 0;
  let reasoning = 0;
  let toolCalls = 0;
  let toolOutputs = 0;
  let compactions = 0;
  let turnAborts = 0;
  let latestLastUsage: TokenUsageSummary | null = null;
  let latestTotalUsage: TokenUsageSummary | null = null;
  let latestModelContextWindow: number | null = null;
  let sessionMeta: Record<string, unknown> | null = null;
  let turnContext: Record<string, unknown> | null = null;

  for (const event of events) {
    const eventType = stringOr(event.type, "unknown");
    increment(byType, eventType);

    const payload = isRecord(event.payload) ? event.payload : {};
    if (eventType === "session_meta" && sessionMeta === null) {
      sessionMeta = payload;
    }
    if (eventType === "turn_context" && turnContext === null) {
      turnContext = payload;
    }

    if (eventType === "response_item") {
      const payloadType = stringOr(payload.type, "unknown");
      increment(responseItems, payloadType);

      if (payloadType === "message") {
        const role = normalizeRole(payload.role);
        roles[role] += 1;
      }
      if (payloadType === "reasoning") {
        hasResponseItemReasoning = true;
        reasoning += 1;
      }
      if (TOOL_CALL_TYPES.has(payloadType)) {
        toolCalls += 1;
        incrementTool(toolCounts, toolNameForPayload(payloadType, payload));
      }
      if (TOOL_OUTPUT_TYPES.has(payloadType)) {
        toolOutputs += 1;
      }
    }

    if (eventType === "event_msg") {
      const payloadType = stringOr(payload.type, "unknown");
      increment(eventMessages, payloadType);
      if (payloadType === "agent_reasoning") {
        eventMsgReasoning += 1;
      }
      if (payloadType === "context_compacted") {
        compactions += 1;
      }
      if (payloadType === "turn_aborted") {
        turnAborts += 1;
      }
      if (payloadType === "token_count") {
        const info = isRecord(payload.info) ? payload.info : {};
        latestLastUsage = readTokenUsage(info.last_token_usage);
        latestTotalUsage = readTokenUsage(info.total_token_usage);
        latestModelContextWindow = numberOrNull(info.model_context_window);
      }
    }

    if (eventType === "compacted") {
      compactions += 1;
    }
  }

  if (!hasResponseItemReasoning) {
    reasoning += eventMsgReasoning;
  }

  return {
    events: {
      total: events.length,
      byType,
      responseItems,
      eventMessages,
      compactions,
      turnAborts,
    },
    messages: {
      roles,
      reasoning,
    },
    tools: {
      calls: toolCalls,
      outputs: toolOutputs,
      byName: [...toolCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    },
    tokens: {
      last: latestLastUsage,
      total: latestTotalUsage,
      modelContextWindow: latestModelContextWindow,
      contextWindowUsedPercent: contextWindowPercent(latestLastUsage, latestModelContextWindow),
    },
    session: readSessionDetails(sessionMeta, turnContext),
  };
}

function readSessionDetails(
  sessionMeta: Record<string, unknown> | null,
  turnContext: Record<string, unknown> | null,
): SessionSummary["session"] {
  const git = isRecord(sessionMeta?.git) ? sessionMeta.git : {};
  return {
    id: stringOrNull(sessionMeta?.id),
    startedAt: stringOrNull(sessionMeta?.timestamp),
    cwd: stringOrNull(sessionMeta?.cwd),
    originator: stringOrNull(sessionMeta?.originator),
    cliVersion: stringOrNull(sessionMeta?.cli_version),
    modelProvider: stringOrNull(sessionMeta?.model_provider),
    model: stringOrNull(turnContext?.model),
    gitBranch: stringOrNull(git.branch),
    gitCommitHash: stringOrNull(git.commit_hash),
    approvalPolicy: stringOrNull(turnContext?.approval_policy),
    sandboxPolicy: stringOrNull(turnContext?.sandbox_policy),
    collaborationMode: stringOrNull(turnContext?.collaboration_mode),
    effort: stringOrNull(turnContext?.effort),
    timezone: stringOrNull(turnContext?.timezone),
    currentDate: stringOrNull(turnContext?.current_date),
  };
}

function readTokenUsage(value: unknown): TokenUsageSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    inputTokens: numberOrNull(value.input_tokens),
    cachedInputTokens: numberOrNull(value.cached_input_tokens),
    outputTokens: numberOrNull(value.output_tokens),
    reasoningOutputTokens: numberOrNull(value.reasoning_output_tokens),
    totalTokens: numberOrNull(value.total_tokens),
  };
}

function contextWindowPercent(
  lastUsage: TokenUsageSummary | null,
  modelContextWindow: number | null,
): number | null {
  if (lastUsage?.inputTokens === null || lastUsage?.inputTokens === undefined) {
    return null;
  }
  if (modelContextWindow === null || modelContextWindow <= 0) {
    return null;
  }
  return Math.round((lastUsage.inputTokens / modelContextWindow) * 100);
}

function normalizeRole(value: unknown): keyof SessionSummary["messages"]["roles"] {
  if (KNOWN_ROLES.includes(value as (typeof KNOWN_ROLES)[number])) {
    return value as keyof SessionSummary["messages"]["roles"];
  }
  return "unknown";
}

function toolNameForPayload(payloadType: string, payload: Record<string, unknown>): string {
  const explicitName = stringOrNull(payload.name);
  if (explicitName) {
    return explicitName;
  }
  if (payloadType === "web_search_call") {
    return "web_search";
  }
  if (payloadType === "tool_search_call") {
    return "tool_search";
  }
  return "tool";
}

function emptyRoleCounts(): SessionSummary["messages"]["roles"] {
  return {
    user: 0,
    assistant: 0,
    developer: 0,
    system: 0,
    tool: 0,
    unknown: 0,
  };
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function incrementTool(target: Map<string, number>, name: string): void {
  target.set(name, (target.get(name) ?? 0) + 1);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 2: Run the focused summary tests**

Run:

```bash
node --test tests/app-server/session-summary.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit backend summary module**

Run:

```bash
git add src/app-server/session-summary.ts tests/app-server/session-summary.test.ts
git commit -m "Add agent session summary metrics"
```

Expected: commit succeeds.

## Task 3: HTTP API Integration

**Files:**
- Modify: `src/http/api.ts`
- Modify: `tests/http/api.test.ts`
- Modify: `tests/daemon.test.ts`

- [ ] **Step 1: Update HTTP and daemon tests first**

In `tests/http/api.test.ts`, update `GET /agents/:id/session returns agent metadata and Codex session events` so the assertions include:

```ts
      assert.equal(body.summary.events.total, 2);
      assert.equal(body.summary.events.byType.session_meta, 1);
      assert.equal(body.summary.events.byType.response_item, 1);
      assert.equal(body.summary.messages.roles.user, 1);
      assert.equal(body.summary.tokens.last, null);
```

In `tests/daemon.test.ts`, update `startDaemon exposes current client session events through the HTTP API` so the assertions include:

```ts
    assert.equal(body.summary.events.total, 2);
    assert.equal(body.summary.messages.roles.user, 1);
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
node --test tests/http/api.test.ts tests/daemon.test.ts
```

Expected: FAIL because `body.summary` is undefined.

- [ ] **Step 3: Add summary to the session endpoint**

Modify the imports at the top of `src/http/api.ts`:

```ts
import { summarizeSessionEvents } from "../app-server/session-summary.ts";
```

Modify the successful `/agents/:id/session` response inside `handleRequest()` from:

```ts
      sendJson(response, 200, { agent, events });
```

to:

```ts
      sendJson(response, 200, { agent, events, summary: summarizeSessionEvents(events) });
```

- [ ] **Step 4: Run the targeted tests**

Run:

```bash
node --test tests/http/api.test.ts tests/daemon.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit HTTP integration**

Run:

```bash
git add src/http/api.ts tests/http/api.test.ts tests/daemon.test.ts
git commit -m "Expose agent session summaries"
```

Expected: commit succeeds.

## Task 4: Frontend Markup And Rendering

**Files:**
- Modify: `src/ui/agent.html`
- Modify: `src/ui/agent.js`
- Modify: `tests/http/api.test.ts`

- [ ] **Step 1: Add static asset assertions**

In `tests/http/api.test.ts`, update `GET /ui/agent.html serves the agent session page` with:

```ts
    assert.match(html, /id="session-summary"/);
    assert.match(html, /id="session-diagnostics"/);
```

Update `GET /ui assets wire dashboard message links and euphony session rendering` with:

```ts
    assert.match(session, /renderSessionSummary/);
    assert.match(session, /renderDiagnostics/);
    assert.match(session, /Context tokens/);
    assert.match(session, /Total tokens/);
    assert.match(session, /unknown/);
```

- [ ] **Step 2: Run the frontend asset test and verify it fails**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: FAIL because the new HTML ids and JavaScript functions are absent.

- [ ] **Step 3: Add summary containers to the session HTML**

Modify `src/ui/agent.html` so the area after `session-error` is:

```html
      <section id="session-error" class="error-banner" aria-live="polite" hidden></section>

      <section id="session-summary" class="session-summary" aria-label="Agent session summary" hidden>
        <div id="session-summary-grid" class="session-summary__grid"></div>
        <details id="session-diagnostics" class="session-diagnostics">
          <summary>Diagnostics</summary>
          <div id="session-diagnostics-content" class="session-diagnostics__content"></div>
        </details>
      </section>

      <section class="session-panel" aria-label="Agent session messages">
```

- [ ] **Step 4: Replace `src/ui/agent.js` summary-related structure**

Modify the `elements` object in `src/ui/agent.js` to include:

```js
  summary: requiredElement("session-summary"),
  summaryGrid: requiredElement("session-summary-grid"),
  diagnostics: requiredElement("session-diagnostics"),
  diagnosticsContent: requiredElement("session-diagnostics-content"),
```

Modify `loadAgentSession()` success handling from:

```js
    renderHeader(payload.agent);
    renderConversation(payload.events);
```

to:

```js
    renderHeader(payload.agent);
    const renderedMessageCount = renderConversation(payload.events);
    renderSessionSummary(payload.summary, renderedMessageCount);
```

Modify `renderConversation(events)` so it returns a count:

```js
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
```

Add these functions after `renderConversation()`:

```js
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
  for (const [label, value] of rows.filter(([, value]) => value !== null && value !== undefined)) {
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
```

Modify `setLoading()` and `showError()` so the summary is hidden during loading and errors:

```js
  elements.summary.hidden = true;
  elements.summaryGrid.replaceChildren();
  elements.diagnosticsContent.replaceChildren();
```

- [ ] **Step 5: Run the frontend asset test**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit frontend markup and rendering**

Run:

```bash
git add src/ui/agent.html src/ui/agent.js tests/http/api.test.ts
git commit -m "Render agent session summaries"
```

Expected: commit succeeds.

## Task 5: Session Summary Styling

**Files:**
- Modify: `src/ui/styles.css`
- Modify: `tests/http/api.test.ts`

- [ ] **Step 1: Add style assertions**

In `tests/http/api.test.ts`, update `GET /ui assets wire dashboard message links and euphony session rendering` with:

```ts
    assert.match(styles, /\.session-summary/);
    assert.match(styles, /\.session-summary-card/);
    assert.match(styles, /\.session-diagnostics/);
```

- [ ] **Step 2: Run the asset test and verify it fails**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: FAIL because the new CSS selectors are absent.

- [ ] **Step 3: Add session summary CSS**

Add this block near the existing `.session-panel` styles in `src/ui/styles.css`:

```css
.session-summary {
  margin-top: 12px;
}

.session-summary__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(110px, 1fr));
  gap: 10px;
}

.session-summary-card {
  min-width: 0;
  border: 1px solid #cfd8e3;
  border-radius: 8px;
  background: #ffffff;
  padding: 10px 12px;
}

.session-summary-card span {
  display: block;
  color: #637487;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-summary-card strong {
  display: block;
  margin-top: 4px;
  color: #1f2933;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.session-diagnostics {
  margin-top: 10px;
  border: 1px solid #cfd8e3;
  border-radius: 8px;
  background: #ffffff;
}

.session-diagnostics summary {
  cursor: pointer;
  padding: 10px 12px;
  color: #2f6f9f;
  font-weight: 700;
}

.session-diagnostics summary:focus-visible {
  outline: 2px solid #4d8fcc;
  outline-offset: 2px;
}

.session-diagnostics__content {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  border-top: 1px solid #dbe2ea;
  padding: 12px;
}

.session-diagnostics__section {
  min-width: 0;
}

.session-diagnostics__section h2 {
  margin: 0 0 8px;
  color: #405261;
  font-size: 13px;
  letter-spacing: 0;
}

.session-diagnostics__section dl {
  display: grid;
  grid-template-columns: minmax(90px, 0.8fr) minmax(0, 1.2fr);
  gap: 5px 8px;
  margin: 0;
}

.session-diagnostics__section dt {
  color: #637487;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-diagnostics__section dd {
  min-width: 0;
  margin: 0;
  color: #1f2933;
  overflow-wrap: anywhere;
}
```

Inside the existing `@media (max-width: 920px)` block, add:

```css
  .session-summary__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .session-diagnostics__content {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 4: Run the asset test**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit summary styles**

Run:

```bash
git add src/ui/styles.css tests/http/api.test.ts
git commit -m "Style agent session summaries"
```

Expected: commit succeeds.

## Task 6: Full Verification

**Files:**
- Verify all changed files from Tasks 1-5.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 3: Inspect the final status**

Run:

```bash
git status --short --branch
```

Expected: branch is ahead with a clean working tree.

- [ ] **Step 4: Report implementation result**

Report:

- commit hashes created by the implementation tasks;
- `npm test` result;
- `git diff --check` result;
- any manual browser smoke test result if a local daemon was started.
