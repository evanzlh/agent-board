# Codex Status Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `codex-status`, a local read-only daemon that observes Codex App Server state and exposes stable JSON/SSE status endpoints.

**Architecture:** The daemon is a small Node 22 TypeScript application with zero production npm dependencies. App Server protocol details live behind `AppServerClient`, runtime state is normalized into `StatusStore`, and `HttpApi` exposes the stable public contract. The supervisor first tries `codex app-server daemon start` plus `codex app-server proxy`, then falls back to a managed `codex app-server --listen stdio://` child process when the installed Codex does not support managed daemon startup.

**Tech Stack:** Node 22 built-ins (`node:test`, `node:http`, `node:child_process`, `node:events`), TypeScript files executed through Node's built-in type stripping, newline-delimited JSON-RPC over stdio, no production dependencies.

---

## File Structure

Create these files:

- `package.json`: scripts, package metadata, and `codex-status` bin entry.
- `src/version.ts`: single version constant.
- `src/domain/types.ts`: public status types and minimal App Server input shapes used by the daemon.
- `src/domain/mapper.ts`: pure mapping functions from App Server thread/turn state to `AgentStatus`.
- `src/store/status-store.ts`: in-memory snapshot, summaries, filters, health state, and status-change events.
- `src/config.ts`: defaults and CLI argument parsing.
- `src/http/api.ts`: local read-only HTTP and SSE server.
- `src/app-server/json-rpc.ts`: newline-delimited JSON-RPC stdio transport.
- `src/app-server/supervisor.ts`: Codex CLI discovery, App Server startup, daemon/proxy/managed-child process handling.
- `src/app-server/client.ts`: read-only App Server API wrapper and notification ingestion.
- `src/daemon.ts`: composition root used by tests and CLI.
- `src/cli.ts`: executable command entrypoint.
- `scripts/smoke-real-app-server.ts`: non-default real-environment smoke test.
- `tests/domain/mapper.test.ts`
- `tests/store/status-store.test.ts`
- `tests/config.test.ts`
- `tests/http/api.test.ts`
- `tests/app-server/json-rpc.test.ts`
- `tests/app-server/supervisor.test.ts`
- `tests/app-server/client.test.ts`
- `tests/daemon.test.ts`

Implementation constraints:

- Use only TypeScript syntax that Node can erase directly: type aliases, interfaces, annotations, and imports. Do not use `enum`, parameter properties, decorators, namespaces, or other syntax that requires transformation.
- Use Unix timestamps in milliseconds for daemon-created fields (`startedAt`, `lastConnectedAt`, `lastEventAt`, `waitingSince`, `generatedAt`).
- Keep App Server raw objects as `unknown` or minimal structural types; do not copy generated Codex schema into this repository.
- Keep HTTP API read-only. Do not add endpoints that mutate Codex.

---

### Task 1: Project Skeleton And Test Harness

**Files:**
- Create: `package.json`
- Create: `src/version.ts`
- Create: `tests/version.test.ts`

- [ ] **Step 1: Write the failing version test**

Create `tests/version.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { VERSION } from "../src/version.ts";

test("VERSION exposes the package version", () => {
  assert.equal(VERSION, "0.1.0");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/version.test.ts
```

Expected: FAIL with a module-not-found error for `../src/version.ts`.

- [ ] **Step 3: Create package metadata and version module**

Create `package.json`:

```json
{
  "name": "codex-status",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "codex-status": "src/cli.ts"
  },
  "scripts": {
    "test": "node --test tests/**/*.test.ts",
    "start": "node src/cli.ts daemon",
    "smoke:real": "node scripts/smoke-real-app-server.ts"
  },
  "engines": {
    "node": ">=22.18.0"
  }
}
```

Create `src/version.ts`:

```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/version.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the package test command**

Run:

```bash
npm test
```

Expected: PASS with one test file.

- [ ] **Step 6: Commit**

```bash
git add package.json src/version.ts tests/version.test.ts
git commit -m "chore: add node test harness"
```

---

### Task 2: Domain Types And Status Mapping

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/mapper.ts`
- Create: `tests/domain/mapper.test.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `tests/domain/mapper.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveAgentKind,
  deriveDisplayName,
  deriveParentThreadId,
  mapThreadStatus,
  normalizeThread,
} from "../../src/domain/mapper.ts";
import type { AppServerThread } from "../../src/domain/types.ts";

function thread(overrides: Partial<AppServerThread> = {}): AppServerThread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    preview: "Build the thing",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1780010000,
    updatedAt: 1780010100,
    status: { type: "idle" },
    path: null,
    cwd: "/repo",
    cliVersion: "0.135.0",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

test("mapThreadStatus maps idle", () => {
  assert.equal(mapThreadStatus({ type: "idle" }, null), "idle");
});

test("mapThreadStatus maps active without flags to working", () => {
  assert.equal(mapThreadStatus({ type: "active", activeFlags: [] }, null), "working");
});

test("mapThreadStatus maps waiting approval before generic working", () => {
  assert.equal(
    mapThreadStatus({ type: "active", activeFlags: ["waitingOnApproval"] }, null),
    "waiting_approval",
  );
});

test("mapThreadStatus maps waiting input", () => {
  assert.equal(
    mapThreadStatus({ type: "active", activeFlags: ["waitingOnUserInput"] }, null),
    "waiting_input",
  );
});

test("mapThreadStatus maps systemError and failed turn to error", () => {
  assert.equal(mapThreadStatus({ type: "systemError" }, null), "error");
  assert.equal(mapThreadStatus({ type: "idle" }, { status: "failed" }), "error");
});

test("mapThreadStatus maps unrecognized shape to unknown", () => {
  assert.equal(mapThreadStatus({ type: "newState" }, null), "unknown");
});

test("deriveAgentKind detects sub-agent metadata", () => {
  assert.equal(deriveAgentKind(thread({ agentNickname: "builder" })), "sub_agent");
  assert.equal(deriveAgentKind(thread({ agentRole: "reviewer" })), "sub_agent");
  assert.equal(deriveAgentKind(thread({ source: { subAgent: "review" } })), "sub_agent");
  assert.equal(
    deriveAgentKind(
      thread({
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "parent-1",
              depth: 1,
              agent_path: null,
              agent_nickname: "worker",
              agent_role: "builder",
            },
          },
        },
      }),
    ),
    "sub_agent",
  );
});

test("deriveAgentKind treats plain fork without sub-agent marker as unknown", () => {
  assert.equal(deriveAgentKind(thread({ forkedFromId: "parent-1" })), "unknown");
});

test("deriveParentThreadId prefers subAgent thread_spawn parent", () => {
  assert.equal(
    deriveParentThreadId(
      thread({
        forkedFromId: "fork-parent",
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "spawn-parent",
              depth: 2,
              agent_path: null,
              agent_nickname: null,
              agent_role: null,
            },
          },
        },
      }),
    ),
    "spawn-parent",
  );
});

test("deriveDisplayName follows nickname, role, name, preview, id order", () => {
  assert.equal(deriveDisplayName(thread({ agentNickname: "alpha" })), "alpha");
  assert.equal(deriveDisplayName(thread({ agentRole: "reviewer" })), "reviewer");
  assert.equal(deriveDisplayName(thread({ name: "Named Thread" })), "Named Thread");
  assert.equal(deriveDisplayName(thread({ preview: "Preview Text" })), "Preview Text");
  assert.equal(deriveDisplayName(thread({ preview: "", id: "thread-x" })), "thread-x");
});

test("normalizeThread returns stable public fields and preserves rawStatus", () => {
  const agent = normalizeThread(
    thread({
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
      agentNickname: "worker-1",
    }),
    { nowMs: 1780010200000 },
  );

  assert.equal(agent.id, "thread-1");
  assert.equal(agent.kind, "sub_agent");
  assert.equal(agent.displayName, "worker-1");
  assert.equal(agent.status, "waiting_approval");
  assert.deepEqual(agent.rawStatus, { type: "active", activeFlags: ["waitingOnApproval"] });
  assert.equal(agent.waitingSince, 1780010200000);
  assert.equal(agent.stale, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/domain/mapper.test.ts
```

Expected: FAIL with a module-not-found error for `src/domain/mapper.ts`.

- [ ] **Step 3: Add domain types**

Create `src/domain/types.ts`:

```ts
export type AgentKind = "main_agent" | "sub_agent" | "unknown";

export type AgentPublicStatus =
  | "idle"
  | "working"
  | "finished"
  | "waiting_approval"
  | "waiting_input"
  | "error"
  | "unknown";

export type AppServerThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags?: string[] }
  | { type: string; activeFlags?: string[] };

export type AppServerLastTurn = {
  status: "completed" | "interrupted" | "failed" | "inProgress" | string;
  startedAt?: number | null;
  completedAt?: number | null;
};

export type AppServerThread = {
  id: string;
  sessionId: string;
  forkedFromId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: AppServerThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: unknown;
  threadSource: unknown;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: unknown;
  name: string | null;
  turns: AppServerLastTurn[];
};

export type AgentLastTurn = {
  status: "completed" | "interrupted" | "failed" | "inProgress" | "unknown";
  startedAt: number | null;
  completedAt: number | null;
};

export type AgentStatus = {
  id: string;
  sessionId: string;
  kind: AgentKind;
  displayName: string;
  status: AgentPublicStatus;
  rawStatus: unknown;
  cwd: string;
  preview: string;
  modelProvider: string;
  cliVersion: string;
  createdAt: number;
  updatedAt: number;
  parentThreadId: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  lastTurn: AgentLastTurn | null;
  waitingSince: number | null;
  lastEventAt: number;
  stale: boolean;
};

export type NormalizeOptions = {
  nowMs: number;
  previous?: AgentStatus | null;
};
```

- [ ] **Step 4: Add mapper implementation**

Create `src/domain/mapper.ts`:

```ts
import type {
  AgentKind,
  AgentLastTurn,
  AgentPublicStatus,
  AgentStatus,
  AppServerLastTurn,
  AppServerThread,
  AppServerThreadStatus,
  NormalizeOptions,
} from "./types.ts";

export function mapThreadStatus(
  status: AppServerThreadStatus | unknown,
  lastTurn: Pick<AgentLastTurn, "status"> | null,
): AgentPublicStatus {
  if (lastTurn?.status === "failed") {
    return "error";
  }

  if (!isObject(status) || typeof status.type !== "string") {
    return "unknown";
  }

  if (status.type === "idle" || status.type === "notLoaded") {
    return "idle";
  }

  if (status.type === "systemError") {
    return "error";
  }

  if (status.type === "active") {
    const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
    if (flags.includes("waitingOnApproval")) {
      return "waiting_approval";
    }
    if (flags.includes("waitingOnUserInput")) {
      return "waiting_input";
    }
    return "working";
  }

  return "unknown";
}

export function deriveAgentKind(thread: AppServerThread): AgentKind {
  if (thread.agentNickname || thread.agentRole || getSubAgentSource(thread.source) !== null) {
    return "sub_agent";
  }

  if (thread.forkedFromId) {
    return "unknown";
  }

  return "main_agent";
}

export function deriveParentThreadId(thread: AppServerThread): string | null {
  const subAgentSource = getSubAgentSource(thread.source);
  const threadSpawn = getObjectProperty(subAgentSource, "thread_spawn");
  const parentThreadId = getStringProperty(threadSpawn, "parent_thread_id");

  return parentThreadId ?? thread.forkedFromId ?? null;
}

export function deriveDisplayName(thread: AppServerThread): string {
  return firstNonEmpty([
    thread.agentNickname,
    thread.agentRole,
    thread.name,
    thread.preview,
    thread.id,
  ]);
}

export function normalizeThread(thread: AppServerThread, options: NormalizeOptions): AgentStatus {
  const previous = options.previous ?? null;
  const lastTurn = normalizeLastTurn(thread.turns.at(-1) ?? null);
  const publicStatus = mapThreadStatus(thread.status, lastTurn);
  const waitingSince = isWaitingStatus(publicStatus)
    ? previous && previous.status === publicStatus
      ? previous.waitingSince
      : options.nowMs
    : null;

  return {
    id: thread.id,
    sessionId: thread.sessionId,
    kind: deriveAgentKind(thread),
    displayName: deriveDisplayName(thread),
    status: publicStatus,
    rawStatus: thread.status,
    cwd: thread.cwd,
    preview: thread.preview,
    modelProvider: thread.modelProvider,
    cliVersion: thread.cliVersion,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    parentThreadId: deriveParentThreadId(thread),
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    lastTurn,
    waitingSince,
    lastEventAt: options.nowMs,
    stale: false,
  };
}

function normalizeLastTurn(turn: AppServerLastTurn | null): AgentLastTurn | null {
  if (!turn) {
    return null;
  }

  const knownStatuses = new Set(["completed", "interrupted", "failed", "inProgress"]);
  return {
    status: knownStatuses.has(turn.status) ? (turn.status as AgentLastTurn["status"]) : "unknown",
    startedAt: typeof turn.startedAt === "number" ? turn.startedAt : null,
    completedAt: typeof turn.completedAt === "number" ? turn.completedAt : null,
  };
}

function isWaitingStatus(status: AgentPublicStatus): boolean {
  return status === "waiting_approval" || status === "waiting_input";
}

function getSubAgentSource(source: unknown): unknown {
  if (!isObject(source) || !("subAgent" in source)) {
    return null;
  }
  return source.subAgent ?? null;
}

function getObjectProperty(value: unknown, key: string): Record<string, unknown> | null {
  if (!isObject(value)) {
    return null;
  }
  const child = value[key];
  return isObject(child) ? child : null;
}

function getStringProperty(value: unknown, key: string): string | null {
  if (!isObject(value)) {
    return null;
  }
  const child = value[key];
  return typeof child === "string" && child.length > 0 ? child : null;
}

function firstNonEmpty(values: Array<string | null>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "unknown";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 5: Run mapper tests**

Run:

```bash
node --test tests/domain/mapper.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/types.ts src/domain/mapper.ts tests/domain/mapper.test.ts
git commit -m "feat: map app server threads to agent status"
```

---

### Task 3: In-Memory Status Store

**Files:**
- Create: `src/store/status-store.ts`
- Create: `tests/store/status-store.test.ts`

- [ ] **Step 1: Write failing StatusStore tests**

Create `tests/store/status-store.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { StatusStore } from "../../src/store/status-store.ts";
import type { AppServerThread } from "../../src/domain/types.ts";

function thread(id: string, status: AppServerThread["status"], cwd = "/repo"): AppServerThread {
  return {
    id,
    sessionId: `session-${id}`,
    forkedFromId: null,
    preview: `Preview ${id}`,
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    status,
    path: null,
    cwd,
    cliVersion: "0.135.0",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

test("ingests initial threads and computes summary", () => {
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => 1000 });

  store.replaceThreads([
    thread("idle-1", { type: "idle" }),
    thread("work-1", { type: "active", activeFlags: [] }),
    thread("approval-1", { type: "active", activeFlags: ["waitingOnApproval"] }),
  ]);

  const snapshot = store.getStatus();
  assert.equal(snapshot.summary.total, 3);
  assert.equal(snapshot.summary.idle, 1);
  assert.equal(snapshot.summary.working, 1);
  assert.equal(snapshot.summary.waitingApproval, 1);
});

test("filters agents by status, kind, and cwd", () => {
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => 1000 });
  const sub = thread("sub-1", { type: "active", activeFlags: [] }, "/other");
  sub.agentRole = "builder";

  store.replaceThreads([thread("idle-1", { type: "idle" }, "/repo"), sub]);

  assert.deepEqual(store.getAgents({ status: "working" }).map((agent) => agent.id), ["sub-1"]);
  assert.deepEqual(store.getAgents({ kind: "sub_agent" }).map((agent) => agent.id), ["sub-1"]);
  assert.deepEqual(store.getAgents({ cwd: "/repo" }).map((agent) => agent.id), ["idle-1"]);
});

test("updates a single thread and emits agent.updated", () => {
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => 1000 });
  const events: unknown[] = [];
  store.on("event", (event) => events.push(event));

  store.replaceThreads([thread("one", { type: "idle" })]);
  store.upsertThread(thread("one", { type: "active", activeFlags: ["waitingOnUserInput"] }));

  assert.equal(store.getAgent("one")?.status, "waiting_input");
  assert.deepEqual(events.at(-1), {
    type: "agent.updated",
    agentId: "one",
    status: "waiting_input",
    at: 1000,
  });
});

test("preserves waitingSince across same waiting status", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });

  store.upsertThread(thread("one", { type: "active", activeFlags: ["waitingOnApproval"] }));
  now = 2000;
  store.upsertThread(thread("one", { type: "active", activeFlags: ["waitingOnApproval"] }));

  assert.equal(store.getAgent("one")?.waitingSince, 1000);
});

test("marks stale agents when disconnected beyond staleAfterMs", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 5000, now: () => now });

  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);
  store.setAppServerConnection({ connected: false, lastError: "lost connection" });
  now = 7001;
  store.markStaleAgents();

  assert.equal(store.getAgent("one")?.stale, true);
  assert.equal(store.getHealth().appServer.connected, false);
  assert.equal(store.getHealth().appServer.lastError, "lost connection");
});

test("applies turn lifecycle notifications to lastTurn", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);

  now = 2000;
  store.applyNotification({
    method: "turn/started",
    params: { threadId: "one", turn: { status: "inProgress", startedAt: 2000 } },
  });
  assert.deepEqual(store.getAgent("one")?.lastTurn, {
    status: "inProgress",
    startedAt: 2000,
    completedAt: null,
  });

  now = 3000;
  store.applyNotification({
    method: "turn/completed",
    params: { threadId: "one", turn: { status: "completed", completedAt: 3000 } },
  });
  assert.deepEqual(store.getAgent("one")?.lastTurn, {
    status: "completed",
    startedAt: 2000,
    completedAt: 3000,
  });
});

test("applies item lifecycle notifications by refreshing lastEventAt", () => {
  let now = 1000;
  const store = new StatusStore({ staleAfterMs: 30_000, now: () => now });
  store.replaceThreads([thread("one", { type: "active", activeFlags: [] })]);

  now = 4000;
  store.applyNotification({ method: "item/started", params: { threadId: "one" } });
  assert.equal(store.getAgent("one")?.lastEventAt, 4000);

  now = 5000;
  store.applyNotification({ method: "serverRequest/resolved", params: { threadId: "one" } });
  assert.equal(store.getAgent("one")?.lastEventAt, 5000);
});
```

- [ ] **Step 2: Run store tests to verify they fail**

Run:

```bash
node --test tests/store/status-store.test.ts
```

Expected: FAIL with a module-not-found error for `src/store/status-store.ts`.

- [ ] **Step 3: Add StatusStore implementation**

Create `src/store/status-store.ts`:

```ts
import { EventEmitter } from "node:events";
import { VERSION } from "../version.ts";
import { mapThreadStatus, normalizeThread } from "../domain/mapper.ts";
import type {
  AgentKind,
  AgentLastTurn,
  AgentPublicStatus,
  AgentStatus,
  AppServerThread,
} from "../domain/types.ts";

export type StatusSummary = {
  total: number;
  working: number;
  idle: number;
  waitingApproval: number;
  waitingInput: number;
  error: number;
  unknown: number;
};

export type StatusSnapshot = {
  generatedAt: number;
  summary: StatusSummary;
  agents: AgentStatus[];
};

export type AgentFilters = {
  status?: AgentPublicStatus;
  kind?: AgentKind;
  cwd?: string;
};

export type StoreEvent = {
  type: "agent.updated";
  agentId: string;
  status: AgentPublicStatus;
  at: number;
};

export type StoreNotification = {
  method: string;
  params?: unknown;
};

export type HealthSnapshot = {
  ok: boolean;
  daemon: {
    version: string;
    startedAt: number;
  };
  appServer: {
    connected: boolean;
    autoStarted: boolean;
    mode: "external-daemon" | "managed-child" | "unknown";
    cliVersion: string | null;
    lastConnectedAt: number | null;
    lastError: string | null;
  };
};

export type StoreOptions = {
  staleAfterMs: number;
  now: () => number;
  startedAt?: number;
};

export class StatusStore extends EventEmitter {
  readonly #agents = new Map<string, AgentStatus>();
  readonly #staleAfterMs: number;
  readonly #now: () => number;
  readonly #health: HealthSnapshot;

  constructor(options: StoreOptions) {
    super();
    this.#staleAfterMs = options.staleAfterMs;
    this.#now = options.now;
    this.#health = {
      ok: true,
      daemon: {
        version: VERSION,
        startedAt: options.startedAt ?? options.now(),
      },
      appServer: {
        connected: false,
        autoStarted: false,
        mode: "unknown",
        cliVersion: null,
        lastConnectedAt: null,
        lastError: null,
      },
    };
  }

  replaceThreads(threads: AppServerThread[]): void {
    const next = new Map<string, AgentStatus>();
    const nowMs = this.#now();
    for (const thread of threads) {
      next.set(thread.id, normalizeThread(thread, { nowMs, previous: this.#agents.get(thread.id) }));
    }
    this.#agents.clear();
    for (const [id, agent] of next) {
      this.#agents.set(id, agent);
      this.#emitAgentUpdated(agent);
    }
  }

  upsertThread(thread: AppServerThread): AgentStatus {
    const agent = normalizeThread(thread, {
      nowMs: this.#now(),
      previous: this.#agents.get(thread.id),
    });
    this.#agents.set(agent.id, agent);
    this.#emitAgentUpdated(agent);
    return agent;
  }

  applyNotification(notification: StoreNotification): void {
    if (notification.method === "thread/status/changed") {
      this.#applyThreadStatusChanged(notification.params);
      return;
    }

    if (notification.method === "turn/started" || notification.method === "turn/completed") {
      this.#applyTurnNotification(notification.params);
      return;
    }

    if (
      notification.method === "item/started" ||
      notification.method === "item/completed" ||
      notification.method === "serverRequest/resolved"
    ) {
      this.#touchAgent(notification.params);
    }
  }

  getStatus(): StatusSnapshot {
    const agents = this.getAgents();
    return {
      generatedAt: this.#now(),
      summary: summarizeAgents(agents),
      agents,
    };
  }

  getAgents(filters: AgentFilters = {}): AgentStatus[] {
    return [...this.#agents.values()]
      .filter((agent) => !filters.status || agent.status === filters.status)
      .filter((agent) => !filters.kind || agent.kind === filters.kind)
      .filter((agent) => !filters.cwd || agent.cwd === filters.cwd)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  getAgent(id: string): AgentStatus | null {
    return this.#agents.get(id) ?? null;
  }

  setAppServerConnection(input: {
    connected: boolean;
    autoStarted?: boolean;
    mode?: HealthSnapshot["appServer"]["mode"];
    cliVersion?: string | null;
    lastError?: string | null;
  }): void {
    this.#health.appServer.connected = input.connected;
    if (typeof input.autoStarted === "boolean") {
      this.#health.appServer.autoStarted = input.autoStarted;
    }
    if (input.mode) {
      this.#health.appServer.mode = input.mode;
    }
    if (input.cliVersion !== undefined) {
      this.#health.appServer.cliVersion = input.cliVersion;
    }
    this.#health.appServer.lastError = input.lastError ?? null;
    if (input.connected) {
      this.#health.appServer.lastConnectedAt = this.#now();
    }
  }

  getHealth(): HealthSnapshot {
    return structuredClone(this.#health);
  }

  markStaleAgents(): void {
    if (this.#health.appServer.connected) {
      return;
    }
    const nowMs = this.#now();
    for (const [id, agent] of this.#agents) {
      if (!agent.stale && nowMs - agent.lastEventAt > this.#staleAfterMs) {
        this.#agents.set(id, { ...agent, stale: true });
      }
    }
  }

  #applyThreadStatusChanged(params: unknown): void {
    if (!isObject(params) || typeof params.threadId !== "string" || !("status" in params)) {
      return;
    }
    const current = this.#agents.get(params.threadId);
    if (!current) {
      return;
    }
    const nextStatus = mapThreadStatus(params.status, current.lastTurn);
    const waitingSince =
      nextStatus === "waiting_approval" || nextStatus === "waiting_input"
        ? current.status === nextStatus
          ? current.waitingSince
          : this.#now()
        : null;
    const updated = {
      ...current,
      status: nextStatus,
      rawStatus: params.status,
      waitingSince,
      lastEventAt: this.#now(),
      stale: false,
    };
    this.#agents.set(updated.id, updated);
    this.#emitAgentUpdated(updated);
  }

  #applyTurnNotification(params: unknown): void {
    if (!isObject(params) || typeof params.threadId !== "string") {
      return;
    }
    const current = this.#agents.get(params.threadId);
    if (!current) {
      return;
    }
    const turn = isObject(params.turn) ? params.turn : params;
    const previousTurn = current.lastTurn;
    const nextTurn: AgentLastTurn = {
      status: readTurnStatus(turn.status),
      startedAt: readNumber(turn.startedAt) ?? previousTurn?.startedAt ?? null,
      completedAt: readNumber(turn.completedAt) ?? null,
    };
    const updated = {
      ...current,
      lastTurn: nextTurn,
      status: nextTurn.status === "failed" ? "error" : current.status,
      lastEventAt: this.#now(),
      stale: false,
    } satisfies AgentStatus;
    this.#agents.set(updated.id, updated);
    this.#emitAgentUpdated(updated);
  }

  #touchAgent(params: unknown): void {
    if (!isObject(params) || typeof params.threadId !== "string") {
      return;
    }
    const current = this.#agents.get(params.threadId);
    if (!current) {
      return;
    }
    this.#agents.set(current.id, {
      ...current,
      lastEventAt: this.#now(),
      stale: false,
    });
  }

  #emitAgentUpdated(agent: AgentStatus): void {
    this.emit("event", {
      type: "agent.updated",
      agentId: agent.id,
      status: agent.status,
      at: this.#now(),
    } satisfies StoreEvent);
  }
}

function summarizeAgents(agents: AgentStatus[]): StatusSummary {
  const summary: StatusSummary = {
    total: agents.length,
    working: 0,
    idle: 0,
    waitingApproval: 0,
    waitingInput: 0,
    error: 0,
    unknown: 0,
  };

  for (const agent of agents) {
    if (agent.status === "working") summary.working += 1;
    else if (agent.status === "idle") summary.idle += 1;
    else if (agent.status === "waiting_approval") summary.waitingApproval += 1;
    else if (agent.status === "waiting_input") summary.waitingInput += 1;
    else if (agent.status === "error") summary.error += 1;
    else if (agent.status === "unknown") summary.unknown += 1;
  }

  return summary;
}

function readTurnStatus(value: unknown): AgentLastTurn["status"] {
  return value === "completed" || value === "interrupted" || value === "failed" || value === "inProgress"
    ? value
    : "unknown";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 4: Run store tests**

Run:

```bash
node --test tests/store/status-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/status-store.ts tests/store/status-store.test.ts
git commit -m "feat: add in-memory status store"
```

---

### Task 4: Configuration And CLI Argument Parsing

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `tests/config.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, parseArgs } from "../src/config.ts";

test("DEFAULT_CONFIG matches the design defaults", () => {
  assert.deepEqual(DEFAULT_CONFIG, {
    host: "127.0.0.1",
    port: 17345,
    autoStartAppServer: true,
    refreshIntervalMs: 5000,
    staleAfterMs: 30000,
  });
});

test("parseArgs parses daemon defaults", () => {
  assert.deepEqual(parseArgs(["daemon"]), {
    command: "daemon",
    config: DEFAULT_CONFIG,
  });
});

test("parseArgs overrides host, port, refresh interval, and auto-start", () => {
  assert.deepEqual(
    parseArgs([
      "daemon",
      "--host",
      "0.0.0.0",
      "--port",
      "18000",
      "--no-start-app-server",
      "--refresh-interval-ms",
      "2000",
      "--stale-after-ms",
      "10000",
    ]),
    {
      command: "daemon",
      config: {
        host: "0.0.0.0",
        port: 18000,
        autoStartAppServer: false,
        refreshIntervalMs: 2000,
        staleAfterMs: 10000,
      },
    },
  );
});

test("parseArgs rejects unknown commands and invalid numbers", () => {
  assert.throws(() => parseArgs(["unknown"]), /Unknown command/);
  assert.throws(() => parseArgs(["daemon", "--port", "abc"]), /Invalid number for --port/);
});
```

- [ ] **Step 2: Run config tests to verify they fail**

Run:

```bash
node --test tests/config.test.ts
```

Expected: FAIL with a module-not-found error for `src/config.ts`.

- [ ] **Step 3: Add config parser**

Create `src/config.ts`:

```ts
export type DaemonConfig = {
  host: string;
  port: number;
  autoStartAppServer: boolean;
  refreshIntervalMs: number;
  staleAfterMs: number;
};

export type ParsedArgs = {
  command: "daemon";
  config: DaemonConfig;
};

export const DEFAULT_CONFIG: DaemonConfig = {
  host: "127.0.0.1",
  port: 17345,
  autoStartAppServer: true,
  refreshIntervalMs: 5000,
  staleAfterMs: 30000,
};

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command || command !== "daemon") {
    throw new Error(`Unknown command: ${command ?? ""}. Expected "daemon".`);
  }

  const config = { ...DEFAULT_CONFIG };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--host") {
      config.host = readValue(rest, ++index, arg);
    } else if (arg === "--port") {
      config.port = readNumber(rest, ++index, arg);
    } else if (arg === "--no-start-app-server") {
      config.autoStartAppServer = false;
    } else if (arg === "--refresh-interval-ms") {
      config.refreshIntervalMs = readNumber(rest, ++index, arg);
    } else if (arg === "--stale-after-ms") {
      config.staleAfterMs = readNumber(rest, ++index, arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { command: "daemon", config };
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function readNumber(args: string[], index: number, flag: string): number {
  const raw = readValue(args, index, flag);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${flag}: ${raw}`);
  }
  return parsed;
}
```

- [ ] **Step 4: Run config tests**

Run:

```bash
node --test tests/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: parse daemon configuration"
```

---

### Task 5: HTTP JSON And SSE API

**Files:**
- Create: `src/http/api.ts`
- Create: `tests/http/api.test.ts`

- [ ] **Step 1: Write failing HTTP API tests**

Create `tests/http/api.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { StatusStore } from "../../src/store/status-store.ts";
import { createHttpApi } from "../../src/http/api.ts";
import type { AppServerThread } from "../../src/domain/types.ts";

function thread(id: string, status: AppServerThread["status"]): AppServerThread {
  return {
    id,
    sessionId: `session-${id}`,
    forkedFromId: null,
    preview: `Preview ${id}`,
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    status,
    path: null,
    cwd: "/repo",
    cliVersion: "0.135.0",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

async function withServer(run: (baseUrl: string, store: StatusStore) => Promise<void>) {
  const store = new StatusStore({ staleAfterMs: 30000, now: () => 1000 });
  store.setAppServerConnection({
    connected: true,
    autoStarted: true,
    mode: "managed-child",
    cliVersion: "0.135.0",
  });
  store.replaceThreads([
    thread("idle-1", { type: "idle" }),
    thread("work-1", { type: "active", activeFlags: [] }),
  ]);
  const api = createHttpApi({ host: "127.0.0.1", port: 0, store });
  await api.start();
  try {
    await run(api.url(), store);
  } finally {
    await api.stop();
  }
}

test("GET /health returns health JSON", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.appServer.connected, true);
  });
});

test("GET /status and /agents return snapshots", async () => {
  await withServer(async (baseUrl) => {
    const status = await (await fetch(`${baseUrl}/status`)).json();
    assert.equal(status.summary.total, 2);
    assert.equal(status.summary.working, 1);

    const agents = await (await fetch(`${baseUrl}/agents?status=working`)).json();
    assert.deepEqual(agents.map((agent: { id: string }) => agent.id), ["work-1"]);
  });
});

test("GET /agents/:id returns one agent or JSON 404", async () => {
  await withServer(async (baseUrl) => {
    const found = await fetch(`${baseUrl}/agents/idle-1`);
    assert.equal(found.status, 200);
    assert.equal((await found.json()).id, "idle-1");

    const missing = await fetch(`${baseUrl}/agents/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "agent_not_found", id: "missing" });
  });
});

test("GET /events streams agent.updated events", async () => {
  await withServer(async (baseUrl, store) => {
    const abort = new AbortController();
    const response = await fetch(`${baseUrl}/events`, { signal: abort.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");

    const reader = response.body!.getReader();
    store.upsertThread(thread("work-1", { type: "active", activeFlags: ["waitingOnApproval"] }));
    const { value } = await reader.read();
    abort.abort();

    const chunk = new TextDecoder().decode(value);
    assert.match(chunk, /event: agent.updated/);
    assert.match(chunk, /"agentId":"work-1"/);
    await new Promise((resolve) => setImmediate(resolve));
  });
});
```

- [ ] **Step 2: Run HTTP tests to verify they fail**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: FAIL with a module-not-found error for `src/http/api.ts`.

- [ ] **Step 3: Add HTTP API implementation**

Create `src/http/api.ts`:

```ts
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentFilters, StatusStore, StoreEvent } from "../store/status-store.ts";

export type HttpApiOptions = {
  host: string;
  port: number;
  store: StatusStore;
};

export type HttpApi = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  url: () => string;
};

export function createHttpApi(options: HttpApiOptions): HttpApi {
  const sseClients = new Set<http.ServerResponse>();
  const server = http.createServer((request, response) => {
    void handleRequest(options.store, sseClients, request, response);
  });

  const onStoreEvent = (event: StoreEvent) => {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  };

  options.store.on("event", onStoreEvent);

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          server.off("error", reject);
          resolve();
        });
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        options.store.off("event", onStoreEvent);
        for (const client of sseClients) {
          client.end();
        }
        sseClients.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: () => {
      const address = server.address() as AddressInfo;
      return `http://${address.address}:${address.port}`;
    },
  };
}

async function handleRequest(
  store: StatusStore,
  sseClients: Set<http.ServerResponse>,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (url.pathname === "/health") {
    sendJson(response, 200, store.getHealth());
    return;
  }

  if (url.pathname === "/status") {
    sendJson(response, 200, store.getStatus());
    return;
  }

  if (url.pathname === "/agents") {
    sendJson(response, 200, store.getAgents(parseFilters(url)));
    return;
  }

  if (url.pathname.startsWith("/agents/")) {
    const id = decodeURIComponent(url.pathname.slice("/agents/".length));
    const agent = store.getAgent(id);
    if (!agent) {
      sendJson(response, 404, { error: "agent_not_found", id });
      return;
    }
    sendJson(response, 200, agent);
    return;
  }

  if (url.pathname === "/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    sseClients.add(response);
    request.on("close", () => sseClients.delete(response));
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

function parseFilters(url: URL): AgentFilters {
  const filters: AgentFilters = {};
  const status = url.searchParams.get("status");
  const kind = url.searchParams.get("kind");
  const cwd = url.searchParams.get("cwd");
  if (status) filters.status = status as AgentFilters["status"];
  if (kind) filters.kind = kind as AgentFilters["kind"];
  if (cwd) filters.cwd = cwd;
  return filters;
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
```

- [ ] **Step 4: Run HTTP tests**

Run:

```bash
node --test tests/http/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/http/api.ts tests/http/api.test.ts
git commit -m "feat: expose read-only status http api"
```

---

### Task 6: JSON-RPC Stdio Transport

**Files:**
- Create: `src/app-server/json-rpc.ts`
- Create: `tests/app-server/json-rpc.test.ts`

- [ ] **Step 1: Write failing JSON-RPC transport tests**

Create `tests/app-server/json-rpc.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { JsonRpcStdioClient } from "../../src/app-server/json-rpc.ts";

function fakeProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  return {
    stdin,
    stdout,
    stderr,
    kill: () => true,
    on: events.on.bind(events),
    once: events.once.bind(events),
    emit: events.emit.bind(events),
    written: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of stdin) {
        chunks.push(Buffer.from(chunk));
        break;
      }
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

test("request writes newline-delimited JSON and resolves matching response", async () => {
  const proc = fakeProcess();
  const client = new JsonRpcStdioClient(proc);
  const request = client.request("thread/list", { limit: 1 });

  const written = await proc.written();
  assert.match(written, /"method":"thread\/list"/);
  const parsed = JSON.parse(written);
  proc.stdout.write(`${JSON.stringify({ id: parsed.id, result: { data: [], nextCursor: null } })}\n`);

  assert.deepEqual(await request, { data: [], nextCursor: null });
});

test("notifications are emitted without resolving a request", async () => {
  const proc = fakeProcess();
  const client = new JsonRpcStdioClient(proc);
  const notifications: unknown[] = [];
  client.on("notification", (message) => notifications.push(message));

  proc.stdout.write(`${JSON.stringify({ method: "thread/status/changed", params: { threadId: "one" } })}\n`);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(notifications, [
    { method: "thread/status/changed", params: { threadId: "one" } },
  ]);
});

test("JSON-RPC error rejects the matching request", async () => {
  const proc = fakeProcess();
  const client = new JsonRpcStdioClient(proc);
  const request = client.request("thread/list", {});
  const written = JSON.parse(await proc.written());

  proc.stdout.write(
    `${JSON.stringify({ id: written.id, error: { code: -32601, message: "method not found" } })}\n`,
  );

  await assert.rejects(request, /method not found/);
});
```

- [ ] **Step 2: Run JSON-RPC tests to verify they fail**

Run:

```bash
node --test tests/app-server/json-rpc.test.ts
```

Expected: FAIL with a module-not-found error for `src/app-server/json-rpc.ts`.

- [ ] **Step 3: Add newline-delimited JSON-RPC implementation**

Create `src/app-server/json-rpc.ts`:

```ts
import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export type JsonRpcProcess = Pick<ChildProcessWithoutNullStreams, "kill" | "on" | "once"> & {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
};

export type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class JsonRpcStdioClient extends EventEmitter {
  readonly #process: JsonRpcProcess;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #stdoutBuffer = "";
  #stderrBuffer = "";

  constructor(process: JsonRpcProcess) {
    super();
    this.#process = process;
    process.stdout.on("data", (chunk) => this.#onStdout(chunk));
    process.stderr.on("data", (chunk) => this.#onStderr(chunk));
    process.on("exit", (code, signal) => {
      const error = new Error(`App Server process exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
      for (const pending of this.#pending.values()) {
        pending.reject(error);
      }
      this.#pending.clear();
      this.emit("close", { code, signal });
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.#process.stdin.write(`${payload}\n`);

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  close(): void {
    this.#process.kill("SIGTERM");
  }

  #onStdout(chunk: Buffer | string): void {
    this.#stdoutBuffer += chunk.toString();
    let newlineIndex = this.#stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.#stdoutBuffer.slice(0, newlineIndex).trim();
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.#handleMessage(line);
      }
      newlineIndex = this.#stdoutBuffer.indexOf("\n");
    }
  }

  #onStderr(chunk: Buffer | string): void {
    this.#stderrBuffer += chunk.toString();
    this.emit("stderr", chunk.toString());
  }

  #handleMessage(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("protocolError", error);
      return;
    }

    if ("id" in message && this.#pending.has(Number(message.id))) {
      const pending = this.#pending.get(Number(message.id))!;
      this.#pending.delete(Number(message.id));
      if ("error" in message) {
        pending.reject(new Error(readErrorMessage(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string") {
      this.emit("notification", { method: message.method, params: message.params } satisfies JsonRpcNotification);
    }
  }
}

function readErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "JSON-RPC request failed";
}
```

- [ ] **Step 4: Run JSON-RPC tests**

Run:

```bash
node --test tests/app-server/json-rpc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app-server/json-rpc.ts tests/app-server/json-rpc.test.ts
git commit -m "feat: add app server json rpc transport"
```

---

### Task 7: App Server Supervisor And Read-Only Client

**Files:**
- Create: `src/app-server/supervisor.ts`
- Create: `src/app-server/client.ts`
- Create: `tests/app-server/supervisor.test.ts`
- Create: `tests/app-server/client.test.ts`

- [ ] **Step 1: Write failing supervisor tests**

Create `tests/app-server/supervisor.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createAppServerSupervisor } from "../../src/app-server/supervisor.ts";

test("supervisor falls back to managed child when daemon start is unsupported", async () => {
  const calls: string[][] = [];
  const supervisor = createAppServerSupervisor({
    spawnCommand: async (command, args) => {
      calls.push([command, ...args]);
      if (args.join(" ") === "app-server daemon start") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "managed standalone Codex install not found",
        };
      }
      if (args.join(" ") === "--version") {
        return { exitCode: 0, stdout: "codex-cli 0.135.0\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    spawnLongRunning: (command, args) => ({ command, args, pid: 123, kill: () => true }),
  });

  const result = await supervisor.start({ autoStartAppServer: true });

  assert.equal(result.mode, "managed-child");
  assert.equal(result.cliVersion, "codex-cli 0.135.0");
  assert.deepEqual(calls.map((call) => call.join(" ")), [
    "codex --version",
    "codex app-server daemon start",
  ]);
});

test("supervisor uses proxy when daemon start succeeds", async () => {
  const longRunning: string[][] = [];
  const supervisor = createAppServerSupervisor({
    spawnCommand: async (command, args) => {
      if (args.join(" ") === "--version") {
        return { exitCode: 0, stdout: "codex-cli 0.135.0\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    spawnLongRunning: (command, args) => {
      longRunning.push([command, ...args]);
      return { command, args, pid: 123, kill: () => true };
    },
  });

  const result = await supervisor.start({ autoStartAppServer: true });

  assert.equal(result.mode, "external-daemon");
  assert.deepEqual(longRunning.map((call) => call.join(" ")), ["codex app-server proxy"]);
});

test("supervisor fails when no-start mode cannot proxy", async () => {
  const supervisor = createAppServerSupervisor({
    spawnCommand: async (command, args) => {
      if (args.join(" ") === "--version") {
        return { exitCode: 0, stdout: "codex-cli 0.135.0\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    spawnLongRunning: () => {
      throw new Error("proxy unavailable");
    },
  });

  await assert.rejects(() => supervisor.start({ autoStartAppServer: false }), /proxy unavailable/);
});
```

- [ ] **Step 2: Write failing client tests**

Create `tests/app-server/client.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AppServerClient } from "../../src/app-server/client.ts";

class FakeRpc extends EventEmitter {
  requests: Array<{ method: string; params: unknown }> = [];
  responses = new Map<string, unknown>();

  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    return this.responses.get(method);
  }
}

test("client initializes and fetches all thread pages", async () => {
  const rpc = new FakeRpc();
  rpc.responses.set("initialize", { userAgent: "codex", codexHome: "/home/me/.codex" });
  rpc.responses.set("thread/list", {
    data: [],
    nextCursor: null,
    backwardsCursor: null,
  });
  rpc.responses.set("thread/loaded/list", { data: ["one"], nextCursor: null });

  const client = new AppServerClient(rpc);
  await client.initialize();
  const state = await client.readInitialState();

  assert.deepEqual(state, { threads: [], loadedThreadIds: ["one"] });
  assert.deepEqual(rpc.requests.map((request) => request.method), [
    "initialize",
    "thread/list",
    "thread/loaded/list",
  ]);
});

test("client emits normalized notifications", async () => {
  const rpc = new FakeRpc();
  const client = new AppServerClient(rpc);
  const notifications: unknown[] = [];
  client.on("notification", (notification) => notifications.push(notification));

  rpc.emit("notification", {
    method: "thread/status/changed",
    params: { threadId: "one", status: { type: "idle" } },
  });

  assert.deepEqual(notifications, [
    { method: "thread/status/changed", params: { threadId: "one", status: { type: "idle" } } },
  ]);
});
```

- [ ] **Step 3: Run supervisor and client tests to verify they fail**

Run:

```bash
node --test tests/app-server/supervisor.test.ts tests/app-server/client.test.ts
```

Expected: FAIL with module-not-found errors for `supervisor.ts` and `client.ts`.

- [ ] **Step 4: Add supervisor implementation**

Create `src/app-server/supervisor.ts`:

```ts
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LongRunningProcess =
  | ChildProcessWithoutNullStreams
  | {
      command: string;
      args: string[];
      pid: number;
      kill: (signal?: NodeJS.Signals) => boolean;
    };

export type SupervisorDeps = {
  spawnCommand: (command: string, args: string[]) => Promise<CommandResult>;
  spawnLongRunning: (command: string, args: string[]) => LongRunningProcess;
};

export type AppServerProcess = {
  mode: "external-daemon" | "managed-child";
  cliVersion: string;
  process: LongRunningProcess;
  stop: () => void;
};

export type AppServerSupervisor = {
  start: (options: { autoStartAppServer: boolean }) => Promise<AppServerProcess>;
};

export function createAppServerSupervisor(deps: SupervisorDeps = defaultDeps()): AppServerSupervisor {
  return {
    async start(options) {
      const version = await deps.spawnCommand("codex", ["--version"]);
      if (version.exitCode !== 0) {
        throw new Error(`codex --version failed: ${version.stderr || version.stdout}`);
      }
      const cliVersion = version.stdout.trim();

      if (!options.autoStartAppServer) {
        const proxy = deps.spawnLongRunning("codex", ["app-server", "proxy"]);
        return {
          mode: "external-daemon",
          cliVersion,
          process: proxy,
          stop: () => proxy.kill("SIGTERM"),
        };
      }

      const daemon = await deps.spawnCommand("codex", ["app-server", "daemon", "start"]);
      if (daemon.exitCode === 0) {
        const proxy = deps.spawnLongRunning("codex", ["app-server", "proxy"]);
        return {
          mode: "external-daemon",
          cliVersion,
          process: proxy,
          stop: () => proxy.kill("SIGTERM"),
        };
      }

      if (!isUnsupportedDaemonInstall(daemon.stderr)) {
        throw new Error(`codex app-server daemon start failed: ${daemon.stderr || daemon.stdout}`);
      }

      const child = deps.spawnLongRunning("codex", ["app-server", "--listen", "stdio://"]);
      return {
        mode: "managed-child",
        cliVersion,
        process: child,
        stop: () => child.kill("SIGTERM"),
      };
    },
  };
}

function isUnsupportedDaemonInstall(stderr: string): boolean {
  return stderr.includes("managed standalone Codex install not found");
}

function defaultDeps(): SupervisorDeps {
  return {
    spawnCommand: (command, args) =>
      new Promise((resolve) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
        child.on("close", (code) =>
          resolve({
            exitCode: code ?? 1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          }),
        );
      }),
    spawnLongRunning: (command, args) => spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] }),
  };
}
```

- [ ] **Step 5: Add read-only AppServerClient**

Create `src/app-server/client.ts`:

```ts
import { EventEmitter } from "node:events";
import type { AppServerThread } from "../domain/types.ts";

export type RpcLike = EventEmitter & {
  request: (method: string, params: unknown) => Promise<unknown>;
};

export type AppServerNotification = {
  method: string;
  params?: unknown;
};

export type InitialAppServerState = {
  threads: AppServerThread[];
  loadedThreadIds: string[];
};

export class AppServerClient extends EventEmitter {
  readonly #rpc: RpcLike;

  constructor(rpc: RpcLike) {
    super();
    this.#rpc = rpc;
    this.#rpc.on("notification", (notification) => {
      this.emit("notification", notification as AppServerNotification);
    });
  }

  async initialize(): Promise<unknown> {
    return await this.#rpc.request("initialize", {
      clientInfo: { name: "codex-status", version: "0.1.0" },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
  }

  async readInitialState(): Promise<InitialAppServerState> {
    const threads = await this.#readAllThreads();
    const loadedThreadIds = await this.#readAllLoadedThreadIds();
    return { threads, loadedThreadIds };
  }

  async #readAllThreads(): Promise<AppServerThread[]> {
    const all: AppServerThread[] = [];
    let cursor: string | null = null;
    do {
      const response = (await this.#rpc.request("thread/list", {
        cursor,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: [
          "cli",
          "vscode",
          "exec",
          "appServer",
          "subAgent",
          "subAgentReview",
          "subAgentCompact",
          "subAgentThreadSpawn",
          "subAgentOther",
          "unknown",
        ],
        archived: false,
      })) as { data?: AppServerThread[]; nextCursor?: string | null };
      all.push(...(response.data ?? []));
      cursor = response.nextCursor ?? null;
    } while (cursor);
    return all;
  }

  async #readAllLoadedThreadIds(): Promise<string[]> {
    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const response = (await this.#rpc.request("thread/loaded/list", {
        cursor,
        limit: 100,
      })) as { data?: string[]; nextCursor?: string | null };
      all.push(...(response.data ?? []));
      cursor = response.nextCursor ?? null;
    } while (cursor);
    return all;
  }
}
```

- [ ] **Step 6: Run supervisor and client tests**

Run:

```bash
node --test tests/app-server/supervisor.test.ts tests/app-server/client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app-server/supervisor.ts src/app-server/client.ts tests/app-server/supervisor.test.ts tests/app-server/client.test.ts
git commit -m "feat: supervise and read app server state"
```

---

### Task 8: Daemon Composition And CLI Entrypoint

**Files:**
- Create: `src/daemon.ts`
- Create: `src/cli.ts`
- Create: `tests/daemon.test.ts`

- [ ] **Step 1: Write failing daemon composition test**

Create `tests/daemon.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { startDaemon } from "../src/daemon.ts";

test("startDaemon wires supervisor, client, store, and http api", async () => {
  const calls: string[] = [];
  const daemon = await startDaemon({
    config: {
      host: "127.0.0.1",
      port: 0,
      autoStartAppServer: true,
      refreshIntervalMs: 100,
      staleAfterMs: 1000,
    },
    now: () => 1000,
    supervisor: {
      async start() {
        calls.push("supervisor.start");
        return {
          mode: "managed-child",
          cliVersion: "codex-cli 0.135.0",
          process: { kill: () => true },
          stop: () => calls.push("appServer.stop"),
        };
      },
    },
    clientFactory: () => ({
      on() {},
      async initialize() {
        calls.push("client.initialize");
      },
      async readInitialState() {
        calls.push("client.readInitialState");
        return {
          loadedThreadIds: [],
          threads: [
            {
              id: "one",
              sessionId: "session-one",
              forkedFromId: null,
              preview: "Preview",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 2,
              status: { type: "idle" },
              path: null,
              cwd: "/repo",
              cliVersion: "0.135.0",
              source: "cli",
              threadSource: null,
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [],
            },
          ],
        };
      },
    }),
  });

  const health = await (await fetch(`${daemon.url}/health`)).json();
  assert.equal(health.appServer.connected, true);

  const status = await (await fetch(`${daemon.url}/status`)).json();
  assert.equal(status.summary.total, 1);

  await daemon.stop();
  assert.deepEqual(calls, [
    "supervisor.start",
    "client.initialize",
    "client.readInitialState",
    "appServer.stop",
  ]);
});
```

- [ ] **Step 2: Run daemon test to verify it fails**

Run:

```bash
node --test tests/daemon.test.ts
```

Expected: FAIL with a module-not-found error for `src/daemon.ts`.

- [ ] **Step 3: Add daemon composition**

Create `src/daemon.ts`:

```ts
import { createAppServerSupervisor } from "./app-server/supervisor.ts";
import { JsonRpcStdioClient } from "./app-server/json-rpc.ts";
import { AppServerClient } from "./app-server/client.ts";
import { StatusStore } from "./store/status-store.ts";
import { createHttpApi } from "./http/api.ts";
import type { DaemonConfig } from "./config.ts";
import type { AppServerSupervisor, AppServerProcess } from "./app-server/supervisor.ts";
import type { InitialAppServerState } from "./app-server/client.ts";

export type DaemonHandle = {
  url: string;
  stop: () => Promise<void>;
};

export type ClientLike = {
  initialize: () => Promise<unknown>;
  readInitialState: () => Promise<InitialAppServerState>;
  on: (event: "notification", listener: (notification: { method: string; params?: unknown }) => void) => void;
};

export type StartDaemonOptions = {
  config: DaemonConfig;
  now?: () => number;
  supervisor?: AppServerSupervisor;
  clientFactory?: (appServer: AppServerProcess) => ClientLike;
};

export async function startDaemon(options: StartDaemonOptions): Promise<DaemonHandle> {
  const now = options.now ?? Date.now;
  const supervisor = options.supervisor ?? createAppServerSupervisor();
  const store = new StatusStore({
    staleAfterMs: options.config.staleAfterMs,
    now,
    startedAt: now(),
  });

  const appServer = await supervisor.start({
    autoStartAppServer: options.config.autoStartAppServer,
  });
  store.setAppServerConnection({
    connected: true,
    autoStarted: options.config.autoStartAppServer,
    mode: appServer.mode,
    cliVersion: appServer.cliVersion,
  });

  const client =
    options.clientFactory?.(appServer) ??
    new AppServerClient(new JsonRpcStdioClient(appServer.process as never));

  client.on("notification", (notification) => {
    store.applyNotification(notification);
  });

  await client.initialize();
  const initial = await client.readInitialState();
  store.replaceThreads(initial.threads);

  const staleTimer = setInterval(() => store.markStaleAgents(), options.config.refreshIntervalMs);
  const api = createHttpApi({
    host: options.config.host,
    port: options.config.port,
    store,
  });
  await api.start();

  return {
    url: api.url(),
    async stop() {
      clearInterval(staleTimer);
      await api.stop();
      appServer.stop();
    },
  };
}
```

- [ ] **Step 4: Add CLI entrypoint**

Create `src/cli.ts`:

```ts
#!/usr/bin/env node
import { parseArgs } from "./config.ts";
import { startDaemon } from "./daemon.ts";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const daemon = await startDaemon({ config: parsed.config });
  console.log(`codex-status listening at ${daemon.url}`);

  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
```

- [ ] **Step 5: Run daemon test**

Run:

```bash
node --test tests/daemon.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 7: Run CLI help failure check**

Run:

```bash
node src/cli.ts
```

Expected: exits non-zero and prints `Unknown command`.

- [ ] **Step 8: Commit**

```bash
git add src/daemon.ts src/cli.ts tests/daemon.test.ts
git commit -m "feat: wire daemon cli"
```

---

### Task 9: Real App Server Smoke Test And Documentation

**Files:**
- Create: `scripts/smoke-real-app-server.ts`
- Create: `README.md`

- [ ] **Step 1: Add real-environment smoke script**

Create `scripts/smoke-real-app-server.ts`:

```ts
import { startDaemon } from "../src/daemon.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

const daemon = await startDaemon({
  config: {
    ...DEFAULT_CONFIG,
    port: 0,
  },
});

try {
  const health = await (await fetch(`${daemon.url}/health`)).json();
  const status = await (await fetch(`${daemon.url}/status`)).json();

  console.log(JSON.stringify({ health, summary: status.summary }, null, 2));

  if (!health.ok) {
    throw new Error("daemon health is not ok");
  }
  if (typeof status.summary.total !== "number") {
    throw new Error("status summary is missing total");
  }
} finally {
  await daemon.stop();
}
```

- [ ] **Step 2: Add README**

Create `README.md`:

```md
# codex-status

`codex-status` is a local read-only daemon that observes Codex App Server state and exposes a stable JSON API for dashboards and scripts.

## Run

```bash
node src/cli.ts daemon
```

By default the daemon listens on `127.0.0.1:17345` and starts or reuses Codex App Server when possible.

Use a custom port:

```bash
node src/cli.ts daemon --port 18000
```

Connect only to an already-running App Server:

```bash
node src/cli.ts daemon --no-start-app-server
```

## Endpoints

- `GET /health`
- `GET /status`
- `GET /agents`
- `GET /agents/:id`
- `GET /events`

## Tests

Run the default test suite:

```bash
npm test
```

Run the real Codex App Server smoke test:

```bash
npm run smoke:real
```

The smoke test requires a working local `codex` command and may use the Codex App Server daemon or a foreground App Server child process.
```

- [ ] **Step 3: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run real smoke test when local Codex is available**

Run:

```bash
npm run smoke:real
```

Expected: prints JSON with `health.ok: true` and a numeric `summary.total`.

If this fails because local Codex auth or installation is unavailable, capture the stderr in the final implementation report and keep the default test suite as the required verification.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-real-app-server.ts README.md
git commit -m "docs: add smoke test and usage"
```

---

## Final Verification

- [ ] **Step 1: Run the full default test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Check git status**

Run:

```bash
git status --short
```

Expected: no uncommitted files except user-created files that are unrelated to this implementation.

- [ ] **Step 3: Report implementation status**

Include:

- Commits created.
- `npm test` result.
- `npm run smoke:real` result, or the exact reason it was not run successfully.
- Local URL format for manual daemon use: `http://127.0.0.1:17345`.
