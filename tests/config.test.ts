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
  assert.throws(() => parseArgs(["daemon", "--port", "abc"]), /Invalid port for --port/);
});

test("parseArgs rejects missing option values", () => {
  assert.throws(() => parseArgs(["daemon", "--host"]), /Missing value for --host/);
  assert.throws(() => parseArgs(["daemon", "--port"]), /Missing value for --port/);
  assert.throws(() => parseArgs(["daemon", "--refresh-interval-ms"]), /Missing value for --refresh-interval-ms/);
  assert.throws(() => parseArgs(["daemon", "--stale-after-ms"]), /Missing value for --stale-after-ms/);
});

test("parseArgs rejects unknown options", () => {
  assert.throws(() => parseArgs(["daemon", "--verbose"]), /Unknown option: --verbose/);
});

test("parseArgs rejects negative values", () => {
  assert.throws(() => parseArgs(["daemon", "--port", "-1"]), /Invalid port for --port/);
  assert.throws(() => parseArgs(["daemon", "--refresh-interval-ms", "-1"]), /Invalid positive integer for --refresh-interval-ms/);
  assert.throws(() => parseArgs(["daemon", "--stale-after-ms", "-1"]), /Invalid positive integer for --stale-after-ms/);
});

test("parseArgs rejects zero for interval and stale durations", () => {
  assert.throws(() => parseArgs(["daemon", "--refresh-interval-ms", "0"]), /Invalid positive integer for --refresh-interval-ms/);
  assert.throws(() => parseArgs(["daemon", "--stale-after-ms", "0"]), /Invalid positive integer for --stale-after-ms/);
});

test("parseArgs validates port range while allowing ephemeral port zero", () => {
  assert.equal(parseArgs(["daemon", "--port", "0"]).config.port, 0);
  assert.equal(parseArgs(["daemon", "--port", "65535"]).config.port, 65535);
  assert.throws(() => parseArgs(["daemon", "--port", "-1"]), /Invalid port for --port/);
  assert.throws(() => parseArgs(["daemon", "--port", "65536"]), /Invalid port for --port/);
});
