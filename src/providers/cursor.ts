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

const PROVIDER_ID: ProviderId = "cursor";

interface CursorStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  call_id?: string;
  message?: unknown;
  tool_call?: unknown;
  model?: string;
  result?: string;
  is_error?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

interface CursorMessageContent {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
}

export class CursorBackend {
  readonly providerId = PROVIDER_ID;
  constructor(private readonly cfg: BackendConfig = {}) {}

  execute(prompt: string, opts: ExecOptions): ExecuteHandle {
    const execPath = this.cfg.executablePath?.trim() || "agent";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { push, iterate, close } = createMessageStream();

    let fullPrompt = prompt;
    if (opts.systemPrompt) {
      fullPrompt = opts.systemPrompt + "\n\n---\n\n" + prompt;
    }

    const args = buildCursorArgs(opts);
    args.push(fullPrompt);

    const result = new Promise<Result>((resolve) => {
      const child = spawn(execPath, args, {
        cwd: opts.cwd,
        env: mergeChildEnv(this.cfg.env),
        stdio: ["ignore", "pipe", "pipe"],
      });

      const start = Date.now();
      let sessionId = "";
      let model = "";
      let finalStatus: Result["status"] = "completed";
      let finalError = "";
      let outputText = "";
      let usage: CursorStreamEvent["usage"];

      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

      const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

      void (async () => {
        try {
          for await (const raw of rl) {
            const line = String(raw).trim();
            if (!line) continue;
            let msg: CursorStreamEvent;
            try {
              msg = JSON.parse(line) as CursorStreamEvent;
            } catch {
              continue;
            }
            if (msg.session_id) sessionId = msg.session_id;
            switch (msg.type) {
              case "system":
                if (msg.model) model = msg.model;
                push({ type: "status", status: "running" });
                break;
              case "assistant":
                handleAssistant(msg, push, () => {});
                break;
              case "tool_call":
                handleToolCall(msg, push);
                break;
              case "result":
                if (msg.result) outputText = msg.result;
                if (msg.is_error) {
                  finalStatus = "failed";
                  finalError = msg.result ?? "";
                }
                if (msg.usage) usage = msg.usage;
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
            finalError = `cursor exited with code ${code}`;
          }
          const usageMap: Record<string, TokenUsage> = {};
          if (usage && (usage.inputTokens || usage.outputTokens)) {
            const mk = model || opts.model || "unknown";
            usageMap[mk] = {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              cacheReadTokens: usage.cacheReadTokens ?? 0,
              cacheWriteTokens: usage.cacheWriteTokens ?? 0,
            };
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

function buildCursorArgs(opts: ExecOptions): string[] {
  const args = ["-p", "--force", "--trust", "--output-format", "stream-json"];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }
  return args;
}

function handleAssistant(
  msg: CursorStreamEvent,
  push: (m: Message) => void,
  _acc: () => void,
): void {
  if (!msg.message) return;
  const content = msg.message as CursorMessageContent;
  if (!content.content) return;
  for (const block of content.content) {
    if (block.type === "text" && block.text) {
      push({ type: "text", content: block.text });
    }
  }
}

function handleToolCall(msg: CursorStreamEvent, push: (m: Message) => void): void {
  if (!msg.tool_call) return;
  const raw = msg.tool_call as Record<string, unknown>;
  if (msg.subtype === "started") {
    const { name, input } = extractCursorToolInfo(raw);
    push({ type: "tool-use", tool: name, callId: msg.call_id, input });
  } else if (msg.subtype === "completed") {
    const { name } = extractCursorToolInfo(raw);
    const out = extractCursorToolResult(raw);
    push({ type: "tool-result", tool: name, callId: msg.call_id, output: out });
  }
}

function extractCursorToolInfo(raw: Record<string, unknown>): {
  name: string;
  input: Record<string, unknown> | undefined;
} {
  if (raw.readToolCall) {
    const r = raw.readToolCall as { args?: Record<string, unknown> };
    return { name: "read_file", input: r.args };
  }
  if (raw.writeToolCall) {
    const r = raw.writeToolCall as { args?: Record<string, unknown> };
    return { name: "write_file", input: r.args };
  }
  if (raw.function) {
    const fn = raw.function as { name?: string; arguments?: string };
    let args: Record<string, unknown> | undefined;
    if (fn.arguments) {
      try {
        args = JSON.parse(fn.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    return { name: fn.name ?? "unknown", input: args };
  }
  return { name: "unknown", input: undefined };
}

function extractCursorToolResult(raw: Record<string, unknown>): string {
  if (raw.readToolCall) {
    const r = raw.readToolCall as {
      result?: { success?: { content?: string } };
    };
    if (r.result?.success?.content) return r.result.success.content;
  }
  if (raw.writeToolCall) {
    const r = raw.writeToolCall as {
      result?: { success?: { path?: string; linesCreated?: number; fileSize?: number } };
    };
    const s = r.result?.success;
    if (s?.path) {
      return `wrote ${s.path} (${s.linesCreated ?? 0} lines, ${s.fileSize ?? 0} bytes)`;
    }
  }
  return JSON.stringify(raw);
}
