export type AgentKind = "main_agent" | "sub_agent" | "unknown";

export type AgentPublicStatus =
  | "idle"
  | "working"
  | "finished"
  | "waiting_approval"
  | "waiting_input"
  | "error"
  | "unknown";

export type AppServerThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags?: string[] }
  | { type: string; activeFlags?: string[] };

export type AppServerLastTurn = {
  status: "completed" | "interrupted" | "failed" | "inProgress" | string;
  startedAt?: number | null;
  completedAt?: number | null;
};

export type AppServerThread = {
  id: string;
  sessionId: string;
  forkedFromId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: AppServerThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: unknown;
  threadSource: unknown;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: unknown;
  name: string | null;
  turns: AppServerLastTurn[];
};

export type AgentLastTurn = {
  status: "completed" | "interrupted" | "failed" | "inProgress" | "unknown";
  startedAt: number | null;
  completedAt: number | null;
};

export type AgentStatus = {
  id: string;
  sessionId: string;
  kind: AgentKind;
  displayName: string;
  status: AgentPublicStatus;
  rawStatus: unknown;
  cwd: string;
  preview: string;
  modelProvider: string;
  cliVersion: string;
  createdAt: number;
  updatedAt: number;
  parentThreadId: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  lastTurn: AgentLastTurn | null;
  waitingSince: number | null;
  lastEventAt: number;
  stale: boolean;
};

export type NormalizeOptions = {
  nowMs: number;
  previous?: AgentStatus | null;
};
