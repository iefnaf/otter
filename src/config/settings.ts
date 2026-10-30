import { readFile, chmod, rename, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const settingsSchema = z.strictObject({
  model: z.string().min(1).default("gpt-4o-mini"),
  apiBase: z.string().url().default("https://api.openai.com/v1"),
  enableExecution: z.literal(false).default(false),
});

export type Settings = z.infer<typeof settingsSchema>;

export function settingsPath(configRoot: string): string {
  return join(configRoot, "settings.json");
}

export async function readSettings(configRoot: string): Promise<Settings> {
  const path = settingsPath(configRoot);
  try {
    const content = await readFile(path, "utf8");
    return settingsSchema.parse(JSON.parse(content));
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return settingsSchema.parse({});
    }
    throw new Error(`invalid settings file ${path}`);
  }
}

export async function writeSettings(
  configRoot: string,
  settings: Settings,
): Promise<Settings> {
  const parsed = settingsSchema.parse(settings);
  await mkdir(configRoot, { recursive: true });
  const destination = settingsPath(configRoot);
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  return parsed;
}
