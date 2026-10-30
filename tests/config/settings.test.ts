import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzerBaseUrl, readSettings, writeSettings } from "../../src/config/settings.ts";
import { resolveApiKey } from "../../src/config/keychain.ts";
import { output } from "../helpers.ts";

describe("analyzer configuration", () => {
  test("accepts only supported models and derives exact provider origins", async () => {
    const root = await mkdtemp(join(tmpdir(), "otter-settings-"));
    expect(await readSettings(root)).toEqual({
      model: "gpt-4o-mini",
      enableExecution: false,
      protectedExecutables: [],
    });
    expect(analyzerBaseUrl("deepseek-v4-flash")).toBe("https://api.deepseek.com");
    expect(analyzerBaseUrl("gpt-4o-mini")).toBe("https://api.openai.com/v1");
  });

  test("persists user protection rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "otter-protection-settings-"));
    await writeSettings(root, {
      model: "gpt-4o-mini",
      enableExecution: false,
      protectedExecutables: ["My Agent"],
    });
    expect((await readSettings(root)).protectedExecutables).toEqual(["My Agent"]);
  });

  test("uses the provider-specific environment key before Keychain", async () => {
    let keychainCalled = false;
    const runner = async () => {
      keychainCalled = true;
      return output("");
    };
    const deepseekEnvKey = `deepseek-${"env"}-key`;
    expect(await resolveApiKey(runner, "deepseek-v4-flash", {
      DEEPSEEK_API_KEY: deepseekEnvKey,
      OPENAI_API_KEY: "openai-env-key",
    })).toBe("deepseek-env-key");
    expect(await resolveApiKey(runner, "gpt-4o-mini", {
      OPENAI_API_KEY: "openai-env-key",
    })).toBe("openai-env-key");
    expect(keychainCalled).toBe(false);
  });
});
