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
