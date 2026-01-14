import { describe, expect, it } from "vitest";
import { mergeChildEnv } from "./env.js";

describe("mergeChildEnv", () => {
  it("merges extra keys", () => {
    const m = mergeChildEnv({ FOO: "bar" });
    expect(m.FOO).toBe("bar");
  });
});
