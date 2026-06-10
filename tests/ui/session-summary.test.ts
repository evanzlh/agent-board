import test from "node:test";
import assert from "node:assert/strict";
import { renderSessionSummary } from "../../src/ui/session-summary.js";

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  className = "";
  hidden = false;
  open = false;
  #textContent = "";

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get textContent(): string {
    return this.#textContent;
  }

  set textContent(value: unknown) {
    this.#textContent = String(value);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

function elements() {
  return {
    summary: new FakeElement("section"),
    summaryGrid: new FakeElement("div"),
    diagnostics: new FakeElement("details"),
    diagnosticsContent: new FakeElement("div"),
  };
}

function textContent(element: FakeElement): string {
  return [element.textContent, ...element.children.map(textContent)].join("");
}

function findDiagnosticsSection(root: FakeElement, title: string): FakeElement | null {
  for (const child of root.children) {
    if (child.tagName === "section" && child.children.some((item) => item.textContent === title)) {
      return child;
    }
    const found = findDiagnosticsSection(child, title);
    if (found) {
      return found;
    }
  }
  return null;
}

test("renderSessionSummary ignores malformed tool rows and collapses diagnostics", () => {
  globalThis.document = new FakeDocument() as unknown as Document;
  const ui = elements();

  assert.doesNotThrow(() =>
    renderSessionSummary(
      ui,
      {
        events: { total: 4 },
        messages: { reasoning: 1 },
        tools: {
          calls: 2,
          byName: [
            null,
            { name: "exec_command", count: 2 },
            { name: "", count: 1 },
            { name: "bad", count: "nope" },
          ],
        },
      },
      3,
    ),
  );

  const diagnosticsText = textContent(ui.diagnosticsContent);
  assert.match(diagnosticsText, /exec_command/);
  assert.doesNotMatch(diagnosticsText, /bad/);
  assert.equal(ui.diagnostics.open, false);
  assert.equal(ui.summary.hidden, false);
});

test("renderSessionSummary renders missing token diagnostics as unknown", () => {
  globalThis.document = new FakeDocument() as unknown as Document;
  const ui = elements();

  renderSessionSummary(ui, { tokens: {} }, 0);

  const tokenSection = findDiagnosticsSection(ui.diagnosticsContent, "Token usage");
  assert.ok(tokenSection);
  const tokenText = textContent(tokenSection);
  assert.match(tokenText, /Last inputunknown/);
  assert.match(tokenText, /Total tokensunknown/);
  assert.match(tokenText, /Model context windowunknown/);
});
