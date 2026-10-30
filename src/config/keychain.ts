import type { CommandRunner } from "../collectors/types.ts";

const service = "otter";
const account = "api-key";

export async function setApiKey(
  runner: CommandRunner,
  apiKey: string,
): Promise<void> {
  const output = await runner(
    "security",
    ["add-generic-password", "-U", "-s", service, "-a", account, "-w"],
    { timeoutMs: 10000, stdin: `${apiKey}\n` },
  );
  if (output.exitCode !== 0) {
    throw new Error(`Keychain write failed with code ${output.exitCode}`);
  }
}

export async function getApiKey(runner: CommandRunner): Promise<string | null> {
  const output = await runner(
    "security",
    ["find-generic-password", "-s", service, "-a", account, "-w"],
    { timeoutMs: 10000 },
  );
  if (output.exitCode === 0) return output.stdout.trim();
  if (output.stderr.includes("could not be found")) return null;
  throw new Error(`Keychain read failed with code ${output.exitCode}`);
}

export async function resolveApiKey(
  runner: CommandRunner,
  model: "gpt-4o-mini" | "deepseek-v4-flash",
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string | null> {
  const environmentKey = model === "deepseek-v4-flash" ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY;
  return environmentKey === undefined || environmentKey === "" ? getApiKey(runner) : environmentKey;
}

export async function clearApiKey(runner: CommandRunner): Promise<boolean> {
  const output = await runner(
    "security",
    ["delete-generic-password", "-s", service, "-a", account],
    { timeoutMs: 10000 },
  );
  if (output.exitCode === 0) return true;
  if (output.stderr.includes("could not be found")) return false;
  throw new Error(`Keychain delete failed with code ${output.exitCode}`);
}
