import { spawn } from "node:child_process";
import { once } from "node:events";
import { mergeChildEnv } from "../env.js";
import { createMessageStream, DEFAULT_TIMEOUT_MS } from "../session.js";
import type {
  BackendConfig,
  ExecOptions,
  ExecuteHandle,
  ProviderId,
  Result,
  TokenUsage,
} from "../types.js";

const PROVIDER_ID: ProviderId = "openclaw";

interface OpenclawResult {
  payloads?: Array<{ text?: string }>;
  meta?: {
    agentMeta?: Record<string, unknown>;
  };
}

export class OpenclawBackend {
  readonly providerId = PROVIDER_ID;
  constructor(private readonly cfg: BackendConfig = {}) {}

  execute(prompt: string, opts: ExecOptions): ExecuteHandle {
    const execPath = this.cfg.executablePath?.trim() || "openclaw";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { push, iterate, close } = createMessageStream();

    const sessionId =
      opts.resumeSessionId ?? `agentfuse-${Date.now().toString(36)}`;
    const args = ["agent", "--local", "--json", "--session-id", sessionId];
    if (opts.timeoutMs) {
      args.push("--timeout", String(Math.ceil(opts.timeoutMs / 1000)));
    }
    args.push("--message", prompt);

    const result = new Promise<Result>((resolve) => {
      const child = spawn(execPath, args, {
        cwd: opts.cwd,
        env: mergeChildEnv(this.cfg.env),
        stdio: ["ignore", "pipe", "pipe"],
      });

      const start = Date.now();
      const chunks: Buffer[] = [];

      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

      child.stderr?.on("data", (d: Buffer) => chunks.push(d));

      void (async () => {
        try {
          await once(child, "close");
        } finally {
          clearTimeout(timer);
        }
        const raw = Buffer.concat(chunks).toString("utf8");

        const parsed = parseOpenclawJson(raw);
        if (parsed.text) {
          push({ type: "text", content: parsed.text });
        }
        close();

        const durationMs = Date.now() - start;
        const model = opts.model || "unknown";
        const usageMap: Record<string, TokenUsage> = {};
        if (parsed.usage && (parsed.usage.inputTokens || parsed.usage.outputTokens)) {
          usageMap[model] = parsed.usage;
        }

        resolve({
          status: "completed",
          output: parsed.text,
          error: "",
          durationMs,
          sessionId: parsed.sessionId || sessionId,
          usage: usageMap,
        });
      })();
    });

    return { messages: iterate(), result };
  }
}

function parseOpenclawJson(raw: string): {
  text: string;
  sessionId: string;
  usage: TokenUsage;
} {
  let jsonStart = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "{") continue;
    try {
      const sub = raw.slice(i);
      const result = JSON.parse(sub) as OpenclawResult;
      if (result.payloads) {
        jsonStart = i;
        break;
      }
    } catch {
      continue;
    }
  }
  if (jsonStart < 0) {
    const t = raw.trim();
    return { text: t, sessionId: "", usage: emptyUsage() };
  }
  const result = JSON.parse(raw.slice(jsonStart)) as OpenclawResult;
  let text = "";
  if (result.payloads) {
    for (const p of result.payloads) {
      if (p.text) {
        if (text) text += "\n";
        text += p.text;
      }
    }
  }
  let sessionId = "";
  const meta = result.meta?.agentMeta;
  if (meta && typeof meta.sessionId === "string") {
    sessionId = meta.sessionId;
  }
  const usage = emptyUsage();
  if (meta && typeof meta.usage === "object" && meta.usage !== null) {
    const u = meta.usage as Record<string, unknown>;
    usage.inputTokens = num(u.input);
    usage.outputTokens = num(u.output);
    usage.cacheReadTokens = num(u.cacheRead);
    usage.cacheWriteTokens = num(u.cacheWrite);
  }
  return { text, sessionId, usage };
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  return 0;
}

function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}
