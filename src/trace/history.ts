import { readTraceStore } from "./store.ts";
import type { TraceEvent } from "./schema.ts";

export interface RunHistorySummary {
  readonly runId: string;
  readonly command: "scan" | "explain" | "clean";
  readonly approvalCount: number;
  readonly stoppedCount: number;
  readonly failedCount: number;
  readonly verificationSummary: string;
  readonly executableCount: number;
  readonly blockedCount: number;
}

function candidateCounts(events: readonly TraceEvent[]): {
  executableCount: number;
  blockedCount: number;
} {
  const completed = events.find((item) => item.eventType === "run_completed");
  if (completed === undefined) {
    return { executableCount: 0, blockedCount: 0 };
  }
  const report = completed.payload.report;
  if (!("validatedCandidates" in report)) {
    return { executableCount: 0, blockedCount: 0 };
  }
  let executableCount = 0;
  let blockedCount = 0;
  for (const candidate of report.validatedCandidates) {
    if ("decision" in candidate) {
      if (candidate.decision === "blocked") blockedCount += 1;
      else if (candidate.decision === "eligible" || candidate.decision === "review_required") {
        executableCount += 1;
      }
    } else if (candidate.eligibility === "blocked" || candidate.eligibility === "unknown") {
      blockedCount += 1;
    } else {
      executableCount += 1;
    }
  }
  return { executableCount, blockedCount };
}

export function summarizeHistoryRun(
  events: readonly TraceEvent[],
): RunHistorySummary | null {
  const started = events.find((item) => item.eventType === "collection_started");
  if (started === undefined || started.eventType !== "collection_started") return null;
  const approvals = events.filter(
    (item) => item.eventType === "user_confirmed" && item.payload.approved,
  ).length;
  const actions = events.filter((item) => item.eventType === "action_executed");
  const stoppedCount = actions.filter(
    (item) => item.eventType === "action_executed" &&
      (item.payload.status === "succeeded" || item.payload.status === "partially_succeeded"),
  ).length;
  const failedCount = actions.filter(
    (item) => item.eventType === "action_executed" &&
      (item.payload.status === "failed" || item.payload.status === "partially_succeeded"),
  ).length;
  const verifications = events.filter((item) => item.eventType === "action_verified");
  const verified = verifications.filter(
    (item) => item.eventType === "action_verified" && item.payload.status === "verified",
  ).length;
  const active = verifications.filter(
    (item) => item.eventType === "action_verified" && item.payload.status === "active",
  ).length;
  const unknown = verifications.length - verified - active;
  const counts = candidateCounts(events);
  return {
    runId: started.runId,
    command: started.payload.command,
    approvalCount: approvals,
    stoppedCount,
    failedCount,
    verificationSummary: `${verified} verified, ${active} active, ${unknown} unknown`,
    ...counts,
  };
}

export async function readTraceHistory(root: string): Promise<readonly RunHistorySummary[]> {
  const store = readTraceStore(root);
  const summaries: RunHistorySummary[] = [];
  for (const file of await store.list()) {
    const summary = summarizeHistoryRun(await store.show(file.runId));
    if (summary !== null) summaries.push(summary);
  }
  return summaries;
}

export function renderHistory(summaries: readonly RunHistorySummary[]): string {
  const lines = [
    "run                   command   result",
    ...summaries.map((summary) =>
      `${summary.runId.padEnd(21)}  ${summary.command.padEnd(8)}  ${summary.approvalCount} approved, ${summary.stoppedCount} stopped, ${summary.failedCount} failed; ${summary.verificationSummary}; ${summary.executableCount} executable, ${summary.blockedCount} blocked`
    ),
  ];
  return `${lines.join("\n")}\n`;
}
