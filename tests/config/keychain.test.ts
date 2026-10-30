import { describe, expect, test } from "bun:test";
import { setApiKey } from "../../src/config/keychain.ts";
import { output } from "../helpers.ts";

describe("keychain", () => {
  test("provides the API key and its confirmation on stdin", async () => {
    const stdin: string[] = [];
    await setApiKey(async (_command, args, options) => {
      if (options.stdin !== undefined) stdin.push(options.stdin);
      expect(args).toContain("-w");
      return output("");
    }, "secret-key");

    expect(stdin).toEqual(["secret-key\nsecret-key\n"]);
  });
});
