import { z } from "zod";

export const candidateTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("process"),
    executable: z.string().min(1),
    pid: z.number().int().positive(),
    user: z.string().min(1),
    elapsedHours: z.number().nonnegative(),
    hasControllingTerminal: z.boolean(),
    intervalCpuPercent: z.number().nonnegative().nullable(),
    rssMb: z.number().nonnegative(),
    listeningPorts: z.array(z.number().int().min(1).max(65535)),
  }),
  z.strictObject({
    kind: z.literal("container"),
    name: z.string().min(1),
    containerId: z.string().min(1),
    startedAt: z.string().min(1),
    state: z.enum(["running", "paused", "exited", "restarting"]),
    health: z.enum(["healthy", "unhealthy", "starting", "none"]),
    restartPolicy: z.enum(["no", "always", "unless-stopped", "on-failure"]),
    intervalCpuPercent: z.number().nonnegative().nullable(),
    memoryUsageMb: z.number().nonnegative(),
  }),
]);

export const safetyCheckSchema = z.strictObject({
  name: z.string().min(1),
  passed: z.boolean(),
  reason: z.string().min(1),
});

export const protectionRuleSchema = z.strictObject({
  name: z.string().min(1),
  source: z.enum(["builtin", "user"]),
});

const decisionReadyCandidateSummarySchema = z.strictObject({
  candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
  kind: z.enum(["process", "container"]),
  actionType: z.enum(["kill_process", "stop_container"]),
  eligibility: z.enum(["eligible", "blocked", "protected", "unknown"]),
  decision: z.enum(["eligible", "review_required", "blocked", "protected"]),
  target: candidateTargetSchema,
  checks: z.array(safetyCheckSchema),
  primaryReason: z.string().min(1).nullable(),
  impact: z.string().min(1),
  observedBenefit: z.string().min(1),
  protection: protectionRuleSchema.nullable(),
});

const legacyCandidateSummarySchema = z.strictObject({
  candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
  kind: z.enum(["process", "container"]),
  actionType: z.enum(["kill_process", "stop_container"]),
  eligibility: z.enum(["eligible", "blocked", "unknown"]),
  riskLevel: z.enum(["safe", "caution", "dangerous"]),
  blastRadius: z.string().min(1),
  observedBenefit: z.string().min(1),
});

export const validatedCandidateSummarySchema = z.union([
  decisionReadyCandidateSummarySchema,
  legacyCandidateSummarySchema,
]);

export type CandidateTarget = z.infer<typeof candidateTargetSchema>;
export type SafetyCheck = z.infer<typeof safetyCheckSchema>;
export type CandidateDecision = z.infer<
  typeof decisionReadyCandidateSummarySchema
>["decision"];
export type DecisionReadyCandidateSummary = z.infer<
  typeof decisionReadyCandidateSummarySchema
>;
