import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LongRunningProcess =
  | ChildProcessWithoutNullStreams
  | {
      command: string;
      args: string[];
      pid: number;
      kill: (signal?: NodeJS.Signals) => boolean;
    };

export type SupervisorDeps = {
  spawnCommand: (command: string, args: string[]) => Promise<CommandResult>;
  spawnLongRunning: (command: string, args: string[]) => LongRunningProcess;
};

export type AppServerProcess = {
  mode: "external-daemon" | "managed-child";
  cliVersion: string;
  process: LongRunningProcess;
  stop: () => void;
};

export type AppServerSupervisor = {
  start: (options: { autoStartAppServer: boolean }) => Promise<AppServerProcess>;
};

export function createAppServerSupervisor(deps: SupervisorDeps = defaultDeps()): AppServerSupervisor {
  return {
    async start(options) {
      const version = await deps.spawnCommand("codex", ["--version"]);
      if (version.exitCode !== 0) {
        throw new Error(`codex --version failed: ${version.stderr || version.stdout}`);
      }
      const cliVersion = version.stdout.trim();

      if (!options.autoStartAppServer) {
        const proxy = deps.spawnLongRunning("codex", ["app-server", "proxy"]);
        return appServerProcess("external-daemon", cliVersion, proxy);
      }

      const daemon = await deps.spawnCommand("codex", ["app-server", "daemon", "start"]);
      if (daemon.exitCode === 0) {
        const proxy = deps.spawnLongRunning("codex", ["app-server", "proxy"]);
        return appServerProcess("external-daemon", cliVersion, proxy);
      }

      if (!isUnsupportedDaemonInstall(daemon.stderr)) {
        throw new Error(`codex app-server daemon start failed: ${daemon.stderr || daemon.stdout}`);
      }

      const child = deps.spawnLongRunning("codex", ["app-server", "--listen", "stdio://"]);
      return appServerProcess("managed-child", cliVersion, child);
    },
  };
}

function appServerProcess(
  mode: "external-daemon" | "managed-child",
  cliVersion: string,
  process: LongRunningProcess,
): AppServerProcess {
  return {
    mode,
    cliVersion,
    process,
    stop: () => {
      process.kill("SIGTERM");
    },
  };
}

function isUnsupportedDaemonInstall(stderr: string): boolean {
  return stderr.includes("managed standalone Codex install not found");
}

function defaultDeps(): SupervisorDeps {
  return {
    spawnCommand: (command, args) =>
      new Promise((resolve) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let settled = false;

        child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
        child.on("error", (error) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({
            exitCode: 1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat([...stderr, Buffer.from(error.message)]).toString("utf8"),
          });
        });
        child.on("close", (code) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({
            exitCode: code ?? 1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
        });
      }),
    spawnLongRunning: (command, args) => spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] }),
  };
}
