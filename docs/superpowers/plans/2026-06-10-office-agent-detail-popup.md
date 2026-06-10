# Office Agent Detail Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the Office view so clicking an agent opens the detail content in a centered modal dialog instead of rendering it at the bottom of the Office page.

**Architecture:** Keep `expandedAgentId` as the selected-agent source of truth. Reuse `#office-detail` as an overlay root, with `renderOfficeDetail()` building a backdrop and dialog surface from the currently visible selected agent. Add small close helpers for backdrop, close button, repeated agent click, and `Escape`.

**Tech Stack:** Vanilla JavaScript modules, static HTML, CSS, Node.js `node --test`, optional Playwright smoke check against the local daemon.

---

## File Structure

- Modify `src/ui/index.html`: keep the existing `#office-detail` element inside the Office view, but mark it as hidden from assistive tech when closed.
- Modify `src/ui/app.js`: add modal open/focus state, close helpers, `Escape` handling, and modal DOM rendering.
- Modify `src/ui/styles.css`: replace inline bottom detail styling with fixed overlay, backdrop, dialog, header, and close button styles.
- Modify `tests/http/api.test.ts`: update Office asset assertions so the modal structure and close paths are covered by static tests.

## Task 1: Write Failing Office Modal Asset Tests

**Files:**
- Modify: `tests/http/api.test.ts`

- [ ] **Step 1: Replace the Office scroll-selection asset test with a modal behavior asset test**

Replace the existing test named `"GET /ui assets preserve scroll when selecting office agents"` with this test:

```ts
test("GET /ui assets open office agent details in a modal dialog", async () => {
  await withServer(async (baseUrl) => {
    const html = await (await fetch(`${baseUrl}/ui`)).text();
    const script = await (await fetch(`${baseUrl}/ui/app.js`)).text();
    const styles = await (await fetch(`${baseUrl}/ui/styles.css`)).text();

    assert.match(html, /id="office-detail" class="office-detail" hidden aria-hidden="true"/);

    assert.match(
      script,
      /const scrollPosition = captureScrollPosition\(\);[\s\S]*?const nextExpandedAgentId = state\.expandedAgentId === agent\.id \? null : agent\.id;[\s\S]*?state\.officeDetailFocusPending = nextExpandedAgentId !== null;[\s\S]*?state\.expandedAgentId = nextExpandedAgentId;[\s\S]*?renderActiveView\(\);[\s\S]*?restoreScrollPosition\(scrollPosition\);/,
    );
    assert.match(script, /officeDetailFocusPending:\s*false/);
    assert.match(script, /document\.addEventListener\("keydown", handleOfficeDetailKeydown\);/);
    assert.match(script, /function closeOfficeDetail\(\)/);
    assert.match(script, /function handleOfficeDetailKeydown\(event\)/);
    assert.match(script, /event\.key !== "Escape"/);
    assert.match(script, /office-detail__backdrop/);
    assert.match(script, /setAttribute\("role", "dialog"\)/);
    assert.match(script, /setAttribute\("aria-modal", "true"\)/);
    assert.match(script, /setAttribute\("aria-labelledby", "office-detail-title"\)/);
    assert.match(script, /office-detail__close/);

    assert.match(styles, /\.office-detail \{[\s\S]*?position: fixed;/);
    assert.match(styles, /\.office-detail\[hidden\] \{[\s\S]*?display: none;/);
    assert.match(styles, /\.office-detail__backdrop/);
    assert.match(styles, /\.office-detail__dialog/);
    assert.match(styles, /\.office-detail__header/);
    assert.match(styles, /\.office-detail__close/);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/http/api.test.ts
```

Expected: the new test fails because `index.html` does not include `aria-hidden="true"`, `app.js` does not create modal elements or close handlers, and `styles.css` still styles `.office-detail` as an inline panel.

## Task 2: Update Office Detail HTML Shell

**Files:**
- Modify: `src/ui/index.html`

- [ ] **Step 1: Mark the closed detail root as hidden from assistive tech**

Change the current Office detail element:

```html
<aside id="office-detail" class="office-detail" hidden></aside>
```

to:

```html
<aside id="office-detail" class="office-detail" hidden aria-hidden="true"></aside>
```

- [ ] **Step 2: Run the focused test and verify only HTML-related assertions now pass**

Run:

```bash
npm test -- tests/http/api.test.ts
```

Expected: the test still fails on JavaScript and CSS assertions, while the `office-detail` HTML assertion passes.

## Task 3: Render Office Detail As A Modal

**Files:**
- Modify: `src/ui/app.js`

- [ ] **Step 1: Add focus-pending state**

Add `officeDetailFocusPending` to `state` near the existing Office state fields:

```js
  officeAlerts: [],
  nextOfficeAlertId: 1,
  officeDetailFocusPending: false,
  activeView: "table",
```

- [ ] **Step 2: Wire global Escape handling**

Add this listener at the end of `wireControls()`:

```js
  document.addEventListener("keydown", handleOfficeDetailKeydown);
```

- [ ] **Step 3: Preserve scroll and mark modal focus as pending when an Office agent opens**

Replace the Office agent click handler in `renderOfficeAgent()` with:

```js
  button.addEventListener("click", () => {
    const scrollPosition = captureScrollPosition();
    const nextExpandedAgentId = state.expandedAgentId === agent.id ? null : agent.id;
    state.officeDetailFocusPending = nextExpandedAgentId !== null;
    state.expandedAgentId = nextExpandedAgentId;
    renderActiveView();
    restoreScrollPosition(scrollPosition);
  });
```

- [ ] **Step 4: Keep the detail root hidden and aria-hidden when no selected visible agent exists**

In the empty Office branch inside `renderOffice()`, replace:

```js
    elements.officeDetail.hidden = true;
    elements.officeDetail.replaceChildren();
```

with:

```js
    elements.officeDetail.hidden = true;
    elements.officeDetail.setAttribute("aria-hidden", "true");
    elements.officeDetail.replaceChildren();
```

- [ ] **Step 5: Replace `renderOfficeDetail()` with modal DOM rendering**

Replace the full `renderOfficeDetail(visibleAgents)` function with:

```js
function renderOfficeDetail(visibleAgents) {
  const selected = visibleAgents.find((agent) => agent.id === state.expandedAgentId);
  if (!selected) {
    elements.officeDetail.hidden = true;
    elements.officeDetail.setAttribute("aria-hidden", "true");
    elements.officeDetail.replaceChildren();
    return;
  }

  elements.officeDetail.hidden = false;
  elements.officeDetail.setAttribute("aria-hidden", "false");

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "office-detail__backdrop";
  backdrop.tabIndex = -1;
  backdrop.setAttribute("aria-label", "Close agent detail");
  backdrop.addEventListener("click", closeOfficeDetail);

  const dialog = document.createElement("section");
  dialog.className = "office-detail__dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "office-detail-title");

  const header = document.createElement("div");
  header.className = "office-detail__header";

  const title = document.createElement("h2");
  title.id = "office-detail-title";
  title.textContent = valueOrEmpty(selected.displayName);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "office-detail__close";
  closeButton.textContent = "Close";
  closeButton.setAttribute("aria-label", `Close ${valueOrEmpty(selected.displayName)} detail`);
  closeButton.addEventListener("click", closeOfficeDetail);

  header.append(title, closeButton);

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

  const actions = document.createElement("div");
  actions.className = "detail-actions";
  actions.append(renderAgentMessageLink(selected));

  const body = document.createElement("div");
  body.className = "office-detail__body";
  body.append(meta, actions);

  dialog.append(header, body);
  elements.officeDetail.replaceChildren(backdrop, dialog);

  if (state.officeDetailFocusPending) {
    state.officeDetailFocusPending = false;
    closeButton.focus({ preventScroll: true });
  }
}
```

- [ ] **Step 6: Add close and Escape helpers after `renderOfficeDetail()`**

Insert these functions after `renderOfficeDetail()`:

```js
function closeOfficeDetail() {
  if (state.activeView !== "office" || elements.officeDetail.hidden) {
    return;
  }

  const scrollPosition = captureScrollPosition();
  state.expandedAgentId = null;
  state.officeDetailFocusPending = false;
  renderActiveView();
  restoreScrollPosition(scrollPosition);
}

function handleOfficeDetailKeydown(event) {
  if (event.key !== "Escape" || state.activeView !== "office" || elements.officeDetail.hidden) {
    return;
  }

  event.preventDefault();
  closeOfficeDetail();
}
```

- [ ] **Step 7: Run the focused test and verify only CSS assertions remain**

Run:

```bash
npm test -- tests/http/api.test.ts
```

Expected: JavaScript assertions pass. CSS assertions still fail until the modal styles are added.

## Task 4: Replace Inline Detail Styles With Modal Styles

**Files:**
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Replace `.office-detail` styles**

Replace the current `.office-detail`, `.office-detail h2`, `.office-detail__meta`, `.office-detail__meta dt`, and `.office-detail__meta dd` block with:

```css
.office-detail {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
}

.office-detail[hidden] {
  display: none;
}

.office-detail__backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: rgba(24, 32, 43, 0.48);
  cursor: pointer;
}

.office-detail__dialog {
  position: relative;
  z-index: 1;
  width: min(560px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 48px));
  overflow: auto;
  border: 1px solid #cfd8e3;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(24, 32, 43, 0.3);
  padding: 16px;
}

.office-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.office-detail h2 {
  min-width: 0;
  margin: 0;
  font-size: 16px;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.office-detail__close {
  flex: 0 0 auto;
  border: 1px solid #cfd8e3;
  border-radius: 6px;
  background: #f7fafc;
  color: #243243;
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.office-detail__close:hover,
.office-detail__close:focus-visible {
  border-color: #8fb4d4;
  background: #eaf4fc;
  outline: none;
}

.office-detail__body {
  min-width: 0;
}

.office-detail__meta {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 10px;
  margin: 0 0 12px;
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

- [ ] **Step 2: Add narrow-screen dialog spacing**

Add this media query near the Office styles:

```css
@media (max-width: 640px) {
  .office-detail {
    padding: 16px;
  }

  .office-detail__dialog {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 32px);
  }
}
```

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
npm test -- tests/http/api.test.ts
```

Expected: all tests in `tests/http/api.test.ts` pass.

## Task 5: Full Verification And Commit

**Files:**
- Verify: full repository test suite
- Commit: `src/ui/index.html`, `src/ui/app.js`, `src/ui/styles.css`, `tests/http/api.test.ts`

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: all Node test files pass.

- [ ] **Step 2: Run whitespace validation**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 3: Start the local daemon for a browser smoke check**

Run:

```bash
node src/cli.ts daemon --port 0
```

Expected: the process prints a URL like `codex-status listening at http://127.0.0.1:<port>`.

- [ ] **Step 4: Use Playwright to verify Office modal behavior**

Open the printed URL, switch to Office view, click the first `.office-agent`, and verify:

```js
{
  dialogCount: await page.locator('[role="dialog"][aria-modal="true"]').count(),
  closeCount: await page.locator('.office-detail__close').count(),
  selectedCount: await page.locator('.office-agent.is-selected').count(),
  detailHidden: await page.locator('#office-detail').getAttribute('hidden'),
}
```

Expected after click:

```js
{
  dialogCount: 1,
  closeCount: 1,
  selectedCount: 1,
  detailHidden: null,
}
```

Then press `Escape` and verify:

```js
{
  dialogCount: 0,
  selectedCount: 0,
  detailHidden: "",
}
```

- [ ] **Step 5: Stop the local daemon**

Stop the process started in Step 3 with `Ctrl-C`.

Expected: no local daemon process remains running for this task.

- [ ] **Step 6: Review the final diff**

Run:

```bash
git diff -- src/ui/index.html src/ui/app.js src/ui/styles.css tests/http/api.test.ts
```

Expected: the diff only changes Office detail modal behavior and tests.

- [ ] **Step 7: Commit the implementation**

Run:

```bash
git add src/ui/index.html src/ui/app.js src/ui/styles.css tests/http/api.test.ts
git commit -m "feat: show office agent details in modal"
```

Expected: a new commit containing the implementation changes.
