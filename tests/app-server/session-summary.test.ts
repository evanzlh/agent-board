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
