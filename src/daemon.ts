import { createAppServerSupervisor } from "./app-server/supervisor.ts";
import { JsonRpcStdioClient } from "./app-server/json-rpc.ts";
import { AppServerClient } from "./app-server/client.ts";
import { StatusStore } from "./store/status-store.ts";
import { createHttpApi } from "./http/api.ts";
import type { DaemonConfig } from "./config.ts";
import type { AppServerProcess, AppServerSupervisor } from "./app-server/supervisor.ts";
import type { InitialAppServerState } from "./app-server/client.ts";

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

  const staleTimer = setInterval(() => store.markStaleAgents(), options.config.refreshIntervalMs);
  const api = createHttpApi({
    host: options.config.host,
    port: options.config.port,
    store,
  });
  await api.start();

  return {
    url: api.url(),
    async stop() {
      clearInterval(staleTimer);
      await api.stop();
      appServer.stop();
    },
  };
}
