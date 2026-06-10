import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { StatusStore } from "../../src/store/status-store.ts";
import { createHttpApi, type HttpApiOptions } from "../../src/http/api.ts";
import type { AppServerThread } from "../../src/domain/types.ts";

const MISSING_UI_ASSET_PATH = fileURLToPath(
  new URL("../../src/ui/__missing_asset_for_test__.js", import.meta.url),
);

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

async function withServer(
  run: (baseUrl: string, store: StatusStore) => Promise<void>,
  apiOptions: Partial<Pick<HttpApiOptions, "uiAssets" | "sessionReader">> = {},
): Promise<void> {
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
  const api = createHttpApi({ host: "127.0.0.1", port: 0, store, ...apiOptions });
  await api.start();
  try {
    await run(api.url(), store);
  } finally {
    await api.stop();
  }
}

async function listenOnEphemeralPort(): Promise<http.Server> {
  const server = http.createServer((_request, response) => response.end("busy"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function sendRawHttpRequest(port: number, request: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw HTTP request timed out"));
    }, 1000);

    socket.on("connect", () => socket.write(request));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("error", reject);
    socket.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
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
    assert.deepEqual(
      agents.map((agent: { id: string }) => agent.id),
      ["work-1"],
    );
  });
});

test("GET /agents filters by activeWithinMs and composes with status", async () => {
  await withServer(async (baseUrl, store) => {
    const oldWorking = thread("old-work", { type: "active", activeFlags: [] });
    oldWorking.updatedAt = 100;
    const recentWorking = thread("recent-work", { type: "active", activeFlags: [] });
    recentWorking.updatedAt = 900;
    const recentIdle = thread("recent-idle", { type: "idle" });
    recentIdle.updatedAt = 950;
    store.replaceThreads([oldWorking, recentWorking, recentIdle]);

    const agents = await (await fetch(`${baseUrl}/agents?status=working&activeWithinMs=200`)).json();

    assert.deepEqual(
      agents.map((agent: { id: string }) => agent.id),
      ["recent-work"],
    );
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

test("GET /agents/:id/session returns agent metadata and Codex session events", async () => {
  const sessionEvents = [
    { type: "session_meta", payload: { id: "session-work-1" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [] } },
  ];

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/agents/work-1/session`);

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.agent.id, "work-1");
      assert.deepEqual(body.events, sessionEvents);
      assert.equal(body.summary.events.total, 2);
      assert.equal(body.summary.events.byType.session_meta, 1);
      assert.equal(body.summary.events.byType.response_item, 1);
      assert.equal(body.summary.messages.roles.user, 1);
      assert.equal(body.summary.tokens.last, null);
    },
    {
      sessionReader: {
        async readAgentSessionEvents(agent) {
          assert.equal(agent.id, "work-1");
          return sessionEvents;
        },
      },
    },
  );
});

test("GET /agents/:id/session returns stable JSON errors", async () => {
  await withServer(async (baseUrl) => {
    const missingAgent = await fetch(`${baseUrl}/agents/missing/session`);
    assert.equal(missingAgent.status, 404);
    assert.deepEqual(await missingAgent.json(), { error: "agent_not_found", id: "missing" });

    const unavailable = await fetch(`${baseUrl}/agents/work-1/session`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), {
      error: "session_reader_unavailable",
      id: "work-1",
    });
  });

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/agents/work-1/session`);

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "session_not_found", id: "work-1" });
    },
    {
      sessionReader: {
        async readAgentSessionEvents() {
          return null;
        },
      },
    },
  );
});

test("GET /agents/:id returns JSON 400 for malformed encoded IDs", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/agents/%E0%A4%A`, {
      signal: AbortSignal.timeout(1000),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "bad_request",
      message: "malformed_agent_id",
    });

    const sessionResponse = await fetch(`${baseUrl}/agents/%E0%A4%A/session`, {
      signal: AbortSignal.timeout(1000),
    });

    assert.equal(sessionResponse.status, 400);
    assert.deepEqual(await sessionResponse.json(), {
      error: "bad_request",
      message: "malformed_agent_id",
    });
  });
});

test("API returns JSON errors for non-GET methods and unknown paths", async () => {
  await withServer(async (baseUrl) => {
    const method = await fetch(`${baseUrl}/status`, { method: "POST" });
    assert.equal(method.status, 405);
    assert.deepEqual(await method.json(), { error: "method_not_allowed" });

    const missing = await fetch(`${baseUrl}/missing-route`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "not_found" });
  });
});

test("API returns JSON 400 for malformed request targets", async () => {
  await withServer(async (baseUrl) => {
    const port = Number(new URL(baseUrl).port);
    const raw = await sendRawHttpRequest(
      port,
      "GET http://% HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    );

    assert.match(raw, /^HTTP\/1\.1 400 Bad Request/);
    assert.match(raw, /"error":"bad_request"/);
    assert.match(raw, /"message":"malformed_request_target"/);
  });
});

test("GET /events streams agent.updated events", async () => {
  await withServer(async (baseUrl, store) => {
    const abort = new AbortController();
    const response = await fetch(`${baseUrl}/events`, {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type")?.split(";")[0].trim(), "text/event-stream");

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

test("start failure does not leave a store event listener attached", async () => {
  const blocker = await listenOnEphemeralPort();
  try {
    const address = blocker.address() as AddressInfo;
    const store = new StatusStore({ staleAfterMs: 30000, now: () => 1000 });
    const api = createHttpApi({ host: "127.0.0.1", port: address.port, store });

    await assert.rejects(() => api.start());

    assert.equal(store.listenerCount("event"), 0);
  } finally {
    await closeServer(blocker);
  }
});

test("GET /ui serves the Web frontend HTML", async () => {
  await withServer(async (baseUrl) => {
    const bare = await fetch(`${baseUrl}/ui`);
    assert.equal(bare.status, 200);
    assert.equal(bare.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(bare.headers.get("cache-control"), "no-cache");
    const html = await bare.text();
    assert.match(html, /<title>AgentBoard<\/title>/);
    assert.match(html, /id="table-view-button"/);
    assert.match(html, /id="office-view-button"/);
    assert.match(html, /id="table-view"/);
    assert.match(html, /id="office-view"/);
    assert.match(html, /<option value="1800000">30min<\/option>/);
    assert.match(html, /<option value="10800000">3h<\/option>/);
    assert.match(html, /<option value="43200000">12h<\/option>/);
    assert.match(html, /<option value="86400000">24h<\/option>/);
    assert.match(html, /<option value="604800000">7days<\/option>/);
    assert.equal(html.includes('<option value="300000">5m</option>'), false);
    assert.equal(html.includes('<option value="900000">15m</option>'), false);
    assert.equal(html.includes('<option value="3600000">1h</option>'), false);

    const slash = await fetch(`${baseUrl}/ui/`);
    assert.equal(slash.status, 200);
    assert.equal(slash.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(slash.headers.get("cache-control"), "no-cache");
    assert.match(await slash.text(), /id="agent-table-body"/);
  });
});

test("GET /ui static assets use explicit content types", async () => {
  await withServer(async (baseUrl) => {
    const scripts = [
      { path: "/ui/app.js", contentType: "text/javascript; charset=utf-8" },
      { path: "/ui/agent.js", contentType: "text/javascript; charset=utf-8" },
      { path: "/ui/view-model.js", contentType: "text/javascript; charset=utf-8" },
      { path: "/ui/styles.css", contentType: "text/css; charset=utf-8" },
    ];

    for (const asset of scripts) {
      const response = await fetch(`${baseUrl}${asset.path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), asset.contentType);
      assert.equal(response.headers.get("cache-control"), "no-cache");
      assert.ok((await response.text()).length > 0);
    }
  });
});

test("GET /ui/agent.html serves the agent session page", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ui/agent.html`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    const html = await response.text();

    assert.match(html, /<title>AgentBoard Session<\/title>/);
    assert.match(html, /id="session-title"/);
    assert.match(html, /id="session-summary"/);
    assert.match(html, /id="session-diagnostics"/);
    assert.match(html, /id="session-messages"/);
    assert.match(html, /<script type="module" src="\/ui\/agent\.js"><\/script>/);
  });
});

test("GET /ui vendor euphony assets are served from an explicit safe prefix", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ui/vendor/euphony/euphony.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.ok((await response.text()).length > 0);

    const traversal = await fetch(`${baseUrl}/ui/vendor/euphony/../euphony.js`);
    assert.equal(traversal.status, 404);
  });
});

test("GET /ui assets wire dashboard message links and euphony session rendering", async () => {
  await withServer(async (baseUrl) => {
    const dashboard = await (await fetch(`${baseUrl}/ui/app.js`)).text();
    const session = await (await fetch(`${baseUrl}/ui/agent.js`)).text();
    const styles = await (await fetch(`${baseUrl}/ui/styles.css`)).text();

    assert.match(dashboard, /View messages/);
    assert.match(dashboard, /\/ui\/agent\.html\?id=/);
    assert.match(session, /parseCodexSession/);
    assert.match(session, /\/agents\/\$\{encodeURIComponent\(agentId\)\}\/session/);
    assert.match(session, /euphony-conversation/);
    assert.match(session, /renderSessionSummary/);
    assert.match(session, /renderDiagnostics/);
    assert.match(session, /Context tokens/);
    assert.match(session, /Total tokens/);
    assert.match(session, /unknown/);
    assert.match(styles, /\.session-panel/);
    assert.match(styles, /\.agent-message-link/);
  });
});

test("GET /ui styles disable stale office animations", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ui/styles.css`);
    assert.equal(response.status, 200);
    const styles = await response.text();

    assert.match(
      styles,
      /\.office-agent\.is-stale\[data-status="working"\] \.office-agent__monitor,[\s\S]*?animation: none;/,
    );
    assert.match(
      styles,
      /\.office-agent\.is-stale\[data-status="waiting_approval"\] \.office-agent__bubble,[\s\S]*?animation: none;/,
    );
  });
});

test("GET /ui assets render main office pod status in headers", async () => {
  await withServer(async (baseUrl) => {
    const script = await (await fetch(`${baseUrl}/ui/app.js`)).text();
    const styles = await (await fetch(`${baseUrl}/ui/styles.css`)).text();

    assert.match(script, /office-pod__status/);
    assert.match(script, /pod\.agent\.status/);
    assert.match(styles, /\.office-pod__status/);
  });
});

test("GET /ui assets render sub agents as subordinate office workers", async () => {
  await withServer(async (baseUrl) => {
    const script = await (await fetch(`${baseUrl}/ui/app.js`)).text();
    const styles = await (await fetch(`${baseUrl}/ui/styles.css`)).text();

    assert.match(script, /office-pod__lead-station/);
    assert.match(script, /office-pod__team-grid/);
    assert.match(styles, /\.office-pod__lead-station/);
    assert.match(styles, /\.office-pod__team-grid/);
    assert.match(styles, /\.office-pod__team-grid \{[^}]*overflow: auto;/);
    assert.match(styles, /\.office-agent\[data-role="sub"\]/);
  });
});

test("GET /ui assets render detailed office workers with graphic status signals", async () => {
  await withServer(async (baseUrl) => {
    const script = await (await fetch(`${baseUrl}/ui/app.js`)).text();
    const styles = await (await fetch(`${baseUrl}/ui/styles.css`)).text();

    assert.match(script, /office-agent__chair/);
    assert.match(script, /office-agent__hair/);
    assert.match(script, /office-agent__status-light/);
    assert.match(script, /office-agent__status-glyph/);
    assert.match(script, /office-agent__screen-line/);
    assert.match(script, /office-agent__desk-leg/);
    assert.match(script, /office-agent__desk-mug/);

    assert.match(styles, /\.office-agent\[data-status="working"\] \.office-agent__status-light/);
    assert.match(styles, /\.office-agent\[data-status="waiting_approval"\] \.office-agent__status-glyph/);
    assert.match(styles, /\.office-agent\[data-status="waiting_input"\] \.office-agent__bubble/);
    assert.match(styles, /\.office-agent\[data-status="error"\] \.office-agent__status-light/);
    assert.match(styles, /\.office-agent\[data-status="finished"\] \.office-agent__status-glyph/);
    assert.match(styles, /\.office-agent\[data-role="sub"\][\s\S]*?opacity: 0\.78;/);
    assert.match(styles, /\.office-agent\[data-role="sub"\] \.office-agent__status-light/);
  });
});

test("GET /ui assets preserve scroll when selecting office agents", async () => {
  await withServer(async (baseUrl) => {
    const script = await (await fetch(`${baseUrl}/ui/app.js`)).text();

    assert.match(
      script,
      /const scrollPosition = captureScrollPosition\(\);[\s\S]*?state\.expandedAgentId = state\.expandedAgentId === agent\.id \? null : agent\.id;[\s\S]*?renderActiveView\(\);[\s\S]*?restoreScrollPosition\(scrollPosition\);/,
    );
  });
});

test("GET /ui assets use simplified office ordering without previous-position state", async () => {
  await withServer(async (baseUrl) => {
    const script = await (await fetch(`${baseUrl}/ui/app.js`)).text();

    assert.doesNotMatch(script, /officePodOrder:\s*\[\]/);
    assert.doesNotMatch(script, /officeAgentOrder:\s*\[\]/);
    assert.match(script, /buildOfficePods\(visibleAgents\);/);
    assert.doesNotMatch(script, /previousPodIds/);
    assert.doesNotMatch(script, /previousAgentIds/);
    assert.doesNotMatch(script, /rememberOfficeOrder/);
  });
});

test("GET /ui assets render dismissible office status alerts", async () => {
  await withServer(async (baseUrl) => {
    const html = await (await fetch(`${baseUrl}/ui`)).text();
    const script = await (await fetch(`${baseUrl}/ui/app.js`)).text();
    const styles = await (await fetch(`${baseUrl}/ui/styles.css`)).text();

    assert.match(html, /id="office-alerts"/);
    assert.match(html, /aria-live="assertive"/);
    assert.match(script, /findMainAgentStatusAlerts/);
    assert.match(script, /agentStatuses:\s*new Map\(\)/);
    assert.match(script, /officeAlerts:\s*\[\]/);
    assert.match(script, /queueOfficeAlerts\(/);
    assert.match(script, /renderOfficeAlertSummary/);
    assert.match(script, /renderOfficeAlert/);
    assert.match(script, /state\.officeAlerts = \[\];/);
    assert.match(script, /state\.officeAlerts = state\.officeAlerts\.filter\(\(item\) => item\.id !== alert\.id\);/);
    assert.match(styles, /\.office-alerts/);
    assert.match(styles, /\.office-alerts__summary/);
    assert.match(styles, /\.office-alerts__close-all/);
    assert.match(styles, /\.office-alert/);
    assert.match(styles, /\.office-alert__close/);
  });
});

test("GET /ui styles give office statuses distinct graphic treatments", async () => {
  await withServer(async (baseUrl) => {
    const styles = await (await fetch(`${baseUrl}/ui/styles.css`)).text();

    assert.match(
      styles,
      /\.office-agent\[data-status="waiting_approval"\] \.office-agent__status-light \{[\s\S]*?background: #f59f2f;/,
    );
    assert.match(
      styles,
      /\.office-agent\[data-status="waiting_input"\] \.office-agent__status-light \{[\s\S]*?background: #3d8bfd;/,
    );
    assert.doesNotMatch(
      styles,
      /\.office-agent\[data-status="waiting_approval"\] \.office-agent__status-light,\s*\.office-agent\[data-status="waiting_input"\] \.office-agent__status-light/,
    );
    assert.match(
      styles,
      /\.office-agent\[data-status="unknown"\] \.office-agent__monitor \{[\s\S]*?repeating-linear-gradient/,
    );
    assert.match(styles, /\.office-agent\[data-status="idle"\] \.office-agent__screen-line/);
    assert.match(
      styles,
      /\.office-agent\[data-status="finished"\] \.office-agent__monitor \{[\s\S]*?#a7d8ff;/,
    );
    assert.match(styles, /\.office-agent\[data-status="finished"\] \.office-agent__bubble/);
  });
});

test("unknown /ui asset returns JSON 404", async () => {
  await withServer(async (baseUrl) => {
    const paths = [
      { path: "/ui/missing.js", raw: false },
      { path: "/ui/app.js.map", raw: false },
      { path: "/ui/%2e%2e/status", raw: true },
    ];

    for (const { path, raw } of paths) {
      if (raw) {
        const port = Number(new URL(baseUrl).port);
        const response = await sendRawHttpRequest(
          port,
          `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
        );
        assert.match(response, /^HTTP\/1\.1 404 Not Found/);
        assert.match(response, /{"error":"not_found"}/);
      } else {
        const response = await fetch(`${baseUrl}${path}`);
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "not_found" });
      }
    }
  });
});

test("unavailable /ui asset returns stable JSON 500", async () => {
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/ui/unavailable.js`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: "ui_asset_unavailable",
        message: "UI asset unavailable",
      });
    },
    {
      uiAssets: new Map([
        [
          "/ui/unavailable.js",
          {
            path: MISSING_UI_ASSET_PATH,
            contentType: "text/javascript; charset=utf-8",
          },
        ],
      ]),
    },
  );
});
