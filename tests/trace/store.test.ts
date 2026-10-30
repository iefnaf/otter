import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTraceStore, readTraceStore } from "../../src/trace/store.ts";
import { redactSnapshot } from "../../src/redactor/redact.ts";
import { createLocalReport } from "../../src/reporter/local.ts";
import { snapshotFixture } from "../helpers.ts";

describe("trace store", () => {
  test("writes private JSONL, validates events, and exports without commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "otter-trace-"));
    const snapshot = snapshotFixture();
    const redacted = redactSnapshot(snapshot, {
      runId: "20261030T000000-abcdef",
      currentUser: "fanfei",
    });
    const store = await openTraceStore(root, "20261030T000000-abcdef", "scan", 2);
    await store.append({
      eventType: "collection_completed",
      payload: { statuses: [...snapshot.collectorStatus] },
    });
    await store.append({
      eventType: "redaction_applied",
      payload: { redactedPayload: redacted.payload, processArgumentsOmitted: true },
    });
    await store.append({
      eventType: "run_completed",
      payload: { report: createLocalReport(redacted.payload, "local") },
    });
    const events = await store.show("20261030T000000-abcdef");
    expect(events.map((event) => event.eventType)).toEqual([
      "collection_started",
      "collection_completed",
      "redaction_applied",
      "run_completed",
    ]);
    const traceMode = await stat(join(root, "20261030T000000-abcdef.jsonl"));
    expect(traceMode.mode & 0o777).toBe(0o600);
    const exported = await store.export("20261030T000000-abcdef");
    expect(exported.includes("--token")).toBe(false);
    expect(exported.includes("processArgumentsOmitted")).toBe(true);
  });

  test("keeps only the newest one hundred traces", async () => {
    const root = await mkdtemp(join(tmpdir(), "otter-rotate-"));
    for (let index = 0; index < 100; index += 1) {
      const runId = `19700101T000000-${String(index).padStart(6, "0")}`;
      await writeFile(join(root, `${runId}.jsonl`), "{}\n");
      await utimes(join(root, `${runId}.jsonl`), new Date(index * 1000), new Date(index * 1000));
    }
    const store = await openTraceStore(root, "20261030T000000-abcdef", "scan", 0);
    await store.append({
      eventType: "run_failed",
      payload: { message: "test rotation" },
    });
    const files = await readTraceStore(root).list();
    expect(files).toHaveLength(100);
    expect(files.some((file) => file.runId === "19700101T000000-000000")).toBe(false);
    expect(files[0]?.runId).toBe("20261030T000000-abcdef");
  });

  test("rotation ignores unrelated JSONL and requires an owned root for reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "otter-rotate-safety-"));
    await writeFile(join(root, "customer-data.jsonl"), "keep me\n");
    const store = await openTraceStore(root, "20261030T000000-abcdef", "scan", 0);
    await store.append({
      eventType: "run_failed",
      payload: { message: "test unrelated rotation" },
    });
    expect(await readFile(join(root, "customer-data.jsonl"), "utf8")).toBe("keep me\n");

    await writeFile(join(root, ".otter-traces"), "not otter\n");
    await expect(store.show("20261030T000000-abcdef")).rejects.toThrow(
      "directory is not an Otter trace root",
    );
  });
});
