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
