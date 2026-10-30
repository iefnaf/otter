import { describe, expect, test } from "bun:test";
import { requestAnalyzer } from "../../src/analyzer/client.ts";

describe("analyzer client", () => {
  test("sends DeepSeek JSON requests without thinking tokens", async () => {
    const seen: {
      url: string;
      authorization: string;
      body: unknown;
    }[] = [];
    const report = {
      summary: "ok",
      findings: [],
      candidateOpinions: [],
    };
    const apiKey = `deepseek-${"env"}-key`;
    const result = await requestAnalyzer("prompt", {
      baseUrl: "https://api.deepseek.com",
      apiKey,
      model: "deepseek-v4-flash",
      fetchImpl: async (url, init) => {
        const body: unknown = JSON.parse(init.body);
        seen.push({
          url,
          authorization: init.headers.Authorization ?? "",
          body,
        });
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(report) } }],
        }));
      },
    });
    expect(result).toEqual(report);
    expect(seen).toEqual([{
      url: "https://api.deepseek.com/chat/completions",
      authorization: `Bearer ${apiKey}`,
      body: {
        model: "deepseek-v4-flash",
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        messages: [
          { role: "system", content: "Return strict JSON and no markdown." },
          { role: "user", content: "prompt" },
        ],
      },
    }]);
  });

  test("does not send DeepSeek thinking controls to OpenAI", async () => {
    const bodies: unknown[] = [];
    await requestAnalyzer("prompt", {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-key",
      model: "gpt-4o-mini",
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{}" } }],
        }));
      },
    });
    expect(bodies).toEqual([{
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return strict JSON and no markdown." },
        { role: "user", content: "prompt" },
      ],
    }]);
  });
});
