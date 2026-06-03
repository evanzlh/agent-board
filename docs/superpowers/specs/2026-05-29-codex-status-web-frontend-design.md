# AgentBoard Web Frontend Design

Date: 2026-05-29

## Summary

Add a built-in Web frontend to AgentBoard for debugging whether coding-agent status
mapping is accurate. The first provider is Codex, and the current CLI/package name remains
`codex-status`.

The first version is a local read-only debugging tool served by the existing daemon. It
focuses on the current snapshot only: a dense table of agents, the mapped public status,
the raw App Server status, and last-turn fields. It does not retain history, subscribe to
SSE events, or provide any agent control actions.

## Confirmed Product Direction

- Primary audience: a developer debugging AgentBoard and Codex App Server
  status mapping.
- First-version priority: verify whether each agent's mapped status is accurate.
- Time model: current snapshot only.
- First screen: table-first layout.
- Refresh model: automatic polling plus manual refresh.
- Hosting model: served from the same daemon under `/ui`.
- Frontend stack: static HTML, CSS, and JavaScript with no build step and no production
  dependencies.

## Goals

- Serve a local browser UI from `node src/cli.ts daemon`.
- Show daemon and App Server health without requiring separate API calls from the user.
- Show status summary counts for quick sanity checks.
- Show all agents in a dense table optimized for debugging mapping correctness.
- Let the user filter the current snapshot by status, kind, cwd, and free-text search.
- Let the user expand a row to inspect the full agent JSON.
- Poll `/status` and `/health` automatically, while also supporting a manual Refresh
  button.
- Preserve the expanded row across refreshes when the agent id still exists.
- Keep the service read-only.

## Non-Goals

- No SSE usage in the first Web frontend version.
- No event history or cross-refresh history retention.
- No local storage persistence.
- No agent start, stop, resume, approve, reject, fork, archive, or mutation actions.
- No separate frontend dev server.
- No React, Vite, bundler, or CSS framework.
- No new status inference in the browser. Status mapping remains owned by the backend.

## Architecture

The existing `HttpApi` continues to serve JSON endpoints and gains static UI routes:

- `GET /ui` returns the Web UI HTML.
- `GET /ui/` returns the same Web UI HTML.
- `GET /ui/app.js` returns the frontend JavaScript.
- `GET /ui/styles.css` returns the frontend CSS.

The UI assets live in a small static directory in the repository, for example:

- `src/ui/index.html`
- `src/ui/app.js`
- `src/ui/styles.css`

The static file handler should be narrow and explicit. It should only serve known UI
assets and must not expose arbitrary filesystem paths. Existing API routes such as
`/health`, `/status`, `/agents`, `/agents/:id`, and `/events` keep their current behavior.

Because the UI is same-origin with the API, the frontend can call relative URLs such as
`/status` and `/health`. No CORS handling or API base URL configuration is required for
the first version.

## Page Structure

The UI is a quiet, dense debugging interface rather than a marketing page or big-screen
operations display.

### Health Bar

The top bar shows:

- App Server connection state: connected or disconnected.
- App Server mode.
- Codex CLI version.
- Daemon version if available through `/health`.
- Last successful refresh time.
- Last request error, if any.
- Auto-refresh state.
- Refresh button.

When `/health` reports App Server disconnected, the page should still show the last
successful status snapshot if one exists. The disconnected state and stale rows should be
visually clear.

### Summary

The summary area shows compact count blocks:

- total
- working
- idle
- waiting_approval
- waiting_input
- error
- unknown

These values come directly from `/status.summary`. The browser should not recompute the
summary as the canonical value, although filtered table counts may be displayed
separately if useful.

### Filters

The filter row includes:

- Status selector: all, idle, working, finished, waiting_approval, waiting_input, error,
  unknown.
- Kind selector: all, main_agent, sub_agent, unknown.
- Cwd text filter.
- Search input matching id, displayName, preview, and cwd.

Filtering is client-side and applies to the latest snapshot only. Sorting uses the backend
order from `/status.agents`, which is currently `updatedAt` descending with id as the
tie-breaker.

### Agent Table

The main table columns are:

- status
- kind
- displayName
- rawStatus
- lastTurn.status
- waitingSince
- updatedAt
- cwd
- id

The table should be usable with hundreds of rows. Text that can become long, such as cwd,
id, preview, and raw JSON snippets, should truncate in the table and remain available in
the expanded detail.

### Expanded Detail

Clicking a row expands a detail panel for that agent. The detail panel shows the full
agent JSON formatted for inspection.

The expanded detail is read-only. It is used to compare:

- mapped `status`
- `rawStatus`
- `lastTurn`
- `waitingSince`
- `lastEventAt`
- `stale`

When refresh data arrives, the UI preserves `expandedAgentId` and updates the expanded
JSON if that agent still exists. If the agent no longer exists, the expanded panel closes.

## Data Flow

On page load, the browser fetches both:

- `GET /health`
- `GET /status`

The requests can run in parallel. The page renders partial data if one succeeds and the
other fails.

After initial load, the page polls both endpoints every 3 seconds by default. The Refresh
button triggers the same load immediately. Auto-refresh is enabled by default and can be
paused from the page.

The frontend state is intentionally small:

- `agents`
- `summary`
- `health`
- `filters`
- `expandedAgentId`
- `autoRefreshEnabled`
- `lastLoadedAt`
- `lastError`

The browser does not maintain a history array, event log, or previous snapshots.

## Error Handling

If `/status` or `/health` fails:

- Preserve the last successful data for the endpoint that failed.
- Show an error message in the health bar with the failure time.
- Keep automatic polling active if auto-refresh is enabled.
- Clear the visible request error after a later successful refresh.

If no status snapshot has ever loaded, the table should show an empty/error state rather
than a blank page.

If an agent field is null, missing, or an unknown shape, rendering should degrade to a
plain placeholder such as `-` or JSON text. The frontend should not throw because of an
unexpected status object.

## Testing

### Backend Route Tests

Add or extend HTTP API tests for:

- `GET /ui` returns HTML.
- `GET /ui/` returns HTML.
- `GET /ui/app.js` returns JavaScript with the expected content type.
- `GET /ui/styles.css` returns CSS with the expected content type.
- Unknown `/ui/...` paths return a clear 404.
- Existing JSON API endpoints still behave as before.

### Frontend Function Tests

Keep frontend logic testable without a browser by isolating small pure functions where it
does not add unnecessary complexity:

- Agent filtering by status, kind, cwd, and search.
- Date/time formatting.
- Safe stringification of `rawStatus` and full agent JSON.
- Null and unknown field fallbacks.

### Manual/Browser Verification

Before claiming the UI is complete, run the daemon locally and verify:

- `/ui` renders a nonblank page.
- `/status` data appears in the table.
- Summary counts render.
- Status, kind, cwd, and search filters work.
- Manual Refresh works.
- Auto-refresh updates the page without duplicating rows.
- Row expansion shows full JSON and survives refresh when the id remains present.
- Desktop and narrow viewport layouts do not overlap or hide essential controls.

## Acceptance Criteria

- Starting `node src/cli.ts daemon` exposes `/ui` on the same host and port as the JSON
  API.
- The first screen is a table-first debugging view of the current agent snapshot.
- The UI can be used to compare mapped status, raw status, and last-turn status for each
  agent.
- The UI automatically polls current data and also supports manual refresh.
- The UI remains read-only.
- The default test suite covers the new route behavior and focused frontend helpers.
- No production dependency or build step is introduced.
