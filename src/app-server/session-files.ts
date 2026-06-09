import { access, readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { normalizeTimestampMs } from "../domain/mapper.ts";

export type SessionThreadReference = {
  id: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  path?: string | null;
};

export async function findThreadSessionPath(
  codexHome: string,
  thread: SessionThreadReference,
): Promise<string | null> {
  if (typeof thread.path === "string" && thread.path.endsWith(".jsonl")) {
    if (await fileExists(thread.path)) {
      return thread.path;
    }
  }

  const dates = sessionDateCandidates(thread);
  for (const dateParts of dates) {
    const dir = join(codexHome, "sessions", ...dateParts);
    const fileName = await findThreadSessionFileName(dir, thread);
    if (fileName) {
      return join(dir, fileName);
    }
  }

  return null;
}

export async function readThreadSessionEvents(sessionPath: string): Promise<unknown[]> {
  const content = await readFile(sessionPath, "utf8");
  const events: unknown[] = [];

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as unknown;
      if (!isObject(event)) {
        throw new Error("session event is not a JSON object");
      }
      events.push(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid session JSONL at line ${index + 1}: ${message}`);
    }
  }

  return events;
}

async function findThreadSessionFileName(
  dir: string,
  thread: SessionThreadReference,
): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  const identifiers = [thread.sessionId, thread.id].filter(
    (identifier): identifier is string => typeof identifier === "string" && identifier.length > 0,
  );
  const matches = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (fileName) =>
        fileName.endsWith(".jsonl") &&
        identifiers.some((identifier) => fileName.includes(identifier)),
    )
    .sort();

  return matches.at(-1) ?? null;
}

function sessionDateCandidates(thread: SessionThreadReference): string[][] {
  const candidates = new Map<string, string[]>();
  for (const value of [thread.createdAt, thread.updatedAt]) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    const timestampMs = normalizeTimestampMs(value);
    for (const offsetDays of [-1, 0, 1]) {
      const date = new Date(timestampMs + offsetDays * 24 * 60 * 60 * 1000);
      addDateCandidate(candidates, localDateParts(date));
      addDateCandidate(candidates, utcDateParts(date));
    }
  }
  return [...candidates.values()];
}

function addDateCandidate(candidates: Map<string, string[]>, parts: string[]): void {
  candidates.set(parts.join("/"), parts);
}

function localDateParts(date: Date): string[] {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];
}

function utcDateParts(date: Date): string[] {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
