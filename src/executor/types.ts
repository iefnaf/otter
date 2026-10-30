import { z } from "zod";

export const executionResultSchema = z.strictObject({
  candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
  actionType: z.enum(["kill_process", "stop_container"]),
  status: z.enum([
    "succeeded",
    "failed",
    "partially_succeeded",
    "target_changed",
    "skipped",
  ]),
  errorCode: z.string().nullable(),
  message: z.string().min(1),
});

export type ExecutionResult = z.infer<typeof executionResultSchema>;

export const actionVerificationSchema = z.strictObject({
  candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
  status: z.enum(["verified", "active", "unknown"]),
  observation: z.string().min(1),
});

export type ActionVerification = z.infer<typeof actionVerificationSchema>;

export const executionSummarySchema = z.strictObject({
  enabled: z.boolean(),
  status: z.enum(["disabled", "not_available", "complete"]),
  reason: z.string().min(1),
  results: z.array(executionResultSchema),
  verifications: z.array(z.strictObject({
    candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
    status: z.enum(["verified", "active", "unknown"]),
    observation: z.string().min(1),
  })).optional(),
});

export type ExecutionSummary = z.infer<typeof executionSummarySchema>;

export interface ProcessControl {
  kill(pid: number, signal: NodeJS.Signals): void;
  alive(pid: number): boolean;
}
