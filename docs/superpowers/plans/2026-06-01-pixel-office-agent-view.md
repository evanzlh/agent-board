# Pixel Office Agent View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Table` / `Office` dashboard switch where the Office view renders filtered Codex agents as pixel-style team pods.

**Architecture:** Keep the existing static UI and HTTP API. Add an Office-specific view-model helper in `src/ui/view-model.js`, then render the same filtered agent set either as the existing table or as pure HTML/CSS pixel office pods. Reuse existing state, filters, polling, and `expandedAgentId` selection.

**Tech Stack:** Node 22 test runner, static browser JavaScript modules, pure HTML/CSS, existing `/health` and `/status` endpoints, Playwright CLI for browser verification.

---

## File Structure

- Modify `src/ui/view-model.js`: add `buildOfficePods(agents)` and small helper functions for Office grouping.
- Modify `tests/ui/view-model.test.ts`: add unit tests for Office pod grouping.
- Modify `src/ui/index.html`: add `Table` / `Office` view switch, wrap the existing table section as the table view, and add an Office view container.
- Modify `src/ui/app.js`: add active view state, shared filtered-agent helper, Office rendering functions, and Office detail rendering.
- Modify `src/ui/styles.css`: add segmented view controls, Office pod layout, CSS-built pixel desks/agents, status treatments, and reduced-motion handling.
- Modify `README.md`: mention the Office view and its relationship to filters.

---

### Task 1: Add Office Pod View Model

**Files:**
- Modify: `tests/ui/view-model.test.ts`
- Modify: `src/ui/view-model.js`

- [ ] **Step 1: Write failing tests for Office pod grouping**

In `tests/ui/view-model.test.ts`, update the import block to include `buildOfficePods`:

```ts
import {
  EMPTY_VALUE,
  buildAgentRows,
  buildOfficePods,
  compactJson,
  filterAgents,
  formatTimestamp,
  safeJson,
  valueOrEmpty,
} from "../../src/ui/view-model.js";
```

Add these tests after the existing `buildAgentRows` tests:

```ts
test("buildOfficePods groups visible main agents with their sub agents", () => {
  const parent = {
    ...baseAgent,
    id: "main-1",
    kind: "main_agent",
    displayName: "Main One",
    parentThreadId: null,
  };
  const child = {
    ...baseAgent,
    id: "sub-1",
    kind: "sub_agent",
    displayName: "Sub One",
    parentThreadId: "main-1",
  };
  const otherParent = {
    ...baseAgent,
    id: "main-2",
    kind: "main_agent",
    displayName: "Main Two",
    parentThreadId: null,
  };

  assert.deepEqual(summarizeOfficePods(buildOfficePods([child, parent, otherParent])), [
    { id: "main-1", type: "main", agentId: "main-1", children: ["sub-1"] },
    { id: "main-2", type: "main", agentId: "main-2", children: [] },
  ]);
});

test("buildOfficePods groups visible sub agents without visible parents into an unassigned pod", () => {
  const child = {
    ...baseAgent,
    id: "sub-orphan",
    kind: "sub_agent",
    displayName: "Filtered Sub",
    parentThreadId: "missing-main",
  };
  const parent = {
    ...baseAgent,
    id: "main-visible",
    kind: "main_agent",
    displayName: "Visible Main",
    parentThreadId: null,
  };

  assert.deepEqual(summarizeOfficePods(buildOfficePods([child, parent])), [
    { id: "unassigned-sub-agents", type: "unassigned", agentId: null, children: ["sub-orphan"] },
    { id: "main-visible", type: "main", agentId: "main-visible", children: [] },
  ]);
});

test("buildOfficePods groups rootless unknown agents into an other pod", () => {
  const unknown = {
    ...baseAgent,
    id: "unknown-1",
    kind: "unknown",
    displayName: "Unknown Agent",
    parentThreadId: null,
  };
  const parent = {
    ...baseAgent,
    id: "main-visible",
    kind: "main_agent",
    displayName: "Visible Main",
    parentThreadId: null,
  };

  assert.deepEqual(summarizeOfficePods(buildOfficePods([unknown, parent])), [
    { id: "other-agents", type: "other", agentId: null, children: ["unknown-1"] },
    { id: "main-visible", type: "main", agentId: "main-visible", children: [] },
  ]);
});
```

Add this helper near `summarizeAgentRows`:

```ts
function summarizeOfficePods(pods) {
  return pods.map((pod) => ({
    id: pod.id,
    type: pod.type,
    agentId: pod.agent?.id ?? null,
    children: pod.children.map((agent) => agent.id),
  }));
}
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
node --test tests/ui/view-model.test.ts
```

Expected: fails because `buildOfficePods` is not exported from `src/ui/view-model.js`.

- [ ] **Step 3: Implement `buildOfficePods`**

In `src/ui/view-model.js`, add this exported function after `buildAgentRows`:

```js
export function buildOfficePods(agents) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const childrenByParent = new Map();
  const unassignedSubAgents = [];
  const otherAgents = [];

  for (const agent of agents) {
    const parentId = visibleMainParentId(agent, byId);
    if (!parentId) {
      continue;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(agent);
    childrenByParent.set(parentId, children);
  }

  const pods = [];
  for (const agent of agents) {
    if (agent.kind === "main_agent") {
      pods.push({
        id: agent.id,
        type: "main",
        agent,
        children: childrenByParent.get(agent.id) ?? [],
      });
      continue;
    }

    if (agent.kind === "sub_agent") {
      if (!visibleMainParentId(agent, byId)) {
        unassignedSubAgents.push(agent);
      }
      continue;
    }

    otherAgents.push(agent);
  }

  const groupedPods = [];
  if (unassignedSubAgents.length > 0) {
    groupedPods.push({
      id: "unassigned-sub-agents",
      type: "unassigned",
      agent: null,
      children: unassignedSubAgents,
    });
  }
  if (otherAgents.length > 0) {
    groupedPods.push({
      id: "other-agents",
      type: "other",
      agent: null,
      children: otherAgents,
    });
  }
  groupedPods.push(...pods);

  return groupedPods;
}
```

Add this helper near `visibleParentId`:

```js
function visibleMainParentId(agent, byId) {
  const parentId =
    typeof agent.parentThreadId === "string" && agent.parentThreadId.length > 0
      ? agent.parentThreadId
      : null;
  if (!parentId || parentId === agent.id) {
    return null;
  }
  const parent = byId.get(parentId);
  return parent?.kind === "main_agent" ? parentId : null;
}
```

- [ ] **Step 4: Run the targeted test and verify it passes**

Run:

```bash
node --test tests/ui/view-model.test.ts
```

Expected: all tests in `tests/ui/view-model.test.ts` pass.

- [ ] **Step 5: Commit the view-model work**

Run:

```bash
git add src/ui/view-model.js tests/ui/view-model.test.ts
git commit -m "feat: add office pod view model"
```

---

### Task 2: Add The Table / Office View Shell

**Files:**
- Modify: `tests/http/api.test.ts`
- Modify: `src/ui/index.html`
- Modify: `src/ui/app.js`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Write a failing static UI test**

In `tests/http/api.test.ts`, inside `test("GET /ui serves the Web frontend HTML", ...)`, add these assertions after the existing `assert.match(html, /<title>Codex Status<\/title>/);` line:

```ts
    assert.match(html, /id="table-view-button"/);
    assert.match(html, /id="office-view-button"/);
    assert.match(html, /id="table-view"/);
    assert.match(html, /id="office-view"/);
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: the `GET /ui serves the Web frontend HTML` subtest fails because the new IDs are not present.

- [ ] **Step 3: Add the view switch and Office container**

In `src/ui/index.html`, insert this section after the filters section and before the current table section:

```html
      <section class="view-switch" aria-label="Dashboard view">
        <button id="table-view-button" class="view-switch__button is-active" type="button" aria-pressed="true">
          Table
        </button>
        <button id="office-view-button" class="view-switch__button" type="button" aria-pressed="false">
          Office
        </button>
      </section>
```

Change the existing table section start from:

```html
      <section class="table-panel" aria-label="Agents">
```

to:

```html
      <section id="table-view" class="table-panel view-panel" aria-label="Agents">
```

Add this Office section after the closing `</section>` for the table panel:

```html
      <section id="office-view" class="office-panel view-panel" aria-label="Pixel office" hidden>
        <div class="office-meta">
          <strong id="office-visible-count">0 agents</strong>
          <span id="office-generated-at" class="muted">No snapshot loaded</span>
        </div>
        <div id="office-body" class="office-body">
          <div class="empty-state">Loading agents...</div>
        </div>
        <aside id="office-detail" class="office-detail" hidden></aside>
      </section>
```

- [ ] **Step 4: Wire active view state in JavaScript**

In `src/ui/app.js`, add `activeView: "table",` to `state` after `expandedParentIds`.

Add these elements to the `elements` object:

```js
  tableViewButton: requiredElement("table-view-button"),
  officeViewButton: requiredElement("office-view-button"),
  tableView: requiredElement("table-view"),
  officeView: requiredElement("office-view"),
  officeVisibleCount: requiredElement("office-visible-count"),
  officeGeneratedAt: requiredElement("office-generated-at"),
  officeBody: requiredElement("office-body"),
  officeDetail: requiredElement("office-detail"),
```

Add these listeners in `wireControls()` before the refresh button listener:

```js
  elements.tableViewButton.addEventListener("click", () => {
    state.activeView = "table";
    renderActiveView();
  });
  elements.officeViewButton.addEventListener("click", () => {
    state.activeView = "office";
    renderActiveView();
  });
```

Replace `renderTable();` at the end of `render()` with:

```js
  renderActiveView();
```

Add this function before `renderTable()`:

```js
function renderActiveView() {
  const isOffice = state.activeView === "office";
  elements.tableView.hidden = isOffice;
  elements.officeView.hidden = !isOffice;
  elements.tableViewButton.classList.toggle("is-active", !isOffice);
  elements.officeViewButton.classList.toggle("is-active", isOffice);
  elements.tableViewButton.setAttribute("aria-pressed", String(!isOffice));
  elements.officeViewButton.setAttribute("aria-pressed", String(isOffice));

  if (isOffice) {
    renderOffice();
  } else {
    renderTable();
  }
}

function currentVisibleAgents() {
  return filterAgents(state.agents, state.filters, state.generatedAt ?? Date.now());
}
```

Update each filter listener from `renderTable();` to `renderActiveView();`.

Add a minimal Office renderer after `renderTable()`:

```js
function renderOffice() {
  const visibleAgents = currentVisibleAgents();
  elements.officeVisibleCount.textContent = `${visibleAgents.length} agent${visibleAgents.length === 1 ? "" : "s"}`;
  elements.officeGeneratedAt.textContent = state.generatedAt
    ? `snapshot ${formatTimestamp(state.generatedAt)}`
    : "No snapshot loaded";

  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = visibleAgents.length === 0 ? "No agents match the filters." : "Office view is loading.";
  elements.officeBody.replaceChildren(empty);
  elements.officeDetail.hidden = true;
  elements.officeDetail.replaceChildren();
}
```

Update the first line of `renderTable()` from:

```js
  const visibleAgents = filterAgents(state.agents, state.filters, state.generatedAt ?? Date.now());
```

to:

```js
  const visibleAgents = currentVisibleAgents();
```

- [ ] **Step 5: Add minimal view switch styles**

In `src/ui/styles.css`, add `.view-switch` to the shared panel selector:

```css
.topbar,
.filters,
.view-switch,
.table-panel,
.office-panel,
.error-banner {
```

Add these styles before `.table-panel`:

```css
.view-switch {
  display: inline-flex;
  gap: 4px;
  margin-top: 12px;
  padding: 4px;
}

.view-switch__button {
  min-height: 30px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #405261;
  padding: 0 12px;
  cursor: pointer;
}

.view-switch__button:hover {
  background: #eef4fa;
}

.view-switch__button.is-active {
  border-color: #9aa9b8;
  background: #26384a;
  color: #ffffff;
}

.view-panel[hidden] {
  display: none;
}

.office-panel {
  margin-top: 12px;
  overflow: hidden;
}

.office-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #dbe2ea;
}

.office-body {
  min-height: 220px;
}
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: all tests in `tests/http/api.test.ts` pass.

- [ ] **Step 7: Commit the view shell**

Run:

```bash
git add tests/http/api.test.ts src/ui/index.html src/ui/app.js src/ui/styles.css
git commit -m "feat: add office view switch"
```

---

### Task 3: Render Office Pods And Agent Details

**Files:**
- Modify: `src/ui/app.js`

- [ ] **Step 1: Import `buildOfficePods`**

Update the import from `/ui/view-model.js`:

```js
import {
  EMPTY_VALUE,
  buildAgentRows,
  buildOfficePods,
  compactJson,
  filterAgents,
  formatTimestamp,
  safeJson,
  valueOrEmpty,
} from "/ui/view-model.js";
```

- [ ] **Step 2: Replace the minimal Office renderer**

Replace the `renderOffice()` function from Task 2 with:

```js
function renderOffice() {
  const visibleAgents = currentVisibleAgents();
  elements.officeVisibleCount.textContent = `${visibleAgents.length} agent${visibleAgents.length === 1 ? "" : "s"}`;
  elements.officeGeneratedAt.textContent = state.generatedAt
    ? `snapshot ${formatTimestamp(state.generatedAt)}`
    : "No snapshot loaded";

  if (visibleAgents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.agents.length === 0 ? "No agents loaded." : "No agents match the filters.";
    elements.officeBody.replaceChildren(empty);
    elements.officeDetail.hidden = true;
    elements.officeDetail.replaceChildren();
    return;
  }

  elements.officeBody.replaceChildren(...buildOfficePods(visibleAgents).map(renderOfficePod));
  renderOfficeDetail(visibleAgents);
}
```

Add these functions after `renderOffice()`:

```js
function renderOfficePod(pod) {
  const section = document.createElement("section");
  section.className = "office-pod";
  section.dataset.podType = pod.type;

  const header = document.createElement("div");
  header.className = "office-pod__header";

  const title = document.createElement("div");
  title.className = "office-pod__title";
  title.textContent = officePodTitle(pod);
  title.title = title.textContent;

  const count = document.createElement("span");
  count.className = "office-pod__count";
  count.textContent = `${pod.children.length} sub`;

  header.append(title, count);
  section.append(header);

  const desks = document.createElement("div");
  desks.className = "office-desks";
  if (pod.agent) {
    desks.append(renderOfficeAgent(pod.agent, "lead"));
  }
  for (const child of pod.children) {
    desks.append(renderOfficeAgent(child, "sub"));
  }
  section.append(desks);

  return section;
}

function officePodTitle(pod) {
  if (pod.agent) {
    return valueOrEmpty(pod.agent.displayName);
  }
  if (pod.type === "unassigned") {
    return "Unassigned Sub Agents";
  }
  return "Other Agents";
}

function renderOfficeAgent(agent, role) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "office-agent";
  button.dataset.status = valueOrEmpty(agent.status);
  button.dataset.role = role;
  button.dataset.kind = valueOrEmpty(agent.kind);
  if (agent.stale) {
    button.classList.add("is-stale");
  }
  if (state.expandedAgentId === agent.id) {
    button.classList.add("is-selected");
  }
  button.title = `${valueOrEmpty(agent.displayName)} · ${valueOrEmpty(agent.status)} · ${valueOrEmpty(agent.cwd)}`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => {
    state.expandedAgentId = state.expandedAgentId === agent.id ? null : agent.id;
    renderActiveView();
  });

  const bubble = document.createElement("span");
  bubble.className = "office-agent__bubble";
  bubble.textContent = officeAgentBubble(agent.status);

  const avatar = document.createElement("span");
  avatar.className = "office-agent__avatar";
  avatar.append(
    span("office-agent__head", ""),
    span("office-agent__body", ""),
    span("office-agent__arm office-agent__arm--left", ""),
    span("office-agent__arm office-agent__arm--right", ""),
  );

  const desk = document.createElement("span");
  desk.className = "office-agent__desk";
  desk.append(span("office-agent__monitor", ""), span("office-agent__keyboard", ""));

  const label = document.createElement("span");
  label.className = "office-agent__label";
  label.textContent = valueOrEmpty(agent.displayName);

  const status = document.createElement("span");
  status.className = "office-agent__status";
  status.textContent = valueOrEmpty(agent.status);

  button.append(bubble, avatar, desk, label, status);
  return button;
}

function officeAgentBubble(status) {
  if (status === "waiting_approval") {
    return "approve";
  }
  if (status === "waiting_input") {
    return "input?";
  }
  if (status === "error") {
    return "!";
  }
  if (status === "finished") {
    return "done";
  }
  return "";
}

function renderOfficeDetail(visibleAgents) {
  const selected = visibleAgents.find((agent) => agent.id === state.expandedAgentId);
  if (!selected) {
    elements.officeDetail.hidden = true;
    elements.officeDetail.replaceChildren();
    return;
  }

  elements.officeDetail.hidden = false;
  const title = document.createElement("h2");
  title.textContent = valueOrEmpty(selected.displayName);

  const meta = document.createElement("dl");
  meta.className = "office-detail__meta";
  meta.append(
    detailPair("status", selected.status),
    detailPair("kind", selected.kind),
    detailPair("lastTurn", selected.lastTurn?.status),
    detailPair("updatedAt", formatTimestamp(selected.updatedAt)),
    detailPair("cwd", selected.cwd),
    detailPair("id", selected.id),
  );

  elements.officeDetail.replaceChildren(title, meta);
}

function detailPair(label, value) {
  const fragment = document.createDocumentFragment();
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = valueOrEmpty(value);
  fragment.append(term, description);
  return fragment;
}

function span(className, text) {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}
```

- [ ] **Step 3: Keep selection valid after refresh**

In `loadSnapshot()`, keep the existing `expandedAgentId` pruning. No code change is required if this block is still present:

```js
      if (state.expandedAgentId && !state.agents.some((agent) => agent.id === state.expandedAgentId)) {
        state.expandedAgentId = null;
      }
```

- [ ] **Step 4: Run unit tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit Office rendering**

Run:

```bash
git add src/ui/app.js
git commit -m "feat: render office agent pods"
```

---

### Task 4: Add Pixel Office Styling And Animations

**Files:**
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Add Office layout styles**

In `src/ui/styles.css`, replace the simple `.office-body` block from Task 2 with:

```css
.office-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  padding: 12px;
  background:
    linear-gradient(#dce4eb 1px, transparent 1px),
    linear-gradient(90deg, #dce4eb 1px, transparent 1px),
    #eef2f5;
  background-size: 24px 24px;
}

.office-pod {
  min-width: 0;
  border: 2px solid #334155;
  border-radius: 6px;
  background: #f8fafc;
  box-shadow: inset 0 -8px 0 #d7dde4;
}

.office-pod__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 2px solid #334155;
  background: #e2e8ef;
  padding: 8px 10px;
}

.office-pod__title {
  min-width: 0;
  overflow: hidden;
  color: #26384a;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.office-pod__count {
  flex: none;
  border: 1px solid #9aa9b8;
  border-radius: 999px;
  background: #ffffff;
  color: #405261;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.office-desks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  gap: 10px;
  padding: 10px;
}
```

- [ ] **Step 2: Add CSS-built pixel agent styles**

Add these styles after the Office layout block:

```css
.office-agent {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 138px;
  grid-template-rows: 58px 42px auto auto;
  justify-items: center;
  border: 2px solid #334155;
  border-radius: 5px;
  background: #ffffff;
  color: #26384a;
  padding: 8px;
  cursor: pointer;
  overflow: hidden;
}

.office-agent:hover {
  background: #f6f9fc;
}

.office-agent:focus-visible {
  outline: 3px solid #4d8fcc;
  outline-offset: 2px;
}

.office-agent.is-selected {
  box-shadow: 0 0 0 3px #4d8fcc inset;
}

.office-agent.is-stale {
  filter: grayscale(0.75);
  opacity: 0.68;
}

.office-agent[data-role="lead"] {
  background: #f7fbff;
}

.office-agent__bubble {
  position: absolute;
  top: 6px;
  right: 6px;
  min-height: 20px;
  max-width: calc(100% - 12px);
  border: 2px solid #334155;
  border-radius: 5px;
  background: #fff4c6;
  color: #553800;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.office-agent__bubble:empty {
  display: none;
}

.office-agent__avatar {
  position: relative;
  width: 38px;
  height: 50px;
  align-self: end;
}

.office-agent__head,
.office-agent__body,
.office-agent__arm {
  position: absolute;
  display: block;
  image-rendering: pixelated;
}

.office-agent__head {
  top: 2px;
  left: 11px;
  width: 16px;
  height: 16px;
  border: 2px solid #334155;
  border-radius: 2px;
  background: #f3c99b;
}

.office-agent__body {
  top: 20px;
  left: 8px;
  width: 22px;
  height: 26px;
  border: 2px solid #334155;
  border-radius: 2px;
  background: #8ab47b;
}

.office-agent__arm {
  top: 28px;
  width: 8px;
  height: 18px;
  border: 2px solid #334155;
  background: #f3c99b;
}

.office-agent__arm--left {
  left: 1px;
  transform: rotate(10deg);
}

.office-agent__arm--right {
  right: 1px;
  transform: rotate(-10deg);
}

.office-agent__desk {
  position: relative;
  display: block;
  width: 74px;
  height: 36px;
  border: 2px solid #334155;
  background: #d6a86d;
}

.office-agent__monitor {
  position: absolute;
  left: 18px;
  top: -30px;
  width: 38px;
  height: 26px;
  border: 2px solid #334155;
  background: #6fa8dc;
}

.office-agent__keyboard {
  position: absolute;
  left: 17px;
  bottom: 5px;
  width: 40px;
  height: 6px;
  background: #334155;
}

.office-agent__label,
.office-agent__status {
  max-width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.office-agent__label {
  margin-top: 6px;
  font-size: 12px;
  font-weight: 700;
}

.office-agent__status {
  margin-top: 2px;
  color: #637487;
  font-size: 11px;
}
```

- [ ] **Step 3: Add status-specific colors and animations**

Add these styles after the agent styles:

```css
.office-agent[data-status="working"] .office-agent__monitor {
  animation: office-monitor-pulse 1.2s steps(2, end) infinite;
}

.office-agent[data-status="working"] .office-agent__arm--right {
  animation: office-typing-arm 0.7s steps(2, end) infinite;
}

.office-agent[data-status="idle"] .office-agent__monitor,
.office-agent[data-status="finished"] .office-agent__monitor,
.office-agent[data-status="unknown"] .office-agent__monitor {
  background: #cbd3dc;
}

.office-agent[data-status="finished"] .office-agent__body {
  background: #9aa9b8;
}

.office-agent[data-status="waiting_approval"] .office-agent__bubble,
.office-agent[data-status="waiting_input"] .office-agent__bubble {
  animation: office-bubble-pulse 1.4s ease-in-out infinite;
}

.office-agent[data-status="waiting_approval"] .office-agent__body,
.office-agent[data-status="waiting_input"] .office-agent__body {
  background: #d9a76f;
}

.office-agent[data-status="error"] .office-agent__monitor,
.office-agent[data-status="error"] .office-agent__bubble {
  background: #ffd7d2;
  color: #7b211c;
}

.office-agent[data-status="error"] .office-agent__monitor {
  animation: office-error-blink 1s steps(2, end) infinite;
}

@keyframes office-monitor-pulse {
  0%,
  100% {
    background: #6fa8dc;
  }
  50% {
    background: #a6d8ff;
  }
}

@keyframes office-typing-arm {
  0%,
  100% {
    transform: rotate(-10deg);
  }
  50% {
    transform: rotate(12deg) translateY(2px);
  }
}

@keyframes office-bubble-pulse {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-2px);
  }
}

@keyframes office-error-blink {
  0%,
  100% {
    background: #ffd7d2;
  }
  50% {
    background: #f58b82;
  }
}

@media (prefers-reduced-motion: reduce) {
  .office-agent[data-status="working"] .office-agent__monitor,
  .office-agent[data-status="working"] .office-agent__arm--right,
  .office-agent[data-status="waiting_approval"] .office-agent__bubble,
  .office-agent[data-status="waiting_input"] .office-agent__bubble,
  .office-agent[data-status="error"] .office-agent__monitor {
    animation: none;
  }
}
```

- [ ] **Step 4: Add Office detail styles**

Add these styles before `.empty-state`:

```css
.office-detail {
  border-top: 1px solid #dbe2ea;
  background: #ffffff;
  padding: 12px;
}

.office-detail h2 {
  margin: 0 0 10px;
  font-size: 15px;
  letter-spacing: 0;
}

.office-detail__meta {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 10px;
  margin: 0;
}

.office-detail__meta dt {
  color: #637487;
  font-size: 12px;
  font-weight: 700;
}

.office-detail__meta dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 5: Add mobile refinements**

Inside the existing `@media (max-width: 920px)` block, add:

```css
  .view-switch {
    display: flex;
  }

  .view-switch__button {
    flex: 1;
  }

  .office-body {
    grid-template-columns: 1fr;
    padding: 10px;
  }

  .office-desks {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
```

- [ ] **Step 6: Run CSS and unit verification**

Run:

```bash
git diff --check
npm test
```

Expected: no whitespace errors, and all tests pass.

- [ ] **Step 7: Commit pixel styling**

Run:

```bash
git add src/ui/styles.css
git commit -m "style: add pixel office visuals"
```

---

### Task 5: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Web UI feature list**

In `README.md`, in the `It includes:` list under `## Web UI`, add this bullet after the filterable table bullet:

```md
- A `Table` / `Office` switch, where Office renders filtered agents as pixel-style team pods.
```

- [ ] **Step 2: Add a short Office view note**

After the paragraph `The UI polls /health and /status every three seconds when auto-refresh is enabled.`, add:

```md
The Office view uses the same filters as the table. To keep the animated scene focused on current activity, set `Active within` to a recent window such as `30min` or `3h`.
```

- [ ] **Step 3: Run markdown diff check**

Run:

```bash
git diff -- README.md
git diff --check
```

Expected: README diff only describes the Office view; no whitespace errors.

- [ ] **Step 4: Commit README**

Run:

```bash
git add README.md
git commit -m "docs: document office view"
```

---

### Task 6: Browser Verification And Final Checks

**Files:**
- No planned source edits.

- [ ] **Step 1: Run full automated tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run real App Server smoke check**

Run:

```bash
npm run smoke:real
```

Expected: JSON output has `"ok": true`, `"connected": true`, and a numeric `summary.total`.

- [ ] **Step 3: Start a local daemon for browser verification**

Run:

```bash
node src/cli.ts daemon --port 0
```

Expected: process prints a URL like `codex-status listening at http://127.0.0.1:<port>`. Keep the process running until browser verification is complete.

- [ ] **Step 4: Verify Office tab with Playwright**

Replace `<url>` with the URL printed by the daemon, then run:

```bash
playwright-cli open <url>/ui
playwright-cli run-code 'async page => {
  await page.waitForLoadState("networkidle");
  await page.click("#office-view-button");
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    tableHidden: document.querySelector("#table-view")?.hidden,
    officeHidden: document.querySelector("#office-view")?.hidden,
    podCount: document.querySelectorAll(".office-pod").length,
    agentCount: document.querySelectorAll(".office-agent").length,
    selectedBefore: document.querySelectorAll(".office-agent.is-selected").length,
  }));
  const firstAgent = page.locator(".office-agent").first();
  if (await firstAgent.count()) {
    await firstAgent.click();
    await page.waitForTimeout(100);
  }
  const afterClick = await page.evaluate(() => ({
    selectedAfter: document.querySelectorAll(".office-agent.is-selected").length,
    detailHidden: document.querySelector("#office-detail")?.hidden,
    detailText: document.querySelector("#office-detail")?.textContent?.trim().slice(0, 120) ?? "",
  }));
  return { result, afterClick };
}'
playwright-cli close
```

Expected:

- `tableHidden` is `true`.
- `officeHidden` is `false`.
- `podCount` is greater than `0` when filters include visible agents.
- `agentCount` is greater than `0` when filters include visible agents.
- After clicking an office agent, `selectedAfter` is `1` and `detailHidden` is `false`.

- [ ] **Step 5: Verify mobile layout with Playwright**

Run:

```bash
playwright-cli open <url>/ui
playwright-cli run-code 'async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForLoadState("networkidle");
  await page.click("#office-view-button");
  await page.waitForTimeout(300);
  return await page.evaluate(() => ({
    bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    podCount: document.querySelectorAll(".office-pod").length,
    officeWidth: document.querySelector("#office-view")?.getBoundingClientRect().width,
  }));
}'
playwright-cli close
```

Expected:

- `bodyOverflow` is `false`.
- `podCount` is greater than `0` when filters include visible agents.
- `officeWidth` is less than or equal to `390`.

- [ ] **Step 6: Stop the local daemon**

Send `Ctrl-C` to the `node src/cli.ts daemon --port 0` process from Step 3.

- [ ] **Step 7: Clean temporary Playwright files**

Run:

```bash
rm -rf .playwright-cli
```

- [ ] **Step 8: Run final repository checks**

Run:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` reports no whitespace errors. Existing LF/CRLF warnings are acceptable if no errors are reported.
- `git status --short` is empty.

---

## Plan Self-Review

Spec coverage:

- `Table` / `Office` switch: Task 2.
- Pixel Office using pure HTML/CSS: Tasks 3 and 4.
- Team pods with main/sub hierarchy: Tasks 1 and 3.
- Shared filters: Task 2 uses `currentVisibleAgents()` for both views.
- Status mapping: Task 4.
- Clickable agent details: Task 3.
- README documentation: Task 5.
- Automated and browser verification: Tasks 1, 2, 4, and 6.

The plan avoids backend changes, Canvas, sprite sheets, new build tooling, and new runtime dependencies.
