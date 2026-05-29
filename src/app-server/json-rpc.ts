import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export type JsonRpcProcess = Pick<ChildProcessWithoutNullStreams, "kill" | "on" | "once"> & {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
};

export type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class JsonRpcStdioClient extends EventEmitter {
  readonly #process: JsonRpcProcess;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #stdoutBuffer = "";
  #stderrBuffer = "";

  constructor(process: JsonRpcProcess) {
    super();
    this.#process = process;
    process.stdout.on("data", (chunk) => this.#onStdout(chunk));
    process.stderr.on("data", (chunk) => this.#onStderr(chunk));
    process.on("exit", (code, signal) => {
      const error = new Error(
        `App Server process exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
      );
      for (const pending of this.#pending.values()) {
        pending.reject(error);
      }
      this.#pending.clear();
      this.emit("close", { code, signal });
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.#process.stdin.write(`${payload}\n`);

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  close(): void {
    this.#process.kill("SIGTERM");
  }

  #onStdout(chunk: Buffer | string): void {
    this.#stdoutBuffer += chunk.toString();
    let newlineIndex = this.#stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.#stdoutBuffer.slice(0, newlineIndex).trim();
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.#handleMessage(line);
      }
      newlineIndex = this.#stdoutBuffer.indexOf("\n");
    }
  }

  #onStderr(chunk: Buffer | string): void {
    this.#stderrBuffer += chunk.toString();
    this.emit("stderr", chunk.toString());
  }

  #handleMessage(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("protocolError", error);
      return;
    }

    if ("id" in message && this.#pending.has(Number(message.id))) {
      const pending = this.#pending.get(Number(message.id))!;
      this.#pending.delete(Number(message.id));
      if ("error" in message) {
        pending.reject(new Error(readErrorMessage(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string") {
      this.emit("notification", {
        method: message.method,
        params: message.params,
      } satisfies JsonRpcNotification);
    }
  }
}

function readErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "JSON-RPC request failed";
}
