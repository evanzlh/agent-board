# Codex Status Dashboard Design

Date: 2026-05-29

## Summary

Build `codex-status` as a local read-only daemon that observes Codex App Server state and exposes a stable JSON API for status dashboards and scripts.

The first version does not provide a Web UI or terminal UI. It focuses on a reliable status collection layer, an in-memory normalized status store, and local HTTP endpoints that future UIs can consume.

## Goals

- Observe current Codex work through Codex App Server.
- Expose current agent/thread status through local JSON endpoints.
- Represent Codex threads as the reliable base unit.
- Add sub-agent metadata and parent-child information when App Server provides it.
- Detect and expose statuses including idle, working, waiting for approval, waiting for user input, error, and unknown.
- Default to starting or reusing Codex App Server, with an option to disable auto-start.
- Keep the daemon read-only: no task start, stop, resume, fork, archive, approve, or reject actions.

## Non-Goals

- No Web UI or terminal UI in the first version.
- No creation of new Codex tasks.
- No mutation of Codex threads.
- No approval handling APIs.
- No cross-machine remote-control support.
- No process, log, or traditional TUI scraping.
- No long-lived `finished` state for normal App Server threads; long-lived state should follow App Server's runtime state.

## Architecture

The daemon has four main components.

### AppServerSupervisor

`AppServerSupervisor` ensures Codex App Server is available.

On startup, it checks for `codex`, reads `codex --version`, and verifies App Server availability. By default, it first tries to start or reuse the Codex App Server daemon by running:

```bash
codex app-server daemon start
```

Some Codex installations do not support the managed daemon command. For example, non-standalone installs can return an error that the standalone Codex install is missing. When daemon startup fails for this reason and `auto_start_app_server` is enabled, `codex-status` falls back to starting a managed foreground App Server child process:

```bash
codex app-server --listen stdio://
```

When `--no-start-app-server` is set, it only tries to connect to an existing App Server and fails startup if it cannot connect.

`codex-status` does not stop an external Codex App Server daemon on shutdown, because that App Server may be shared with other clients. It does stop a foreground App Server child process that it started itself.

### AppServerClient

`AppServerClient` owns all App Server protocol details.

It connects through Codex App Server's JSON-RPC interface or SDK layer, reads initial state from APIs such as `thread/list` and `thread/loaded/list`, and consumes notifications including:

- `thread/status/changed`
- `turn/started`
- `turn/completed`
- `item/started`
- `item/completed`
- `serverRequest/resolved`

The rest of the daemon should not depend directly on raw App Server protocol shapes.

### StatusStore

`StatusStore` maintains an in-memory snapshot of current agent/thread state.

Threads are the base unit. Sub-agent metadata is layered on top when available through fields such as `agentNickname`, `agentRole`, `source.subAgent`, and `forkedFromId`.

The store produces stable public status objects and aggregate summaries. It also emits internal change events for the HTTP Server-Sent Events endpoint.

### HttpApi

`HttpApi` exposes read-only local endpoints over HTTP. The default bind host is `127.0.0.1`; the default port is `17345`.

Future Web or TUI clients should consume this HTTP API rather than integrating directly with Codex App Server.

## Public Status Model

The public model is `AgentStatus`. One record corresponds to one Codex thread.

```json
{
  "id": "thread-id",
  "sessionId": "session-id",
  "kind": "main_agent",
  "displayName": "Implement dashboard",
  "status": "working",
  "rawStatus": {
    "type": "active",
    "activeFlags": []
  },
  "cwd": "/path/to/workspace",
  "preview": "first user message",
  "modelProvider": "openai",
  "cliVersion": "0.135.0",
  "createdAt": 1780010000,
  "updatedAt": 1780010100,
  "parentThreadId": null,
  "agentNickname": null,
  "agentRole": null,
  "lastTurn": {
    "status": "inProgress",
    "startedAt": 1780010050,
    "completedAt": null
  },
  "waitingSince": null,
  "lastEventAt": 1780010100,
  "stale": false
}
```

### Agent Kind

`kind` is derived as follows:

- `sub_agent` when `agentNickname` or `agentRole` is present.
- `sub_agent` when the App Server source indicates a sub-agent.
- `unknown` when `forkedFromId` is present but no sub-agent marker is available.
- `main_agent` otherwise.

`parentThreadId` is derived from `source.subAgent.thread_spawn.parent_thread_id` when present. If that field is absent, `forkedFromId` is used as a weaker fallback. When no parent can be inferred, it is `null`.

### Display Name

`displayName` is selected in this order:

1. `agentNickname`
2. `agentRole`
3. thread `name`
4. thread `preview`
5. thread id

## Status Mapping

The daemon maps App Server state into stable public statuses.

| App Server input | Public status |
| --- | --- |
| `thread.status.type = idle` | `idle` |
| `thread.status.type = active` and `activeFlags` contains `waitingOnApproval` | `waiting_approval` |
| `thread.status.type = active` and `activeFlags` contains `waitingOnUserInput` | `waiting_input` |
| `thread.status.type = active` without waiting flags | `working` |
| `thread.status.type = systemError` | `error` |
| recent turn failed | `error` |
| protocol shape cannot be interpreted | `unknown` |

`rawStatus` is always preserved when available so users can inspect App Server behavior as Codex evolves.

`finished` is reserved for future one-shot or closed/archived task representations. In the MVP, completed turns are represented in `lastTurn.status`, while a thread that is no longer active usually returns to `idle`.

## HTTP API

All endpoints are local and read-only.

### `GET /health`

Returns daemon health and App Server connection state.

```json
{
  "ok": true,
  "daemon": {
    "version": "0.1.0",
    "startedAt": 1780010000
  },
  "appServer": {
    "connected": true,
    "autoStarted": true,
    "cliVersion": "0.135.0",
    "lastConnectedAt": 1780010001,
    "lastError": null
  }
}
```

### `GET /status`

Returns an aggregate summary and all agent statuses.

```json
{
  "generatedAt": 1780010100,
  "summary": {
    "total": 4,
    "working": 1,
    "idle": 2,
    "waitingApproval": 1,
    "waitingInput": 0,
    "error": 0,
    "unknown": 0
  },
  "agents": []
}
```

### `GET /agents`

Returns the `AgentStatus[]` list.

The first version supports these exact-match filters:

- `status`
- `kind`
- `cwd`

Unknown query parameters should be ignored rather than treated as errors.

### `GET /agents/:id`

Returns one agent status by thread id.

When the agent is not found, the endpoint returns HTTP 404 with a JSON error body.

### `GET /events`

Returns Server-Sent Events for status changes.

Example event payload:

```json
{
  "type": "agent.updated",
  "agentId": "thread-id",
  "status": "waiting_approval",
  "at": 1780010100
}
```

The SSE endpoint is included in the first version so future UI clients can update without polling.

## Configuration

Default configuration:

```toml
host = "127.0.0.1"
port = 17345
auto_start_app_server = true
refresh_interval_ms = 5000
stale_after_ms = 30000
```

CLI flags override config file values:

```bash
codex-status daemon --host 127.0.0.1 --port 17345
codex-status daemon --no-start-app-server
codex-status daemon --refresh-interval-ms 2000
```

## Daemon Lifecycle

Startup flow:

1. Load config and CLI flags.
2. Verify that `codex` exists.
3. Read the local Codex CLI version.
4. Ensure App Server availability, starting or reusing the daemon by default when supported.
5. If daemon startup is unsupported and auto-start is enabled, start a managed foreground App Server child process.
6. Connect to App Server.
7. Read initial thread state.
8. Subscribe to App Server notifications.
9. Start the local HTTP API.

Shutdown flow:

1. Stop accepting new HTTP requests.
2. Close SSE clients.
3. Disconnect from App Server.
4. Stop the managed foreground App Server child process, if `codex-status` started one.
5. Exit without stopping any external Codex App Server daemon.

## Error Handling

- If `codex` is missing, startup fails.
- If App Server daemon startup is unsupported but foreground App Server startup succeeds, startup continues in managed-child mode.
- If both daemon startup and foreground App Server startup fail, startup fails and surfaces the Codex command stderr.
- If `--no-start-app-server` is set and no App Server is available, startup fails.
- If App Server disconnects after startup, HTTP remains available and `/health.appServer.connected` becomes `false`.
- During App Server disconnects, existing agents keep their last known status and are marked `stale=true` after `stale_after_ms`.
- The daemon attempts reconnection every `refresh_interval_ms`.
- If the port is already in use, startup fails and tells the user to pass `--port`.
- If App Server returns an unknown protocol shape, public status becomes `unknown`, `rawStatus` is preserved when possible, and `/health.appServer.lastError` is updated.

## Testing Strategy

### Unit Tests

Status mapping tests cover:

- `idle -> idle`
- `active -> working`
- `active + waitingOnApproval -> waiting_approval`
- `active + waitingOnUserInput -> waiting_input`
- `systemError -> error`
- recent failed turn -> error
- unrecognized raw state -> unknown

Sub-agent tests cover `agentNickname`, `agentRole`, source-based sub-agent markers, and `forkedFromId`.

### Store Tests

`StatusStore` tests simulate:

- initial thread list ingestion
- thread status changes
- turn start and completion
- item start and completion
- App Server disconnects
- reconnects and state refreshes
- stale marking
- summary count updates

### HTTP Integration Tests

HTTP tests use a fake `AppServerClient` so they do not require a real Codex login or App Server process.

They cover:

- `GET /health`
- `GET /status`
- `GET /agents`
- `GET /agents/:id`
- 404 JSON shape
- `GET /events` basic SSE delivery

### Real Environment Smoke Test

A non-default smoke test may start or connect to a real Codex App Server, using either the daemon or managed foreground mode, and verify `/health` and `/status`.

This smoke test should not be required for normal CI because it depends on local Codex installation, auth state, and CLI version.

## Implementation Direction

Use TypeScript/Node for the daemon.

Keep App Server protocol access behind `AppServerClient` so future Codex SDK or App Server protocol changes are isolated. Keep HTTP output stable and treat it as the public contract for later dashboard UI work.
