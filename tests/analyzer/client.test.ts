import { describe, expect, test } from "bun:test";
import { requestAnalyzer } from "../../src/analyzer/client.ts";

describe("analyzer client", () => {
  test("sends Authorization only to the configured exact chat endpoint", async () => {
    const seen: { url: string; authorization: string }[] = [];
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
        seen.push({ url, authorization: init.headers.Authorization ?? "" });
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(report) } }],
        }));
      },
    });
    expect(result).toEqual(report);
    expect(seen).toEqual([{
      url: "https://api.deepseek.com/chat/completions",
      authorization: `Bearer ${apiKey}`,
    }]);
  });
});
