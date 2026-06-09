import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findThreadSessionPath, readThreadSessionEvents } from "../../src/app-server/session-files.ts";
import type { AppServerThread } from "../../src/domain/types.ts";

function thread(id: string): AppServerThread {
  return {
    id,
    sessionId: `session-${id}`,
    forkedFromId: null,
    preview: `Preview ${id}`,
    ephemeral: false,
    modelProvider: "openai",
    createdAt: Date.parse("2026-06-01T06:04:20.000Z"),
    updatedAt: Date.parse("2026-06-01T07:39:01.000Z"),
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
  };
}

test("findThreadSessionPath returns an existing explicit thread path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-status-session-files-"));
  const path = join(dir, "thread.jsonl");
  await writeFile(path, "{}\n");

  const found = await findThreadSessionPath(dir, { ...thread("explicit"), path });

  assert.equal(found, path);
});

test("findThreadSessionPath finds matching session files under codexHome sessions", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "codex-status-session-files-"));
  const sessionDir = join(codexHome, "sessions", "2026", "06", "01");
  await mkdir(sessionDir, { recursive: true });
  const path = join(sessionDir, "rollout-2026-06-01T07-39-01-session-nested.jsonl");
  await writeFile(path, "{}\n");

  const found = await findThreadSessionPath(codexHome, thread("nested"));

  assert.equal(found, path);
});

test("readThreadSessionEvents parses JSONL objects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-status-session-files-"));
  const path = join(dir, "events.jsonl");
  const events = [
    { type: "session_meta", payload: { id: "session-one" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [] } },
  ];
  await writeFile(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n\n`);

  assert.deepEqual(await readThreadSessionEvents(path), events);
});
