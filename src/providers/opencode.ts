import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mergeChildEnv } from "../env.js";
import { createMessageStream, DEFAULT_TIMEOUT_MS } from "../session.js";
import type {
  BackendConfig,
  ExecOptions,
  ExecuteHandle,
  Message,
  ProviderId,
  Result,
  TokenUsage,
} from "../types.js";

const PROVIDER_ID: ProviderId = "opencode";

interface OpencodeEvent {
  type: string;
  sessionID?: string;
  part: {
    text?: string;
    tool?: string;
    callID?: string;
    state?: {
      status?: string;
      input?: unknown;
      output?: unknown;
    };
    tokens?: {
      input: number;
      output: number;
      cache?: { read: number; write: number };
    };
  };
  error?: { name?: string; data?: { message?: string } };
}

export class OpencodeBackend {
  readonly providerId = PROVIDER_ID;
  constructor(private readonly cfg: BackendConfig = {}) {}

  execute(prompt: string, opts: ExecOptions): ExecuteHandle {
    const execPath = this.cfg.executablePath?.trim() || "opencode";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { push, iterate, close } = createMessageStream();

    const args = ["run", "--format", "json"];
    if (opts.model) args.push("--model", opts.model);
    if (opts.systemPrompt) args.push("--prompt", opts.systemPrompt);
    if (opts.resumeSessionId) args.push("--session", opts.resumeSessionId);
    args.push(prompt);

    const env = { ...mergeChildEnv(this.cfg.env), OPENCODE_PERMISSION: '{"*":"allow"}' };

    const result = new Promise<Result>((resolve) => {
      const child = spawn(execPath, args, {
        cwd: opts.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const start = Date.now();
      let sessionId = "";
      let finalStatus: Result["status"] = "completed";
      let finalError = "";
      let outputText = "";
      const usage: TokenUsage = emptyUsage();

      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

      void (async () => {
        try {
          for await (const raw of rl) {
            const line = String(raw).trim();
            if (!line) continue;
            let ev: OpencodeEvent;
            try {
              ev = JSON.parse(line) as OpencodeEvent;
            } catch {
              continue;
            }
            if (ev.sessionID) sessionId = ev.sessionID;
            switch (ev.type) {
              case "text": {
                const t = ev.part.text ?? "";
                if (t) {
                  outputText += t;
                  push({ type: "text", content: t });
                }
                break;
              }
              case "tool_use":
                handleToolUse(ev, push);
                break;
              case "error": {
                const errMsg =
                  ev.error?.data?.message ?? ev.error?.name ?? "opencode error";
                push({ type: "error", content: errMsg });
                finalStatus = "failed";
                finalError = errMsg;
                break;
              }
              case "step_start":
                push({ type: "status", status: "running" });
                break;
              case "step_finish":
                if (ev.part.tokens) {
                  usage.inputTokens += ev.part.tokens.input ?? 0;
                  usage.outputTokens += ev.part.tokens.output ?? 0;
                  if (ev.part.tokens.cache) {
                    usage.cacheReadTokens += ev.part.tokens.cache.read ?? 0;
                    usage.cacheWriteTokens += ev.part.tokens.cache.write ?? 0;
                  }
                }
                break;
              default:
                break;
            }
          }
        } finally {
          child.stdout?.destroy();
        }

        try {
          const [code] = (await once(child, "close")) as [number | null];
          clearTimeout(timer);
          close();
          const durationMs = Date.now() - start;
          if (finalStatus === "completed" && code !== 0 && code !== null) {
            finalStatus = "failed";
            finalError = `opencode exited with code ${code}`;
          }
          const model = opts.model || "unknown";
          const usageMap: Record<string, TokenUsage> = {};
          if (
            usage.inputTokens ||
            usage.outputTokens ||
            usage.cacheReadTokens ||
            usage.cacheWriteTokens
          ) {
            usageMap[model] = usage;
          }
          resolve({
            status: finalStatus,
            output: outputText,
            error: finalError,
            durationMs,
            sessionId,
            usage: usageMap,
          });
        } catch (e) {
          clearTimeout(timer);
          close();
          resolve({
            status: "failed",
            output: outputText,
            error: String(e),
            durationMs: Date.now() - start,
            sessionId,
            usage: {},
          });
        }
      })();
    });

    return { messages: iterate(), result };
  }
}

function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function handleToolUse(ev: OpencodeEvent, push: (m: Message) => void): void {
  const st = ev.part.state;
  let input: Record<string, unknown> | undefined;
  if (st?.input !== undefined) {
    if (typeof st.input === "object" && st.input !== null) {
      input = st.input as Record<string, unknown>;
    }
  }
  push({
    type: "tool-use",
    tool: ev.part.tool,
    callId: ev.part.callID,
    input,
  });
  if (st?.status === "completed") {
    const out = extractToolOutput(st.output);
    push({
      type: "tool-result",
      tool: ev.part.tool,
      callId: ev.part.callID,
      output: out,
    });
  }
}

function extractToolOutput(output: unknown): string {
  if (output === undefined || output === null) return "";
  if (typeof output === "string") return output;
  return JSON.stringify(output);
}
