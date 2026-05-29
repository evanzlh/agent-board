# Codex Status Web Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in, read-only Web frontend under `/ui` for debugging current Codex agent status mapping.

**Architecture:** The existing `HttpApi` serves a narrow allowlist of static UI assets from `src/ui`. The browser app is plain HTML, CSS, and ES modules. It polls same-origin `/health` and `/status`, renders a dense table, applies client-side filters, and expands rows to show full agent JSON.

**Tech Stack:** Node 22 built-in TypeScript stripping, `node:test`, plain browser JavaScript ES modules, static CSS, no production dependencies, no build step.

---

## File Structure

- Modify `src/http/api.ts`: add explicit `/ui` static asset routes while preserving existing JSON and SSE routes.
- Create `src/ui/index.html`: HTML shell with health bar, summary, filters, table, and detail targets.
- Create `src/ui/styles.css`: compact operational styling for the debugging UI.
- Create `src/ui/view-model.js`: pure frontend helpers used by both the browser app and Node tests.
- Create `src/ui/app.js`: browser orchestration, polling, rendering, filters, and row expansion.
- Modify `tests/http/api.test.ts`: route tests for `/ui` static assets and unknown UI paths.
- Create `tests/ui/view-model.test.ts`: pure function tests for filtering, formatting, and JSON stringification.
- Modify `README.md`: document how to open the Web UI.

---

### Task 1: Serve Static UI Assets From `HttpApi`

**Files:**
- Modify: `src/http/api.ts`
- Modify: `tests/http/api.test.ts`
- Create: `src/ui/index.html`
- Create: `src/ui/app.js`
- Create: `src/ui/styles.css`
- Create: `src/ui/view-model.js`

- [ ] **Step 1: Write failing route tests**

Append these tests to `tests/http/api.test.ts`:

```ts
test("GET /ui serves the Web frontend HTML", async () => {
  await withServer(async (baseUrl) => {
    const bare = await fetch(`${baseUrl}/ui`);
    assert.equal(bare.status, 200);
    assert.equal(bare.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await bare.text(), /<title>Codex Status<\/title>/);

    const slash = await fetch(`${baseUrl}/ui/`);
    assert.equal(slash.status, 200);
    assert.equal(slash.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await slash.text(), /id="agent-table-body"/);
  });
});

test("GET /ui static assets use explicit content types", async () => {
  await withServer(async (baseUrl) => {
    const scripts = [
      { path: "/ui/app.js", contentType: "text/javascript; charset=utf-8" },
      { path: "/ui/view-model.js", contentType: "text/javascript; charset=utf-8" },
      { path: "/ui/styles.css", contentType: "text/css; charset=utf-8" },
    ];

    for (const asset of scripts) {
      const response = await fetch(`${baseUrl}${asset.path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), asset.contentType);
      assert.ok((await response.text()).length > 0);
    }
  });
});

test("unknown /ui asset returns JSON 404", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ui/missing.js`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  });
});
```

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: FAIL because `/ui`, `/ui/`, `/ui/app.js`, `/ui/view-model.js`, and `/ui/styles.css` are not served yet.

- [ ] **Step 3: Create minimal UI asset files**

Create `src/ui/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Codex Status</title>
    <link rel="stylesheet" href="/ui/styles.css">
  </head>
  <body>
    <main class="app-shell">
      <header class="health-bar">
        <div>
          <h1>Codex Status</h1>
          <p id="health-line">Loading...</p>
        </div>
        <button id="refresh-button" type="button">Refresh</button>
      </header>
      <section id="summary" class="summary-grid" aria-label="Status summary"></section>
      <section class="filters" aria-label="Agent filters"></section>
      <section class="table-wrap" aria-label="Agents">
        <table>
          <tbody id="agent-table-body"></tbody>
        </table>
      </section>
    </main>
    <script type="module" src="/ui/app.js"></script>
  </body>
</html>
```

Create `src/ui/app.js`:

```js
import { EMPTY_VALUE } from "/ui/view-model.js";

document.getElementById("health-line").textContent = `Ready ${EMPTY_VALUE}`;
```

Create `src/ui/view-model.js`:

```js
export const EMPTY_VALUE = "-";
```

Create `src/ui/styles.css`:

```css
:root {
  color: #1f2933;
  background: #f5f7f9;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
}

.app-shell {
  min-height: 100vh;
}
```

- [ ] **Step 4: Implement the static asset allowlist**

Modify the top of `src/http/api.ts`:

```ts
import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
```

Add this type and asset map after `export type HttpApi`:

```ts
type UiAsset = {
  path: string;
  contentType: string;
};

const UI_INDEX_PATH = fileURLToPath(new URL("../ui/index.html", import.meta.url));
const UI_APP_PATH = fileURLToPath(new URL("../ui/app.js", import.meta.url));
const UI_VIEW_MODEL_PATH = fileURLToPath(new URL("../ui/view-model.js", import.meta.url));
const UI_STYLES_PATH = fileURLToPath(new URL("../ui/styles.css", import.meta.url));

const UI_ASSETS = new Map<string, UiAsset>([
  ["/ui", { path: UI_INDEX_PATH, contentType: "text/html; charset=utf-8" }],
  ["/ui/", { path: UI_INDEX_PATH, contentType: "text/html; charset=utf-8" }],
  ["/ui/app.js", { path: UI_APP_PATH, contentType: "text/javascript; charset=utf-8" }],
  [
    "/ui/view-model.js",
    { path: UI_VIEW_MODEL_PATH, contentType: "text/javascript; charset=utf-8" },
  ],
  ["/ui/styles.css", { path: UI_STYLES_PATH, contentType: "text/css; charset=utf-8" }],
]);
```

In `handleRequest`, immediately after the non-GET check, add:

```ts
  if (await sendUiAsset(url.pathname, response)) {
    return;
  }
```

Add this helper above `parseFilters`:

```ts
async function sendUiAsset(pathname: string, response: http.ServerResponse): Promise<boolean> {
  const asset = UI_ASSETS.get(pathname);
  if (!asset) {
    return false;
  }

  try {
    const body = await readFile(asset.path);
    response.writeHead(200, {
      "content-type": asset.contentType,
      "cache-control": "no-cache",
    });
    response.end(body);
  } catch (error) {
    sendJson(response, 500, {
      error: "ui_asset_unavailable",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}
```

- [ ] **Step 5: Run route tests and verify they pass**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: PASS for all HTTP API tests.

- [ ] **Step 6: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS for the full suite.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/http/api.ts src/ui/index.html src/ui/app.js src/ui/view-model.js src/ui/styles.css tests/http/api.test.ts
git commit -m "feat: serve web frontend assets"
```

---

### Task 2: Add Tested Frontend View-Model Helpers

**Files:**
- Modify: `src/ui/view-model.js`
- Create: `tests/ui/view-model.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/ui/view-model.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_VALUE,
  compactJson,
  filterAgents,
  formatTimestamp,
  safeJson,
  valueOrEmpty,
} from "../../src/ui/view-model.js";

const baseAgent = {
  id: "agent-main",
  kind: "main_agent",
  displayName: "Main Agent",
  status: "idle",
  rawStatus: { type: "idle" },
  cwd: "/repo/main",
  preview: "Implement status dashboard",
  updatedAt: 1780010100000,
  waitingSince: null,
  lastTurn: { status: "completed", startedAt: 1780010000000, completedAt: 1780010050000 },
};

test("filterAgents filters by status kind cwd and search", () => {
  const agents = [
    baseAgent,
    {
      ...baseAgent,
      id: "agent-sub",
      kind: "sub_agent",
      displayName: "Review Worker",
      status: "working",
      cwd: "/repo/sub",
      preview: "Check raw status mapping",
      rawStatus: { type: "active", activeFlags: [] },
      lastTurn: { status: "inProgress", startedAt: 1780010200000, completedAt: null },
    },
  ];

  assert.deepEqual(
    filterAgents(agents, {
      status: "working",
      kind: "sub_agent",
      cwd: "sub",
      search: "raw status",
    }).map((agent) => agent.id),
    ["agent-sub"],
  );
});

test("filterAgents treats all and empty filters as no filter", () => {
  const agents = [baseAgent];

  assert.deepEqual(
    filterAgents(agents, {
      status: "all",
      kind: "all",
      cwd: "",
      search: "",
    }).map((agent) => agent.id),
    ["agent-main"],
  );
});

test("formatTimestamp renders numbers and falls back for nullish values", () => {
  assert.equal(formatTimestamp(null), EMPTY_VALUE);
  assert.equal(formatTimestamp(undefined), EMPTY_VALUE);
  assert.match(formatTimestamp(1780010100000), /2026/);
});

test("safeJson and compactJson render unknown values safely", () => {
  assert.equal(safeJson(undefined), EMPTY_VALUE);
  assert.equal(compactJson(null), "null");
  assert.equal(compactJson({ type: "active", activeFlags: [] }), "{\"type\":\"active\",\"activeFlags\":[]}");
});

test("valueOrEmpty trims strings and handles missing values", () => {
  assert.equal(valueOrEmpty("  cwd  "), "cwd");
  assert.equal(valueOrEmpty(""), EMPTY_VALUE);
  assert.equal(valueOrEmpty(null), EMPTY_VALUE);
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
node --test tests/ui/view-model.test.ts
```

Expected: FAIL because `compactJson`, `filterAgents`, `formatTimestamp`, `safeJson`, and `valueOrEmpty` are not implemented yet.

- [ ] **Step 3: Implement helper functions**

Replace `src/ui/view-model.js` with:

```js
export const EMPTY_VALUE = "-";

export function filterAgents(agents, filters = {}) {
  const status = normalizeFilter(filters.status);
  const kind = normalizeFilter(filters.kind);
  const cwd = normalizeSearch(filters.cwd);
  const search = normalizeSearch(filters.search);

  return agents.filter((agent) => {
    if (status !== "all" && agent.status !== status) {
      return false;
    }
    if (kind !== "all" && agent.kind !== kind) {
      return false;
    }
    if (cwd && !String(agent.cwd ?? "").toLowerCase().includes(cwd)) {
      return false;
    }
    if (search && !agentSearchText(agent).includes(search)) {
      return false;
    }
    return true;
  });
}

export function formatTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }
  return new Date(value).toLocaleString();
}

export function valueOrEmpty(value) {
  if (value === null || value === undefined) {
    return EMPTY_VALUE;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : EMPTY_VALUE;
}

export function compactJson(value) {
  if (value === undefined) {
    return EMPTY_VALUE;
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? EMPTY_VALUE : json;
  } catch (error) {
    return `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

export function safeJson(value) {
  if (value === undefined) {
    return EMPTY_VALUE;
  }
  try {
    const json = JSON.stringify(value, null, 2);
    return json === undefined ? EMPTY_VALUE : json;
  } catch (error) {
    return `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function normalizeFilter(value) {
  return value && value !== "all" ? String(value) : "all";
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function agentSearchText(agent) {
  return [
    agent.id,
    agent.displayName,
    agent.preview,
    agent.cwd,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join("\n");
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
node --test tests/ui/view-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS for the full suite.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/ui/view-model.js tests/ui/view-model.test.ts
git commit -m "test: cover frontend view model helpers"
```

---

### Task 3: Build the HTML Shell and Debugging Layout

**Files:**
- Modify: `src/ui/index.html`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Replace the HTML shell**

Replace `src/ui/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Codex Status</title>
    <link rel="stylesheet" href="/ui/styles.css">
  </head>
  <body>
    <main class="app-shell">
      <header class="topbar">
        <div class="topbar__identity">
          <h1>Codex Status</h1>
          <p id="health-line" class="muted">Loading health...</p>
        </div>
        <div class="topbar__actions">
          <label class="toggle">
            <input id="auto-refresh" type="checkbox" checked>
            <span>Auto refresh</span>
          </label>
          <button id="refresh-button" class="button" type="button">Refresh</button>
        </div>
      </header>

      <section id="error-banner" class="error-banner" hidden></section>

      <section id="summary" class="summary-grid" aria-label="Status summary"></section>

      <section class="filters" aria-label="Agent filters">
        <label>
          <span>Status</span>
          <select id="status-filter">
            <option value="all">all</option>
            <option value="idle">idle</option>
            <option value="working">working</option>
            <option value="finished">finished</option>
            <option value="waiting_approval">waiting_approval</option>
            <option value="waiting_input">waiting_input</option>
            <option value="error">error</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
        <label>
          <span>Kind</span>
          <select id="kind-filter">
            <option value="all">all</option>
            <option value="main_agent">main_agent</option>
            <option value="sub_agent">sub_agent</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
        <label>
          <span>Cwd</span>
          <input id="cwd-filter" type="search" placeholder="/workspace">
        </label>
        <label>
          <span>Search</span>
          <input id="search-filter" type="search" placeholder="id, name, preview, cwd">
        </label>
      </section>

      <section class="table-panel" aria-label="Agents">
        <div class="table-meta">
          <strong id="visible-count">0 agents</strong>
          <span id="generated-at" class="muted">No snapshot loaded</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Kind</th>
                <th>Name</th>
                <th>rawStatus</th>
                <th>lastTurn</th>
                <th>waitingSince</th>
                <th>updatedAt</th>
                <th>cwd</th>
                <th>id</th>
              </tr>
            </thead>
            <tbody id="agent-table-body">
              <tr>
                <td class="empty-state" colspan="9">Loading agents...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>

    <script type="module" src="/ui/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Replace the CSS**

Replace `src/ui/styles.css` with:

```css
:root {
  color: #1f2933;
  background: #eef2f5;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
select {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  padding: 16px;
}

.topbar,
.filters,
.table-panel,
.error-banner {
  border: 1px solid #cfd8e3;
  border-radius: 8px;
  background: #ffffff;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
}

.topbar h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0;
}

.topbar p {
  margin: 4px 0 0;
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #405261;
}

.button {
  min-height: 34px;
  border: 1px solid #9aa9b8;
  border-radius: 6px;
  background: #26384a;
  color: #ffffff;
  padding: 0 12px;
  cursor: pointer;
}

.button:hover {
  background: #1c2a38;
}

.muted {
  color: #637487;
}

.error-banner {
  margin-top: 12px;
  padding: 10px 12px;
  color: #8f241f;
  background: #fff3f1;
  border-color: #e0aaa5;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(110px, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.summary-card {
  border: 1px solid #cfd8e3;
  border-radius: 8px;
  background: #ffffff;
  padding: 10px 12px;
}

.summary-card span {
  display: block;
  color: #637487;
  font-size: 12px;
}

.summary-card strong {
  display: block;
  margin-top: 4px;
  font-size: 22px;
  letter-spacing: 0;
}

.filters {
  display: grid;
  grid-template-columns: minmax(130px, 0.7fr) minmax(150px, 0.8fr) minmax(180px, 1fr) minmax(220px, 1.4fr);
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
}

.filters label {
  display: grid;
  gap: 5px;
}

.filters span {
  color: #405261;
  font-size: 12px;
}

.filters input,
.filters select {
  width: 100%;
  min-height: 34px;
  border: 1px solid #b8c3cf;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2933;
  padding: 0 9px;
}

.table-panel {
  margin-top: 12px;
  overflow: hidden;
}

.table-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #dbe2ea;
}

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

th,
td {
  border-bottom: 1px solid #e4e9ef;
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f7f9fb;
  color: #405261;
  font-size: 12px;
  font-weight: 700;
}

td {
  color: #26384a;
}

tbody tr.agent-row {
  cursor: pointer;
}

tbody tr.agent-row:hover {
  background: #f6f9fc;
}

tbody tr.is-expanded {
  background: #eef6ff;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  max-width: 100%;
  border-radius: 999px;
  padding: 2px 8px;
  color: #0f3d5e;
  background: #dff0ff;
  font-size: 12px;
  font-weight: 700;
}

.status-pill[data-status="working"] {
  color: #553800;
  background: #ffedbf;
}

.status-pill[data-status="waiting_approval"],
.status-pill[data-status="waiting_input"] {
  color: #733300;
  background: #ffe0c2;
}

.status-pill[data-status="error"] {
  color: #7b211c;
  background: #ffd7d2;
}

.status-pill[data-status="unknown"] {
  color: #4d5863;
  background: #e2e8ef;
}

.cell-truncate {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.json-inline {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.detail-row td {
  background: #f8fbff;
}

.detail-json {
  max-height: 360px;
  margin: 0;
  overflow: auto;
  border: 1px solid #cfd8e3;
  border-radius: 6px;
  background: #18202b;
  color: #dbe8f5;
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}

.empty-state {
  padding: 32px;
  color: #637487;
  text-align: center;
}

@media (max-width: 920px) {
  .app-shell {
    padding: 10px;
  }

  .topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .topbar__actions {
    width: 100%;
    justify-content: space-between;
  }

  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filters {
    grid-template-columns: 1fr;
  }

  table {
    min-width: 1120px;
  }
}
```

- [ ] **Step 3: Run route tests**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add src/ui/index.html src/ui/styles.css
git commit -m "feat: add web frontend layout"
```

---

### Task 4: Implement Polling, Filtering, Table Rendering, and Row Expansion

**Files:**
- Modify: `src/ui/app.js`

- [ ] **Step 1: Replace `src/ui/app.js` with the browser app**

Replace `src/ui/app.js` with:

```js
import {
  EMPTY_VALUE,
  compactJson,
  filterAgents,
  formatTimestamp,
  safeJson,
  valueOrEmpty,
} from "/ui/view-model.js";

const REFRESH_INTERVAL_MS = 3000;

const state = {
  agents: [],
  summary: null,
  health: null,
  filters: {
    status: "all",
    kind: "all",
    cwd: "",
    search: "",
  },
  expandedAgentId: null,
  autoRefreshEnabled: true,
  lastLoadedAt: null,
  lastError: null,
  generatedAt: null,
};

const elements = {
  healthLine: document.getElementById("health-line"),
  errorBanner: document.getElementById("error-banner"),
  summary: document.getElementById("summary"),
  tableBody: document.getElementById("agent-table-body"),
  visibleCount: document.getElementById("visible-count"),
  generatedAt: document.getElementById("generated-at"),
  statusFilter: document.getElementById("status-filter"),
  kindFilter: document.getElementById("kind-filter"),
  cwdFilter: document.getElementById("cwd-filter"),
  searchFilter: document.getElementById("search-filter"),
  autoRefresh: document.getElementById("auto-refresh"),
  refreshButton: document.getElementById("refresh-button"),
};

wireControls();
render();
void loadSnapshot();
setInterval(() => {
  if (state.autoRefreshEnabled) {
    void loadSnapshot();
  }
}, REFRESH_INTERVAL_MS);

function wireControls() {
  elements.refreshButton.addEventListener("click", () => {
    void loadSnapshot();
  });
  elements.autoRefresh.addEventListener("change", () => {
    state.autoRefreshEnabled = elements.autoRefresh.checked;
    renderHealth();
  });
  elements.statusFilter.addEventListener("change", () => {
    state.filters.status = elements.statusFilter.value;
    renderTable();
  });
  elements.kindFilter.addEventListener("change", () => {
    state.filters.kind = elements.kindFilter.value;
    renderTable();
  });
  elements.cwdFilter.addEventListener("input", () => {
    state.filters.cwd = elements.cwdFilter.value;
    renderTable();
  });
  elements.searchFilter.addEventListener("input", () => {
    state.filters.search = elements.searchFilter.value;
    renderTable();
  });
}

async function loadSnapshot() {
  elements.refreshButton.disabled = true;
  try {
    const [healthResult, statusResult] = await Promise.allSettled([
      fetchJson("/health"),
      fetchJson("/status"),
    ]);

    const errors = [];
    if (healthResult.status === "fulfilled") {
      state.health = healthResult.value;
    } else {
      errors.push(`health: ${readError(healthResult.reason)}`);
    }

    if (statusResult.status === "fulfilled") {
      state.summary = statusResult.value.summary ?? null;
      state.agents = Array.isArray(statusResult.value.agents) ? statusResult.value.agents : [];
      state.generatedAt = statusResult.value.generatedAt ?? null;
      if (state.expandedAgentId && !state.agents.some((agent) => agent.id === state.expandedAgentId)) {
        state.expandedAgentId = null;
      }
    } else {
      errors.push(`status: ${readError(statusResult.reason)}`);
    }

    state.lastLoadedAt = Date.now();
    state.lastError = errors.length > 0 ? errors.join("; ") : null;
  } finally {
    elements.refreshButton.disabled = false;
    render();
  }
}

async function fetchJson(path) {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return await response.json();
}

function render() {
  renderHealth();
  renderError();
  renderSummary();
  renderTable();
}

function renderHealth() {
  const appServer = state.health?.appServer;
  const daemon = state.health?.daemon;
  const connected = appServer?.connected ? "connected" : "disconnected";
  const mode = valueOrEmpty(appServer?.mode);
  const cliVersion = valueOrEmpty(appServer?.cliVersion);
  const daemonVersion = valueOrEmpty(daemon?.version);
  const loaded = state.lastLoadedAt ? formatTimestamp(state.lastLoadedAt) : EMPTY_VALUE;
  const refresh = state.autoRefreshEnabled ? "auto 3s" : "paused";
  elements.healthLine.textContent = `${connected} · mode ${mode} · cli ${cliVersion} · daemon ${daemonVersion} · loaded ${loaded} · ${refresh}`;
}

function renderError() {
  const healthError = state.health?.appServer?.lastError;
  const errors = [state.lastError, healthError].filter(Boolean);
  if (errors.length === 0) {
    elements.errorBanner.hidden = true;
    elements.errorBanner.textContent = "";
    return;
  }
  elements.errorBanner.hidden = false;
  elements.errorBanner.textContent = errors.join(" · ");
}

function renderSummary() {
  const summary = state.summary ?? {};
  const items = [
    ["total", summary.total],
    ["working", summary.working],
    ["idle", summary.idle],
    ["waiting_approval", summary.waitingApproval],
    ["waiting_input", summary.waitingInput],
    ["error", summary.error],
    ["unknown", summary.unknown],
  ];

  elements.summary.replaceChildren(
    ...items.map(([label, value]) => {
      const card = document.createElement("article");
      card.className = "summary-card";
      const labelElement = document.createElement("span");
      labelElement.textContent = label;
      const valueElement = document.createElement("strong");
      valueElement.textContent = String(value ?? 0);
      card.append(labelElement, valueElement);
      return card;
    }),
  );
}

function renderTable() {
  const visibleAgents = filterAgents(state.agents, state.filters);
  elements.visibleCount.textContent = `${visibleAgents.length} agent${visibleAgents.length === 1 ? "" : "s"}`;
  elements.generatedAt.textContent = state.generatedAt
    ? `snapshot ${formatTimestamp(state.generatedAt)}`
    : "No snapshot loaded";

  if (visibleAgents.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-state";
    cell.colSpan = 9;
    cell.textContent = state.agents.length === 0 ? "No agents loaded." : "No agents match the filters.";
    row.append(cell);
    elements.tableBody.replaceChildren(row);
    return;
  }

  const rows = [];
  for (const agent of visibleAgents) {
    rows.push(renderAgentRow(agent));
    if (agent.id === state.expandedAgentId) {
      rows.push(renderDetailRow(agent));
    }
  }
  elements.tableBody.replaceChildren(...rows);
}

function renderAgentRow(agent) {
  const row = document.createElement("tr");
  row.className = "agent-row";
  if (agent.id === state.expandedAgentId) {
    row.classList.add("is-expanded");
  }
  row.addEventListener("click", () => {
    state.expandedAgentId = state.expandedAgentId === agent.id ? null : agent.id;
    renderTable();
  });

  row.append(
    cell(renderStatus(agent.status)),
    textCell(agent.kind),
    textCell(agent.displayName),
    textCell(compactJson(agent.rawStatus), "json-inline"),
    textCell(agent.lastTurn?.status),
    textCell(formatTimestamp(agent.waitingSince)),
    textCell(formatTimestamp(agent.updatedAt)),
    textCell(agent.cwd),
    textCell(agent.id, "json-inline"),
  );
  return row;
}

function renderDetailRow(agent) {
  const row = document.createElement("tr");
  row.className = "detail-row";
  const detail = document.createElement("td");
  detail.colSpan = 9;
  const pre = document.createElement("pre");
  pre.className = "detail-json";
  pre.textContent = safeJson(agent);
  detail.append(pre);
  row.append(detail);
  return row;
}

function renderStatus(status) {
  const pill = document.createElement("span");
  pill.className = "status-pill";
  pill.dataset.status = valueOrEmpty(status);
  pill.textContent = valueOrEmpty(status);
  return pill;
}

function textCell(value, extraClass = "") {
  const span = document.createElement("span");
  span.className = `cell-truncate ${extraClass}`.trim();
  span.textContent = valueOrEmpty(value);
  span.title = span.textContent;
  return cell(span);
}

function cell(child) {
  const td = document.createElement("td");
  td.append(child);
  return td;
}

function readError(error) {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 2: Run helper and route tests**

Run:

```bash
node --test tests/ui/view-model.test.ts tests/http/api.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS for the full suite.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
git add src/ui/app.js
git commit -m "feat: render agent status web UI"
```

---

### Task 5: Document and Verify the Web UI

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the Web UI**

In `README.md`, after the custom port example, add:

````md
Open the built-in Web UI from the same daemon:

```bash
node src/cli.ts daemon
```

Then visit:

```text
http://127.0.0.1:17345/ui
```

The UI is read-only. It shows the current status snapshot, filters agents locally, and
polls `/health` and `/status` every few seconds.
````

- [ ] **Step 2: Run the full automated test suite**

Run:

```bash
npm test
```

Expected: PASS for the full suite.

- [ ] **Step 3: Start the daemon on a fixed local port for browser verification**

Run:

```bash
node src/cli.ts daemon --port 17346
```

Expected output:

```text
codex-status listening at http://127.0.0.1:17346
```

Keep this process running until Step 5 is complete.

- [ ] **Step 4: Verify the page with Playwright**

Run:

```bash
playwright-cli open http://127.0.0.1:17346/ui
```

Then run:

```bash
playwright-cli run-code "async page => {
  await page.waitForSelector('#agent-table-body tr');
  const desktop = await page.evaluate(() => ({
    title: document.title,
    health: document.querySelector('#health-line')?.textContent,
    summaryCards: document.querySelectorAll('.summary-card').length,
    rows: document.querySelectorAll('#agent-table-body tr').length,
    bodyText: document.body.innerText,
  }));
  await page.locator('#status-filter').selectOption('idle');
  await page.locator('#search-filter').fill('/home');
  await page.locator('#refresh-button').click();
  await page.waitForTimeout(500);
  const filteredRows = await page.locator('#agent-table-body tr').count();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobile = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    return {
      pageOverflows: document.documentElement.scrollWidth > window.innerWidth + 2,
      tableScrolls: wrap ? wrap.scrollWidth > wrap.clientWidth : false,
    };
  });
  return { desktop, filteredRows, mobile };
}"
```

Expected:

- `desktop.title` is `Codex Status`.
- `desktop.summaryCards` is `7`.
- `desktop.rows` is greater than `0` when the local App Server reports agents.
- `desktop.bodyText` contains `Codex Status`.
- `filteredRows` is a number and the command completes without a browser error.
- `mobile.pageOverflows` is `false`.
- `mobile.tableScrolls` is `true` when the table has enough columns to require horizontal scrolling.

- [ ] **Step 5: Stop the daemon**

In the terminal running the daemon, press `Ctrl-C`.

Expected: the daemon exits cleanly.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add README.md
git commit -m "docs: document web frontend"
```

---

## Final Verification

- [ ] Run:

```bash
npm test
```

Expected: PASS.

- [ ] Run:

```bash
npm run smoke:real
```

Expected: PASS when the local `codex` command and App Server are available.

- [ ] Check the working tree:

```bash
git status --short
```

Expected: no unexpected uncommitted changes.

---

## Self-Review Notes

- Spec coverage: `/ui` hosting, table-first snapshot UI, health display, summary, filters, row expansion, polling, manual refresh, read-only behavior, route tests, helper tests, and browser verification are covered.
- Scope control: SSE, event history, browser persistence, agent mutation, frontend frameworks, and build tooling are excluded.
- Type consistency: Browser helpers use plain JavaScript and are imported by both `src/ui/app.js` and `tests/ui/view-model.test.ts`.
