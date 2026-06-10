# Agent Session Summary Design

Date: 2026-06-10

## Summary

Enhance the agent session message page with a compact session summary and an expandable diagnostics section. The page already lets a user open an agent-specific session view and renders Codex JSONL messages through the vendored Euphony conversation component. This feature adds context around that message list without changing the rendering path.

The chosen product direction is a combined reading and diagnostics view:

- Default state: small KPI strip optimized for reading the conversation.
- Expanded state: deeper diagnostics for raw events, roles, tools, token usage, and session metadata.

## Goals

- Show useful session-level information above the Euphony message list.
- Keep the default session page lightweight and focused on reading messages.
- Provide diagnostics on demand without crowding the conversation.
- Compute summary data in this project, not through Euphony internals.
- Keep `/agents/:id/session` as the single data source for the session page.
- Avoid token estimation. Display token fields only when Codex session events provide them.

## Non-Goals

- Do not change how Euphony renders the message list.
- Do not add a separate frontend build step or framework.
- Do not add mutation or control actions for agents.
- Do not expose message text, tool output text, or raw event bodies in the summary API.
- Do not infer token counts when `event_msg:token_count` is absent.
- Do not make rate-limit data prominent in the first version.

## Data Source

The existing session endpoint reads a Codex session JSONL file and returns parsed JSON events. Those raw events remain the source for both:

- Euphony rendering in the browser.
- AgentBoard-owned session summary calculation.

The summary logic should tolerate unknown event shapes. Unknown events should be counted as unknown where useful, not treated as a fatal error.

## Summary Metrics

The default compact KPI strip shows:

| Metric | Definition |
| --- | --- |
| Messages | Rendered Euphony message count: `parsed.conversation.messages.length` in the browser. This is intentionally based on the same parsed conversation that is rendered on screen. |
| Raw events | Raw JSONL event count: `events.length`. |
| Tool calls | Count of tool-call-like `response_item` payloads, including `function_call`, `custom_tool_call`, `tool_search_call`, and `web_search_call`. |
| Reasoning | Count of `response_item:reasoning`, plus fallback `event_msg:agent_reasoning` when response-item reasoning is absent. |
| Context | Latest `event_msg:token_count.payload.info.last_token_usage.input_tokens` divided by `model_context_window`. |
| Total tokens | Latest `event_msg:token_count.payload.info.total_token_usage.total_tokens`. |
| Compactions | Count of `event_msg:context_compacted` plus top-level `compacted`. If `event_msg:turn_aborted` exists, show it as a secondary indicator in the same area. |

Token terminology must stay precise:

- `last_token_usage.input_tokens` means the latest observed request context input tokens.
- `model_context_window` means the model context window limit.
- `total_token_usage.total_tokens` means accumulated session token usage.
- None of these values should be described as exact current context length unless the source field explicitly supports that meaning.

## Diagnostics Metrics

The expandable diagnostics section shows:

- Role counts: user, assistant, developer, system, tool, and unknown.
- Top-level event counts: `session_meta`, `response_item`, `event_msg`, `turn_context`, `compacted`, and unknown.
- Response payload type counts: `message`, `reasoning`, `function_call`, `function_call_output`, `custom_tool_call`, `custom_tool_call_output`, `web_search_call`, `tool_search_call`, and unknown.
- Tool counts by tool name, such as `exec_command`, `write_stdin`, `apply_patch`, and `update_plan`.
- Token details from the latest token-count event:
  - last usage: input, cached input, output, reasoning output, total;
  - total usage: input, cached input, output, reasoning output, total;
  - model context window.
- Session details when present:
  - session id;
  - started timestamp;
  - cwd;
  - originator;
  - CLI version;
  - model provider;
  - model from `turn_context`;
  - git branch and commit;
  - approval policy;
  - sandbox policy;
  - collaboration mode;
  - effort;
  - timezone and current date.

Diagnostics should remain textual and compact. It is acceptable to show only non-empty groups.

## API Design

Keep the existing route:

```http
GET /agents/:id/session
```

Extend the response from:

```json
{
  "agent": {},
  "events": []
}
```

to:

```json
{
  "agent": {},
  "events": [],
  "summary": {
    "messages": {},
    "events": {},
    "tools": {},
    "tokens": {},
    "session": {}
  }
}
```

The exact property names can follow local implementation style, but the response should use a stable object shape with numbers, strings, booleans, arrays, and nulls only. It should not include raw event objects, message content, tool output content, or large nested payloads.

If summary calculation cannot identify an optional field, that field should be `null` or omitted from the relevant group. A readable event count should still be returned whenever the events array is available.

## Backend Design

Add a small summary module, for example:

```text
src/app-server/session-summary.ts
```

Responsibilities:

- Accept `unknown[]` session events.
- Normalize and type-check only the fields needed for metrics.
- Count known event and payload types.
- Extract latest token-count data.
- Extract safe session and turn-context metadata.
- Return a serializable summary object.

The HTTP layer should call this module after reading events and include the summary in the JSON response. Summary calculation should be written to be defensive enough that malformed optional payloads do not make the whole session endpoint fail.

The existing `session-files.ts` file remains focused on finding and reading JSONL files. It should not grow summary responsibilities.

## Frontend Design

Use the selected compact KPI strip layout.

Page structure:

- Existing header remains the agent identity area.
- Add a summary strip between the error banner and the message panel.
- Add a diagnostics disclosure below or inside the summary strip.
- Keep the Euphony message panel as the dominant page content.

Frontend behavior:

- Continue passing `payload.events` to `parseCodexSession`.
- Render messages through `<euphony-conversation>` exactly as today.
- Render summary and diagnostics from `payload.summary`.
- Use the Euphony parsed conversation to populate the displayed rendered-message count, because that is the count users see in the message list.
- If `summary` is missing or partial, render available values and show `unknown` for unavailable token data.
- If Euphony cannot render messages but summary exists, keep the summary visible and show the existing empty message state.

The diagnostics section should be collapsed by default. A native `<details>` element is acceptable if it fits existing styling and accessibility needs.

## Error Handling

Existing session errors remain:

- Missing agent id in the URL shows a frontend error.
- Unknown agent returns `agent_not_found`.
- Missing session file returns `session_not_found`.
- Unavailable session reader returns `session_reader_unavailable`.
- Read or parse failure returns `session_unavailable`.

Summary-specific behavior:

- Unknown event types should not fail the endpoint.
- Missing token-count events should produce unknown token UI, not an error.
- Missing metadata should hide or empty only the relevant metadata rows.
- Diagnostics should clearly distinguish zero from unknown.

## Privacy And Payload Size

The summary response should be safe to inspect in browser dev tools:

- It may include counts, ids, model names, cwd, git branch, git commit, and policy names.
- It must not duplicate message text, tool command output, or raw event JSON.
- Tool names are allowed because they are already visible through rendered tool-call messages.

The endpoint still returns `events` for Euphony rendering, so this feature does not make the privacy surface larger than the current session page.

## Testing

Use test-driven implementation.

Backend unit tests should cover:

- Raw event count.
- Top-level event counts.
- Role counts from `response_item:message`.
- Tool call and output counts.
- Tool name counts.
- Reasoning count with response-item reasoning.
- Fallback reasoning count from `event_msg:agent_reasoning`.
- Latest token-count extraction.
- Missing token-count behavior.
- Compaction and turn-abort counts.
- Unknown event and payload types.

HTTP API tests should cover:

- `/agents/:id/session` returns `summary`.
- Existing `agent` and `events` fields remain present.
- Missing session and missing reader errors keep their current behavior.

Frontend tests should cover:

- `agent.js` contains the summary rendering path.
- The summary strip exists in `agent.html`.
- Diagnostics are collapsed by default.
- Token values degrade to `unknown` when absent.

Final verification should run the existing project test suite.

## Acceptance Criteria

- The session page shows a compact summary above the message list.
- The message list still renders through vendored Euphony.
- Default UI remains focused on reading the conversation.
- Diagnostics can be expanded to inspect event, role, tool, token, and metadata details.
- Token display uses observed `token_count` data only.
- No local Euphony repository dependency is introduced.
- Automated tests cover summary calculation and session endpoint integration.
