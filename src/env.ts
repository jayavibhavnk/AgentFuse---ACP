import { env } from "node:process";

/** Merge extra env into process env, filtering Claude Code daemon keys (Multica parity). */
export function mergeChildEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const k of Object.keys(out)) {
    if (isFilteredChildEnvKey(k)) {
      delete out[k];
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      out[k] = v;
    }
  }
  return out;
}

function isFilteredChildEnvKey(key: string): boolean {
  return (
    key === "CLAUDECODE" ||
    key.startsWith("CLAUDECODE_") ||
    key.startsWith("CLAUDE_CODE_")
  );
}
