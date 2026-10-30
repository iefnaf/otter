export type ProtectionSource = "builtin" | "user";

export interface ProtectionRule {
  readonly name: string;
  readonly source: ProtectionSource;
}

export type ProtectionMatch = ProtectionRule;

const builtInExecutableNames = [
  "clash",
  "clash verge",
  "clash verge helper",
  "clash-verge",
  "clash-meta",
  "clashx",
  "clashx pro",
  "surge",
  "surge-cli",
  "v2ray",
  "v2ray-core",
  "v2rayx",
  "mihomo",
  "sing-box",
  "shadowrocket",
  "tailscale",
  "tailscaled",
] as const;

export const builtInProtectionRules: readonly ProtectionRule[] =
  builtInExecutableNames.map((name) => ({
    name,
    source: "builtin" satisfies ProtectionSource,
  }));

export function normalizeExecutableRule(executable: string): string {
  return executable.trim().toLowerCase();
}

export function isBuiltInProtectionRule(executable: string): boolean {
  const name = normalizeExecutableRule(executable);
  return builtInProtectionRules.some((rule) => rule.name === name);
}

export function protectionRules(
  userExecutables: readonly string[],
): readonly ProtectionRule[] {
  const rules = new Map<string, ProtectionRule>();
  for (const rule of builtInProtectionRules) rules.set(rule.name, rule);
  for (const executable of userExecutables) {
    const name = normalizeExecutableRule(executable);
    if (name === "" || rules.has(name)) continue;
    rules.set(name, { name, source: "user" });
  }
  return [...rules.values()];
}

export function matchProtection(
  executable: string,
  rules: readonly ProtectionRule[],
): ProtectionMatch | null {
  const name = normalizeExecutableRule(executable);
  return rules.find((rule) => rule.name === name) ?? null;
}
