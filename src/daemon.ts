import { createAppServerSupervisor } from "./app-server/supervisor.ts";
import { JsonRpcStdioClient } from "./app-server/json-rpc.ts";
import { AppServerClient } from "./app-server/client.ts";
import { StatusStore } from "./store/status-store.ts";
import { createHttpApi } from "./http/api.ts";
import type { DaemonConfig } from "./config.ts";
import type { AppServerProcess, AppServerSupervisor } from "./app-server/supervisor.ts";
import type { InitialAppServerState } from "./app-server/client.ts";
import type { HttpApi, HttpApiOptions } from "./http/api.ts";

export type DaemonHandle = {
  url: string;
  stop: () => Promise<void>;
};

export type ClientLike = {
  initialize: () => Promise<unknown>;
  readInitialState: () => Promise<InitialAppServerState>;
  on: (
    event: "notification",
    listener: (notification: { method: string; params?: unknown }) => void,
  ) => void;
};

export type StartDaemonOptions = {
  config: DaemonConfig;
  now?: () => number;
  supervisor?: AppServerSupervisor;
  clientFactory?: (appServer: AppServerProcess) => ClientLike;
  httpApiFactory?: (options: HttpApiOptions) => HttpApi;
};

export async function startDaemon(options: StartDaemonOptions): Promise<DaemonHandle> {
  const now = options.now ?? Date.now;
  const supervisor = options.supervisor ?? createAppServerSupervisor();
  const store = new StatusStore({
    staleAfterMs: options.config.staleAfterMs,
    now,
    startedAt: now(),
  });

  const appServer = await supervisor.start({
    autoStartAppServer: options.config.autoStartAppServer,
  });
  let staleTimer: NodeJS.Timeout | null = null;
  let api: HttpApi | null = null;

  try {
    store.setAppServerConnection({
      connected: true,
      autoStarted: options.config.autoStartAppServer,
      mode: appServer.mode,
      cliVersion: appServer.cliVersion,
    });

    const client =
      options.clientFactory?.(appServer) ??
      new AppServerClient(new JsonRpcStdioClient(appServer.process as never));

    client.on("notification", (notification) => {
      store.applyNotification(notification);
    });

    await client.initialize();
    const initial = await client.readInitialState();
    store.replaceThreads(initial.threads);

    staleTimer = setInterval(() => store.markStaleAgents(), options.config.refreshIntervalMs);
    const httpApiFactory = options.httpApiFactory ?? createHttpApi;
    api = httpApiFactory({
      host: options.config.host,
      port: options.config.port,
      store,
    });
    await api.start();

    return createDaemonHandle(api, staleTimer, appServer);
  } catch (error) {
    if (staleTimer) {
      clearInterval(staleTimer);
    }
    if (api) {
      await api.stop().catch(() => {});
    }
    appServer.stop();
    throw error;
  }
}

function createDaemonHandle(
  api: HttpApi,
  staleTimer: NodeJS.Timeout,
  appServer: AppServerProcess,
): DaemonHandle {
  let stopped: Promise<void> | null = null;

  return {
    url: api.url(),
    stop() {
      stopped ??= stopDaemon(api, staleTimer, appServer);
      return stopped;
    },
  };
}

async function stopDaemon(
  api: HttpApi,
  staleTimer: NodeJS.Timeout,
  appServer: AppServerProcess,
): Promise<void> {
  clearInterval(staleTimer);
  try {
    await api.stop();
  } finally {
    appServer.stop();
  }
}
