import type { AgentBackend, BackendConfig, ProviderId } from "./types.js";
import { ClaudeBackend } from "./providers/claude.js";
import { CodexBackend } from "./providers/codex.js";
import { CursorBackend } from "./providers/cursor.js";
import { HermesBackend } from "./providers/hermes.js";
import { OpencodeBackend } from "./providers/opencode.js";
import { OpenclawBackend } from "./providers/openclaw.js";

export const SUPPORTED_PROVIDERS: ProviderId[] = [
  "claude",
  "cursor",
  "codex",
  "opencode",
  "openclaw",
  "hermes",
];

export function createBackend(id: ProviderId, cfg: BackendConfig = {}): AgentBackend {
  switch (id) {
    case "claude":
      return new ClaudeBackend(cfg);
    case "cursor":
      return new CursorBackend(cfg);
    case "codex":
      return new CodexBackend(cfg);
    case "opencode":
      return new OpencodeBackend(cfg);
    case "openclaw":
      return new OpenclawBackend(cfg);
    case "hermes":
      return new HermesBackend(cfg);
    default: {
      const _x: never = id;
      throw new Error(`unknown provider: ${_x}`);
    }
  }
}
