import { z } from "zod";
import { analyzerResponseSchema } from "../analyzer/response.ts";
import { localReportSchema } from "../reporter/local.ts";
import { redactedPayloadSchema } from "../redactor/schema.ts";
import { collectorStatusSchema } from "../snapshot/schema.ts";
import { actionVerificationSchema, executionResultSchema } from "../executor/types.ts";
import { validatedCandidateSummarySchema } from "../validator/schema.ts";

export const traceEventSchema = z.discriminatedUnion("eventType", [
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("collection_started"),
    payload: z.object({
      command: z.enum(["scan", "explain", "clean"]),
      windowSeconds: z.number().nonnegative(),
    }),
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("collection_completed"),
    payload: z.object({ statuses: z.array(collectorStatusSchema) }),
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("redaction_applied"),
    payload: z.object({
      redactedPayload: redactedPayloadSchema,
      processArgumentsOmitted: z.literal(true),
    }),
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("llm_request_sent"),
    payload: z.object({
      promptVersion: z.string().min(1),
      model: z.string().min(1),
    }),
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("llm_response_received"),
    payload: z.object({
      valid: z.boolean(),
      report: analyzerResponseSchema.nullable(),
      errors: z.array(z.string()),
    }),
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("recommendations_validated"),
    payload: z.object({
      candidates: z.array(validatedCandidateSummarySchema),
    }),
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("user_confirmed"),
    payload: z.object({
      candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
      approved: z.boolean(),
    }),
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("action_executed"),
    payload: executionResultSchema,
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("action_verified"),
    payload: actionVerificationSchema,
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("run_completed"),
    payload: z.object({ report: z.union([localReportSchema, analyzerResponseSchema]) }),
  }),
  z.object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
    eventType: z.literal("run_failed"),
    payload: z.object({ message: z.string() }),
  }),
]);

export type TraceEvent = z.infer<typeof traceEventSchema>;
export type TraceEventDraft = DistributiveOmit<TraceEvent, "runId" | "seq" | "timestamp">;

type DistributiveOmit<T, K extends keyof never> = T extends unknown
  ? Omit<T, K>
  : never;

export interface CollectionCompletedPayload {
  readonly statuses: readonly z.infer<typeof collectorStatusSchema>[];
}

export interface RedactionAppliedPayload {
  readonly redactedPayload: z.infer<typeof redactedPayloadSchema>;
  readonly processArgumentsOmitted: true;
}

export interface LlmResponsePayload {
  readonly valid: boolean;
  readonly report: z.infer<typeof analyzerResponseSchema> | null;
  readonly errors: readonly string[];
}

export interface RunCompletedPayload {
  readonly report: z.infer<typeof localReportSchema> | z.infer<typeof analyzerResponseSchema>;
}
