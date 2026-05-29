#!/usr/bin/env node
import { parseArgs } from "./config.ts";
import { startDaemon } from "./daemon.ts";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const daemon = await startDaemon({ config: parsed.config });
  console.log(`codex-status listening at ${daemon.url}`);

  const shutdown = async (): Promise<void> => {
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
