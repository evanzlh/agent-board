# codex-status

`codex-status` is a local, read-only daemon for observing Codex App Server state. It normalizes Codex threads into agent records, exposes a small JSON/SSE API for dashboards and scripts, and serves a built-in web UI at `/ui`.

> [!NOTE]
> This service observes local Codex state only. It does not approve requests, send user input, stop agents, or mutate Codex sessions.

## What It Provides

- Current agent inventory, including main agents, sub-agents, and parent thread links when available.
- Normalized agent status values: `idle`, `working`, `finished`, `waiting_approval`, `waiting_input`, `error`, and `unknown`.
- App Server health metadata, including connection state, mode, Codex CLI version, and the latest connection error.
- HTTP JSON endpoints for scripts and dashboards.
- Server-Sent Events for `agent.updated` notifications.
- A built-in status board at `http://127.0.0.1:17345/ui`.

## Requirements

- Node.js `>=22.18.0`
- Codex CLI available as `codex`
- A Codex CLI build with App Server support

No build step is required for the current project layout.

## Quick Start

```bash
npm start
```

The daemon listens on `127.0.0.1:17345` by default and prints the resolved URL:

```text
codex-status listening at http://127.0.0.1:17345
```

Open the web UI:

```text
http://127.0.0.1:17345/ui
```

Query the current snapshot:

```bash
curl http://127.0.0.1:17345/status
curl "http://127.0.0.1:17345/agents?status=working"
```

## CLI Usage

```bash
node src/cli.ts daemon [options]
```

| Option | Default | Description |
| --- | --- | --- |
| `--host <host>` | `127.0.0.1` | HTTP bind host. |
| `--port <port>` | `17345` | HTTP bind port. Use `0` for an ephemeral test port. |
| `--no-start-app-server` | disabled | Skip App Server auto-start and connect through `codex app-server proxy` only. |
| `--refresh-interval-ms <ms>` | `5000` | Snapshot refresh, reconnect, and stale-check cadence. |
| `--stale-after-ms <ms>` | `30000` | Mark agents stale after App Server disconnects and no events arrive. |

Example:

```bash
node src/cli.ts daemon --host 0.0.0.0 --port 18000 --refresh-interval-ms 2000
```

## App Server Lifecycle

On startup, `codex-status` runs `codex --version`, then connects to the Codex App Server using one of two modes:

| Mode | When It Is Used | Process Owned By `codex-status` |
| --- | --- | --- |
| `external-daemon` | `codex app-server daemon start` succeeds, or `--no-start-app-server` is used. | A local `codex app-server proxy` process. The external daemon remains owned by Codex CLI. |
| `managed-child` | The managed standalone daemon is unavailable and auto-start is enabled. | A child `codex app-server --listen stdio://` process. |

While running, the daemon reads the initial App Server thread list, refreshes the App Server snapshot on the configured interval, applies App Server notifications, marks agents stale after disconnects, and attempts reconnects when needed. On shutdown, it stops only the processes it started.

## Web UI

The built-in UI is intentionally operational rather than decorative. It is useful for quickly checking what Codex is doing in the local environment.

It includes:

- App Server connection line with mode, CLI version, daemon version, last load time, and refresh state.
- Summary counters for total, working, idle, finished, approval-waiting, input-waiting, error, and unknown agents.
- Filterable table by status, kind, active time window, working directory, or free-text search.
- Parent rows with collapsed sub-agent groups by default when Codex exposes a parent thread link.
- Stale badges when App Server connectivity is lost long enough to exceed `--stale-after-ms`.
- Expandable per-agent JSON details for debugging raw status and timestamps.

The UI polls `/health` and `/status` every three seconds when auto-refresh is enabled.

## HTTP API

All endpoints are local HTTP `GET` routes.

| Route | Response |
| --- | --- |
| `GET /ui` | Web dashboard HTML. |
| `GET /ui/` | Web dashboard HTML. |
| `GET /health` | Daemon and App Server health snapshot. |
| `GET /status` | Full status snapshot with summary and agents. |
| `GET /agents` | Agent list. Supports `status`, `kind`, `cwd`, and `activeWithinMs` filters. |
| `GET /agents/:id` | Single agent by thread ID. |
| `GET /events` | Server-Sent Events stream for `agent.updated`. |

Filter examples:

```bash
curl "http://127.0.0.1:17345/agents?status=waiting_approval"
curl "http://127.0.0.1:17345/agents?kind=sub_agent"
curl "http://127.0.0.1:17345/agents?cwd=/home/wh/my_project/codex_status"
curl "http://127.0.0.1:17345/agents?status=working&activeWithinMs=1800000"
```

`activeWithinMs` filters agents whose latest App Server activity is within the provided millisecond window. Activity time is computed from the newest of `updatedAt`, `lastTurn.startedAt`, and `lastTurn.completedAt`; it intentionally does not use `lastEventAt`, which is local observer timing.

`GET /status` returns this shape:

```json
{
  "generatedAt": 1780000000000,
  "summary": {
    "total": 2,
    "working": 1,
    "idle": 1,
    "finished": 0,
    "waitingApproval": 0,
    "waitingInput": 0,
    "error": 0,
    "unknown": 0
  },
  "agents": []
}
```

`GET /events` streams events like:

```text
event: agent.updated
data: {"type":"agent.updated","agentId":"thread-id","status":"working","at":1780000000000}
```

## Agent Model

Each agent record is derived from one Codex App Server thread.

| Field | Description |
| --- | --- |
| `id` | App Server thread ID. |
| `sessionId` | Codex session ID. |
| `kind` | `main_agent`, `sub_agent`, or `unknown`. |
| `displayName` | Best available name from nickname, role, thread name, preview, or ID. |
| `status` | Public normalized status. |
| `rawStatus` | Latest status evidence. Usually the App Server thread status; `active` can be inferred from in-progress turn or item activity when thread metadata is still `notLoaded`. |
| `cwd` | Working directory for the thread. |
| `preview` | Thread preview text from Codex. |
| `modelProvider` | Model provider reported by Codex. |
| `cliVersion` | Codex CLI version reported by the App Server thread. |
| `createdAt` / `updatedAt` | Thread timestamps normalized to Unix milliseconds. |
| `parentThreadId` | Parent thread ID for sub-agents when Codex exposes it. |
| `agentNickname` / `agentRole` | Sub-agent identity hints when present. |
| `lastTurn` | Last known turn status and timestamps. |
| `waitingSince` | First observed time for approval/input waiting states. |
| `lastEventAt` | Last local update time observed by `codex-status`. |
| `stale` | `true` when App Server is disconnected and the agent has exceeded the stale threshold. |

Current status mapping:

| App Server Signal | Public Status |
| --- | --- |
| `idle` | `idle` |
| `notLoaded` | `unknown` |
| `active` | `working` |
| `active` with `waitingOnApproval` | `waiting_approval` |
| `active` with `waitingOnUserInput` | `waiting_input` |
| Completed turn, or interrupted turn with `completedAt` | `finished` |
| `systemError` or failed turn | `error` |
| Unrecognized payload | `unknown` |

## Development

Run the unit test suite:

```bash
npm test
```

Run the smoke test against a real local Codex App Server-capable CLI:

```bash
npm run smoke:real
```

The smoke test may start or reuse local App Server processes through the same supervisor path as the daemon.

Project layout:

```text
src/
  app-server/      Codex App Server supervisor and JSON-RPC client
  domain/          Thread-to-agent normalization
  http/            JSON/SSE API and UI asset server
  store/           In-memory status store and health snapshots
  ui/              Built-in browser UI
  cli.ts           CLI entrypoint
  config.ts        CLI parsing and defaults
  daemon.ts        Daemon orchestration
tests/             Node test suite
scripts/           Real App Server smoke test
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `codex --version failed` | Confirm Codex CLI is installed and available on `PATH`. |
| HTTP port is busy | Start with `--port <free-port>` or `--port 0` for an ephemeral port. |
| `/health` shows `connected: false` | Inspect `appServer.lastError`; the daemon will retry on `--refresh-interval-ms`. |
| Agents are shown as `stale` | App Server disconnected and no fresh events arrived before `--stale-after-ms`. |
| Agent `rawStatus` is `notLoaded` | App Server has metadata for the thread but no live runtime loaded, and no in-progress turn, item activity, previous live evidence, or fresh status notification has been observed yet. |
| No agents appear | Start or resume Codex work in the same local environment, then refresh `/ui` or query `/status`. |
| `npm run smoke:real` fails | Verify the installed Codex CLI supports `codex app-server` commands. |
