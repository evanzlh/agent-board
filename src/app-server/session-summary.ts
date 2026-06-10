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
const TOP_LEVEL_EVENT_TYPES = new Set([
  "session_meta",
  "response_item",
  "event_msg",
  "turn_context",
  "compacted",
]);
const RESPONSE_ITEM_TYPES = new Set([
  "message",
  "reasoning",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "tool_search_call",
  "tool_search_output",
  "web_search_call",
]);
const EVENT_MESSAGE_TYPES = new Set([
  "agent_reasoning",
  "agent_message",
  "context_compacted",
  "token_count",
  "turn_aborted",
  "user_message",
]);
const TOOL_CALL_TYPES = new Set([
  "function_call",
  "custom_tool_call",
  "tool_search_call",
  "web_search_call",
]);
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
    const eventType = knownTypeOrUnknown(event.type, TOP_LEVEL_EVENT_TYPES);
    increment(byType, eventType);

    const payload = isRecord(event.payload) ? event.payload : {};

    if (eventType === "session_meta" && sessionMeta === null) {
      sessionMeta = payload;
    }
    if (eventType === "turn_context" && turnContext === null) {
      turnContext = payload;
    }

    if (eventType === "response_item") {
      const payloadType = knownTypeOrUnknown(payload.type, RESPONSE_ITEM_TYPES);
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
      const payloadType = knownTypeOrUnknown(payload.type, EVENT_MESSAGE_TYPES);
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
  if (
    lastUsage?.inputTokens === null ||
    lastUsage?.inputTokens === undefined ||
    modelContextWindow === null ||
    modelContextWindow <= 0
  ) {
    return null;
  }

  return Math.round((lastUsage.inputTokens / modelContextWindow) * 100);
}

function normalizeRole(value: unknown): keyof ReturnType<typeof emptyRoleCounts> {
  if (typeof value !== "string") {
    return "unknown";
  }
  return KNOWN_ROLES.includes(value as (typeof KNOWN_ROLES)[number])
    ? (value as (typeof KNOWN_ROLES)[number])
    : "unknown";
}

function toolNameForPayload(type: string, payload: Record<string, unknown>): string {
  const explicitName = stringOrNull(payload.name);
  if (explicitName) {
    return explicitName;
  }
  if (type === "tool_search_call") {
    return "tool_search";
  }
  if (type === "web_search_call") {
    return "web_search";
  }
  return type;
}

function emptyRoleCounts(): Record<
  "user" | "assistant" | "developer" | "system" | "tool" | "unknown",
  number
> {
  return {
    user: 0,
    assistant: 0,
    developer: 0,
    system: 0,
    tool: 0,
    unknown: 0,
  };
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function incrementTool(counts: Map<string, number>, name: string): void {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function knownTypeOrUnknown(value: unknown, knownTypes: Set<string>): string {
  if (typeof value !== "string" || value.length === 0) {
    return "unknown";
  }
  return knownTypes.has(value) ? value : "unknown";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
