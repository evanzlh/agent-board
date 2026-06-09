import { createAppServerSupervisor } from "./app-server/supervisor.ts";
import { JsonRpcStdioClient } from "./app-server/json-rpc.ts";
import { AppServerClient } from "./app-server/client.ts";
import { StatusStore } from "./store/status-store.ts";
import { createHttpApi } from "./http/api.ts";
import type { DaemonConfig } from "./config.ts";
import type { AppServerProcess, AppServerSupervisor } from "./app-server/supervisor.ts";
import type { InitialAppServerState } from "./app-server/client.ts";
import type { HttpApi, HttpApiOptions } from "./http/api.ts";
import type { AgentStatus } from "./domain/types.ts";

export type DaemonHandle = {
  url: string;
  stop: () => Promise<void>;
};

export type ClientLike = {
  initialize: () => Promise<unknown>;
  readInitialState: () => Promise<InitialAppServerState>;
  readAgentSessionEvents?: (agent: AgentStatus) => Promise<unknown[] | null>;
  on: {
    (
      event: "notification",
      listener: (notification: { method: string; params?: unknown }) => void,
    ): void;
    (event: "close", listener: (event: unknown) => void): void;
  };
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
  let currentAppServer: AppServerProcess | null = appServer;
  let currentClient: ClientLike | null = null;
  let staleTimer: NodeJS.Timeout | null = null;
  let api: HttpApi | null = null;
  const trackedAppServers = new Set<AppServerProcess>();
  let stopped = false;
  let reconnecting: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;
  trackedAppServers.add(appServer);

  const connect = async (throwOnFailure: boolean): Promise<void> => {
    let nextAppServer: AppServerProcess | null = null;
    try {
      nextAppServer =
        currentAppServer && currentClient === null
          ? currentAppServer
          : await supervisor.start({
              autoStartAppServer: options.config.autoStartAppServer,
            });
      trackedAppServers.add(nextAppServer);

      const nextClient =
        options.clientFactory?.(nextAppServer) ??
        new AppServerClient(new JsonRpcStdioClient(nextAppServer.process as never), {
          detectOrphanedSessions: true,
        });

      nextClient.on("notification", (notification) => {
        store.applyNotification(notification);
      });
      nextClient.on("close", (event) => {
        if (stopped || currentClient !== nextClient) {
          return;
        }
        store.setAppServerConnection({
          connected: false,
          lastError: readClientCloseMessage(event),
        });
      });

      await nextClient.initialize();
      const initial = await nextClient.readInitialState();
      if (stopped) {
        nextAppServer.stop();
        return;
      }

      const previousAppServer = currentAppServer;
      currentAppServer = nextAppServer;
      currentClient = nextClient;
      store.replaceThreads(initial.threads);
      store.setAppServerConnection({
        connected: true,
        autoStarted: options.config.autoStartAppServer,
        mode: nextAppServer.mode,
        cliVersion: nextAppServer.cliVersion,
      });

      if (previousAppServer && previousAppServer !== nextAppServer) {
        previousAppServer.stop();
        trackedAppServers.delete(previousAppServer);
      }
    } catch (error) {
      if (nextAppServer && nextAppServer !== currentAppServer) {
        nextAppServer.stop();
        trackedAppServers.delete(nextAppServer);
      }
      store.setAppServerConnection({
        connected: false,
        lastError: readErrorMessage(error),
      });
      if (throwOnFailure) {
        throw error;
      }
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnecting || store.getHealth().appServer.connected) {
      return;
    }
    reconnecting = connect(false).finally(() => {
      reconnecting = null;
    });
  };

  const refreshSnapshot = (): void => {
    if (
      stopped ||
      reconnecting ||
      refreshing ||
      !currentClient ||
      !store.getHealth().appServer.connected
    ) {
      return;
    }

    const client = currentClient;
    refreshing = (async () => {
      try {
        const state = await client.readInitialState();
        if (stopped || currentClient !== client) {
          return;
        }
        store.replaceThreads(state.threads);
        store.setAppServerConnection({ connected: true });
      } catch (error) {
        if (stopped || currentClient !== client) {
          return;
        }
        store.setAppServerConnection({
          connected: false,
          lastError: readErrorMessage(error),
        });
        scheduleReconnect();
      } finally {
        refreshing = null;
      }
    })();
  };

  try {
    await connect(true);

    staleTimer = setInterval(() => {
      if (store.getHealth().appServer.connected) {
        refreshSnapshot();
      } else {
        store.markStaleAgents();
        scheduleReconnect();
      }
    }, options.config.refreshIntervalMs);
    const httpApiFactory = options.httpApiFactory ?? createHttpApi;
    api = httpApiFactory({
      host: options.config.host,
      port: options.config.port,
      store,
      sessionReader: {
        async readAgentSessionEvents(agent) {
          const client = currentClient;
          if (!client?.readAgentSessionEvents) {
            throw new Error("app server client unavailable");
          }
          return await client.readAgentSessionEvents(agent);
        },
      },
    });
    await api.start();

    return createDaemonHandle(
      api,
      staleTimer,
      () => {
        stopped = true;
      },
      () => {
        for (const trackedAppServer of trackedAppServers) {
          trackedAppServer.stop();
        }
        trackedAppServers.clear();
        currentAppServer = null;
        currentClient = null;
      },
    );
  } catch (error) {
    stopped = true;
    if (staleTimer) {
      clearInterval(staleTimer);
    }
    if (api) {
      await api.stop().catch(() => {});
    }
    for (const trackedAppServer of trackedAppServers) {
      trackedAppServer.stop();
    }
    trackedAppServers.clear();
    throw error;
  }
}

function createDaemonHandle(
  api: HttpApi,
  staleTimer: NodeJS.Timeout,
  markStopped: () => void,
  stopAppServer: () => void,
): DaemonHandle {
  let stopped: Promise<void> | null = null;

  return {
    url: api.url(),
    stop() {
      stopped ??= stopDaemon(api, staleTimer, markStopped, stopAppServer);
      return stopped;
    },
  };
}

async function stopDaemon(
  api: HttpApi,
  staleTimer: NodeJS.Timeout,
  markStopped: () => void,
  stopAppServer: () => void,
): Promise<void> {
  markStopped();
  clearInterval(staleTimer);
  try {
    await api.stop();
  } finally {
    stopAppServer();
  }
}

function readClientCloseMessage(event: unknown): string {
  if (typeof event === "object" && event !== null) {
    const code = "code" in event ? String(event.code) : "unknown";
    const signal = "signal" in event ? String(event.signal) : "unknown";
    return `App Server connection closed with code ${code} signal ${signal}`;
  }
  return "App Server connection closed";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
