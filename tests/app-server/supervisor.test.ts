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
