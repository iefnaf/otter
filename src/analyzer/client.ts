import { z } from "zod";

const completionResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().min(1) }),
  })).min(1),
});

export type FetchLike = (
  input: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

export interface AnalyzerClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
}

export async function requestAnalyzer(
  prompt: string,
  options: AnalyzerClientOptions,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      ...(options.model === "deepseek-v4-flash"
        ? { thinking: { type: "disabled" } }
        : {}),
      messages: [
        { role: "system", content: "Return strict JSON and no markdown." },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
  });
  if (!response.ok) {
    throw new Error(`OpenAI-compatible analyzer returned HTTP ${response.status}`);
  }
  const wire = completionResponseSchema.parse(await response.json());
  return JSON.parse(wire.choices[0]?.message.content ?? "");
}
