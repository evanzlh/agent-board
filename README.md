<p align="center">
  <img src="docs/assets/agentboard-icon.png" alt="agentBoard icon" width="128" height="128">
</p>

<h1 align="center">agentBoard</h1>

<p align="center">
  Turn local Codex agent activity into a real-time, read-only status cockpit for browsers, scripts, and dashboards.
</p>

<p align="center">
  <img alt="Node.js >=22.18.0" src="https://img.shields.io/badge/node-%3E%3D22.18.0-339933?logo=node.js&logoColor=white">
  <img alt="Codex App Server" src="https://img.shields.io/badge/Codex-App%20Server-111827">
  <img alt="Local only" src="https://img.shields.io/badge/local--only-read--only-06b6d4">
  <img alt="Tests" src="https://img.shields.io/badge/tests-node%20--test-22c55e">
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

`agentBoard` is a local status monitor for Codex agents. It observes Codex App Server state, normalizes Codex threads into agent records, exposes a small JSON/SSE API for dashboards and scripts, and serves a built-in web UI at `/ui`.

> [!IMPORTANT]
> agentBoard currently supports Codex only and observes local Codex state. It does not approve requests, send user input, stop agents, or mutate Codex sessions.

## Why agentBoard

When several Codex sessions, sub-agents, or long-running debugging tasks are active at the same time, terminal windows stop being a useful status surface. It becomes hard to tell what is still working, what is waiting for approval, which session is finished, and whether the App Server connection is healthy.

`agentBoard` adds a local, read-only observation layer for that workflow:

- See all local Codex threads and sub-agents in one place.
- Open a browser dashboard without depending on an external service.
- Feed local scripts, notifications, or custom dashboards with HTTP JSON/SSE.
- Keep raw status evidence visible when debugging Codex App Server behavior.

## Highlights

| Capability | What it gives you |
| --- | --- |
| Live agent inventory | Main agents, sub-agents, parent thread links, and working directories |
| Normalized statuses | `idle`, `working`, `finished`, `waiting_approval`, `waiting_input`, `error`, `unknown` |
| App Server health | Connection state, mode, Codex CLI version, latest error, and refresh timing |
| Built-in Web UI | Table view plus pixel-style Office view, with filters for status, kind, activity, cwd, and search |
| Session viewing | Per-agent `View messages` links rendered with vendored euphony assets |
| Local API | `/status`, `/agents`, `/health`, `/events`, and session endpoints for integrations |

## Quick Start

### Requirements

- Node.js `>=22.18.0`
- `codex` available on `PATH`
- A Codex CLI build with App Server support

No build step is required for the current project layout. Euphony browser library assets are vendored under `src/ui/vendor/euphony`.

### Run

```bash
npm start
```

The daemon listens on `127.0.0.1:17345` by default and prints:

```text
codex-status listening at http://127.0.0.1:17345
```

Open the Web UI:

```text
http://127.0.0.1:17345/ui
```

Query the current snapshot:

```bash
curl http://127.0.0.1:17345/status
curl "http://127.0.0.1:17345/agents?status=working"
```

> [!NOTE]
> The public product name used in the docs is `agentBoard`. The package and CLI bin remain `codex-status`, so startup output and `package.json` still use that name.

## CLI Usage

```bash
node src/cli.ts daemon [options]
```

| Option | Default | Description |
| --- | --- | --- |
| `--host <host>` | `127.0.0.1` | HTTP bind host |
| `--port <port>` | `17345` | HTTP bind port. Use `0` for an ephemeral port |
| `--no-start-app-server` | disabled | Skip App Server auto-start and connect through `codex app-server proxy` only |
| `--refresh-interval-ms <ms>` | `5000` | Snapshot refresh, reconnect, and stale-check cadence |
| `--stale-after-ms <ms>` | `30000` | Mark agents stale after App Server disconnects and no events arrive |

Example:

```bash
node src/cli.ts daemon --host 0.0.0.0 --port 18000 --refresh-interval-ms 2000
```

## Use Cases

- **Monitor parallel Codex work**: identify which local agents are still active.
- **Find approval or input blockers**: filter for `waiting_approval` or `waiting_input`.
- **Inspect sub-agent relationships**: see main agents and sub-agents grouped by parent thread when Codex exposes the link.
- **Power local scripts**: connect notifications, status bars, or dashboards through `/status`, `/agents`, or `/events`.
- **Debug App Server state**: inspect connection mode, latest errors, stale agents, and raw status evidence.

## Web UI

The built-in UI is operational rather than decorative. Start the daemon and open:

```text
http://127.0.0.1:17345/ui
```

It includes:

- App Server connection line with mode, CLI version, daemon version, last load time, and refresh state
- Summary counters for total, working, idle, finished, approval/input waiting, error, and unknown agents
- Filterable table by status, kind, active time window, cwd, or free-text search
- `Table` / `Office` switch, where Office renders filtered agents as pixel-style team pods
- Parent rows with collapsed sub-agent groups by default when Codex exposes a parent thread link
- Stale badges when App Server connectivity is lost long enough to exceed `--stale-after-ms`
- Expandable per-agent JSON details for raw status, timestamps, and debugging fields
- Per-agent `View messages` links that open a session page rendered by euphony

The UI polls `/health` and `/status` every three seconds when auto-refresh is enabled. The Office view uses the same filters as the table; set `Active within` to a recent window such as `30min` or `3h` to keep the scene focused on current activity.

## HTTP API

All endpoints are local HTTP `GET` routes.

| Route | Response |
| --- | --- |
| `GET /ui` | Web dashboard HTML |
| `GET /ui/` | Web dashboard HTML |
| `GET /health` | Daemon and App Server health snapshot |
| `GET /status` | Full status snapshot with summary and agents |
| `GET /agents` | Agent list. Supports `status`, `kind`, `cwd`, and `activeWithinMs` filters |
| `GET /agents/:id` | Single agent by thread ID |
| `GET /agents/:id/session` | Agent metadata and parsed Codex session JSONL events |
| `GET /events` | Server-Sent Events stream for `agent.updated` |

Filter examples:

```bash
curl "http://127.0.0.1:17345/agents?status=waiting_approval"
curl "http://127.0.0.1:17345/agents?kind=sub_agent"
curl "http://127.0.0.1:17345/agents?cwd=/path/to/project"
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
| `id` | App Server thread ID |
| `sessionId` | Codex session ID |
| `kind` | `main_agent`, `sub_agent`, or `unknown` |
| `displayName` | Best available name from nickname, role, thread name, preview, or ID |
| `status` | Public normalized status |
| `rawStatus` | Latest status evidence, usually from App Server thread status |
| `cwd` | Working directory for the thread |
| `preview` | Thread preview text from Codex |
| `modelProvider` | Model provider reported by Codex |
| `cliVersion` | Codex CLI version reported by the App Server thread |
| `createdAt` / `updatedAt` | Thread timestamps normalized to Unix milliseconds |
| `parentThreadId` | Parent thread ID when Codex exposes it |
| `agentNickname` / `agentRole` | Sub-agent identity hints |
| `lastTurn` | Last known turn status and timestamps |
| `waitingSince` | First observed time for approval/input waiting states |
| `lastEventAt` | Last local update time observed by agentBoard |
| `stale` | `true` when App Server is disconnected and the agent has exceeded the stale threshold |

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

## App Server Lifecycle

On startup, agentBoard runs `codex --version`, then connects to Codex App Server using one of two modes:

| Mode | When it is used | Process owned by agentBoard |
| --- | --- | --- |
| `external-daemon` | `codex app-server daemon start` succeeds, or `--no-start-app-server` is used | A local `codex app-server proxy` process. The external daemon remains owned by Codex CLI |
| `managed-child` | The managed standalone daemon is unavailable and auto-start is enabled | A child `codex app-server --listen stdio://` process |

While running, the daemon reads the initial App Server thread list, refreshes the App Server snapshot on the configured interval, applies App Server notifications, marks agents stale after disconnects, and attempts reconnects when needed. On shutdown, it stops only the processes it started.

## Development

Run the unit test suite:

```bash
npm test
```

Run the smoke test against a real local Codex App Server-capable CLI:

```bash
npm run smoke:real
```

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

## Updating Vendored Euphony

agentBoard serves checked-in euphony browser assets from `src/ui/vendor/euphony`. To refresh them from an euphony checkout, pass that checkout path to the update script:

```bash
scripts/update-euphony-vendor.sh /path/to/euphony
```

The script builds euphony with `corepack pnpm run build:library`, replaces the vendored assets, and writes source commit metadata to `src/ui/vendor/euphony/VENDOR.md`. The vendored directory also includes euphony's Apache-2.0 `LICENSE` and `NOTICE` files.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `codex --version failed` | Confirm Codex CLI is installed and available on `PATH` |
| HTTP port is busy | Start with `--port <free-port>` or `--port 0` for an ephemeral port |
| `/health` shows `connected: false` | Inspect `appServer.lastError`; the daemon will retry on `--refresh-interval-ms` |
| Agents are shown as `stale` | App Server disconnected and no fresh events arrived before `--stale-after-ms` |
| Agent `rawStatus` is `notLoaded` | App Server has metadata for the thread but no live runtime, in-progress turn, item activity, previous live evidence, or fresh status notification |
| No agents appear | Start or resume Codex work in the same local environment, then refresh `/ui` or query `/status` |
| `npm run smoke:real` fails | Verify the installed Codex CLI supports `codex app-server` commands |
