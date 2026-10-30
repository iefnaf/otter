import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { traceEventSchema, type TraceEvent, type TraceEventDraft } from "./schema.ts";

const runIdPattern = /^\d{8}T\d{6}-[0-9a-f]{6}$/;
const maximumTraces = 100;
const markerName = ".otter-traces";

export interface TraceFile {
  readonly runId: string;
  readonly sizeBytes: number;
  readonly updatedAtMs: number;
}

export interface TraceStore {
  readonly root: string;
  append(event: TraceEventDraft): Promise<TraceEvent>;
  list(): Promise<readonly TraceFile[]>;
  show(runId: string): Promise<readonly TraceEvent[]>;
  export(runId: string): Promise<string>;
}

function assertRunId(runId: string): void {
  if (!runIdPattern.test(runId)) throw new Error("invalid trace run ID");
}

async function setPrivateMode(path: string, directory: boolean): Promise<void> {
  try {
    await chmod(path, directory ? 0o700 : 0o600);
  } catch (error) {
    if (!(error instanceof Error) || error.message.includes("not supported")) throw error;
  }
}

function makeEvent(
  runId: string,
  seq: number,
  draft: TraceEventDraft,
): TraceEvent {
  return traceEventSchema.parse({
    runId,
    seq,
    timestamp: new Date().toISOString(),
    ...draft,
  });
}

async function readEvents(root: string, runId: string): Promise<TraceEvent[]> {
  assertRunId(runId);
  await assertOwnedRoot(root);
  const content = await readFile(join(root, `${runId}.jsonl`), "utf8");
  return content
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => traceEventSchema.parse(JSON.parse(line)));
}

async function readDirectoryEntries(root: string): Promise<string[]> {
  try {
    return await readdir(root);
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) return [];
    throw error;
  }
}

async function rotate(root: string): Promise<void> {
  const entries = await readDirectoryEntries(root);
  const files: { name: string; updatedAtMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    if (!runIdPattern.test(entry.replace(/\.jsonl$/, ""))) continue;
    const info = await stat(join(root, entry));
    if (info.isFile()) files.push({ name: entry, updatedAtMs: info.mtimeMs });
  }
  files.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  for (const file of files.slice(maximumTraces)) {
    await unlink(join(root, file.name));
  }
}

async function assertOwnedRoot(root: string): Promise<void> {
  const marker = await readFile(join(root, markerName), "utf8").then(
    (content) => content.trim(),
    () => null,
  );
  if (marker !== "owned by otter") throw new Error("directory is not an Otter trace root");
}

export async function openTraceStore(
  root: string,
  runId: string,
  command: "scan" | "explain" | "clean",
  windowSeconds: number,
): Promise<TraceStore> {
  assertRunId(runId);
  await mkdir(root, { recursive: true });
  const markerPath = join(root, markerName);
  const marker = await readFile(markerPath, "utf8").then(
    (content) => content.trim(),
    () => null,
  );
  if (marker === null) await writeFile(markerPath, "owned by otter\n", { mode: 0o600 });
  else if (marker !== "owned by otter") throw new Error("directory is not an Otter trace root");
  await setPrivateMode(root, true);
  const path = join(root, `${runId}.jsonl`);
  const existing = await stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
  if (existing) throw new Error("trace run ID already exists");
  await writeFile(path, "", { mode: 0o600 });
  await setPrivateMode(path, false);
  let seq = 0;
  const first = makeEvent(runId, seq, {
    eventType: "collection_started",
    payload: { command, windowSeconds },
  });
  await appendFile(path, `${JSON.stringify(first)}\n`, { mode: 0o600 });
  seq += 1;

  return {
    root,
    async append(draft) {
      const event = makeEvent(runId, seq, draft);
      await appendFile(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
      seq += 1;
      await rotate(root);
      return event;
    },
    async list() {
      const entries = await readDirectoryEntries(root);
      const files: TraceFile[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;
        if (!runIdPattern.test(entry.replace(/\.jsonl$/, ""))) continue;
        const info = await stat(join(root, entry));
        if (!info.isFile()) continue;
        const runIdFromName = entry.replace(/\.jsonl$/, "");
        files.push({
          runId: runIdFromName,
          sizeBytes: info.size,
          updatedAtMs: info.mtimeMs,
        });
      }
      return files.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
    },
    async show(id) {
      return readEvents(root, id);
    },
    async export(id) {
      const events = await readEvents(root, id);
      return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    },
  };
}

export function readTraceStore(root: string): Omit<TraceStore, "append"> {
  return {
    root,
    async list() {
      const entries = await readDirectoryEntries(root);
      const files: TraceFile[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;
        if (!runIdPattern.test(entry.replace(/\.jsonl$/, ""))) continue;
        const info = await stat(join(root, entry));
        if (!info.isFile()) continue;
        const runIdFromName = entry.replace(/\.jsonl$/, "");
        files.push({
          runId: runIdFromName,
          sizeBytes: info.size,
          updatedAtMs: info.mtimeMs,
        });
      }
      return files.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
    },
    async show(id) {
      return readEvents(root, id);
    },
    async export(id) {
      const events = await readEvents(root, id);
      return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    },
  };
}
