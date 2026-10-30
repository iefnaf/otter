import { z } from "zod";

export const validatedCandidateSummarySchema = z.strictObject({
  candidateId: z.string().regex(/^cand_[0-9a-f]{12}$/),
  kind: z.enum(["process", "container"]),
  actionType: z.enum(["kill_process", "stop_container"]),
  eligibility: z.enum(["eligible", "blocked", "unknown"]),
  riskLevel: z.enum(["safe", "caution", "dangerous"]),
  blastRadius: z.string().min(1),
  observedBenefit: z.string().min(1),
});
