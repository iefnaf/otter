import type { CommandOutput, CommandRunner } from "./types.ts";

export const localCommandRunner: CommandRunner = async (
  command,
  args,
  options,
): Promise<CommandOutput> => {
  const child = Bun.spawn([command, ...args], {
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });

  if (options.stdin !== undefined && child.stdin) {
    child.stdin.write(options.stdin);
    await child.stdin.end();
  }

  const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);

  return { stdout, stderr, exitCode };
};
