import test from "node:test";
import assert from "node:assert/strict";

test("isCodexAgentCommand treats bare codex TUI processes as live agents", async () => {
  const module = await import("../../src/app-server/session-evidence.ts");

  assert.equal(typeof module.isCodexAgentCommand, "function");
  assert.equal(module.isCodexAgentCommand(["node", "/usr/bin/codex"]), true);
  assert.equal(module.isCodexAgentCommand(["/usr/bin/codex", "resume"]), true);
  assert.equal(module.isCodexAgentCommand(["node", "/usr/bin/codex", "app-server"]), false);
  assert.equal(module.isCodexAgentCommand(["/usr/bin/codex", "app-server", "--listen", "stdio://"]), false);
});
