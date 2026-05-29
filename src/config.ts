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
