#!/usr/bin/env node
import { parseArgs } from "./config.ts";
import { startDaemon } from "./daemon.ts";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const daemon = await startDaemon({ config: parsed.config });
  console.log(`codex-status listening at ${daemon.url}`);

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (): void => {
    shutdownPromise ??= daemon.stop().then(
      () => process.exit(0),
      (error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      },
    );
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
