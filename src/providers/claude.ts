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

const PROVIDER_ID: ProviderId = "claude";

interface ClaudeSDKMessage {
  type: string;
  message?: unknown;
  session_id?: string;
  result?: string;
  is_error?: boolean;
  log?: { level?: string; message?: string };
}

interface ClaudeMessageContent {
  role?: string;
  model?: string;
  content?: ClaudeContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

export class ClaudeBackend {
  readonly providerId = PROVIDER_ID;
  constructor(private readonly cfg: BackendConfig = {}) {}

  execute(prompt: string, opts: ExecOptions): ExecuteHandle {
    const execPath = this.cfg.executablePath?.trim() || "claude";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { push, iterate, close } = createMessageStream();

    const result = new Promise<Result>((resolve) => {
      const child = spawn(execPath, buildClaudeArgs(opts), {
        cwd: opts.cwd,
        env: mergeChildEnv(this.cfg.env),
        stdio: ["pipe", "pipe", "pipe"],
      });

      const start = Date.now();
      let sessionId = "";
      let finalStatus: Result["status"] = "completed";
      let finalError = "";
      const usage: Record<string, TokenUsage> = {};
      let outputText = "";

      const stdin = child.stdin;
      if (!stdin) {
        close();
        resolve({
          status: "failed",
          output: "",
          error: "no stdin",
          durationMs: 0,
          sessionId: "",
          usage: {},
        });
        return;
      }

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeoutMs);

      void writeClaudeInput(stdin, prompt)
        .then(() => stdin.end())
        .catch(() => stdin.end());

      const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

      void (async () => {
        try {
          for await (const raw of rl) {
            const line = String(raw).trim();
            if (!line) continue;
            let msg: ClaudeSDKMessage;
            try {
              msg = JSON.parse(line) as ClaudeSDKMessage;
            } catch {
              continue;
            }
            switch (msg.type) {
              case "assistant":
                handleAssistant(msg, push, usage);
                break;
              case "user":
                handleUser(msg, push);
                break;
              case "system":
                if (msg.session_id) sessionId = msg.session_id;
                push({ type: "status", status: "running" });
                break;
              case "result":
                if (msg.session_id) sessionId = msg.session_id;
                if (msg.result !== undefined && msg.result !== "") {
                  outputText = msg.result;
                }
                if (msg.is_error) {
                  finalStatus = "failed";
                  finalError = msg.result ?? "error";
                }
                break;
              case "log":
                if (msg.log?.message) {
                  push({ type: "log", level: msg.log.level, content: msg.log.message });
                }
                break;
              default:
                break;
            }
          }
        } finally {
          child.stdout?.destroy();
        }

        child.stderr?.on("data", () => {});

        try {
          const [code] = (await once(child, "close")) as [number | null];
          clearTimeout(timer);
          close();
          const durationMs = Date.now() - start;
          if (finalStatus === "completed" && code !== 0 && code !== null) {
            finalStatus = "failed";
            finalError = `claude exited with code ${code}`;
          }
          resolve({
            status: finalStatus,
            output: outputText,
            error: finalError,
            durationMs,
            sessionId,
            usage,
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
            usage,
          });
        }
      })();
    });

    return { messages: iterate(), result };
  }
}

function handleAssistant(
  msg: ClaudeSDKMessage,
  push: (m: Message) => void,
  usage: Record<string, TokenUsage>,
): void {
  const content = msg.message as ClaudeMessageContent | undefined;
  if (!content?.content) return;
  const model = content.model ?? "unknown";
  if (content.usage && content.model) {
    const u = usage[model] ?? emptyUsage();
    u.inputTokens += content.usage.input_tokens ?? 0;
    u.outputTokens += content.usage.output_tokens ?? 0;
    u.cacheReadTokens += content.usage.cache_read_input_tokens ?? 0;
    u.cacheWriteTokens += content.usage.cache_creation_input_tokens ?? 0;
    usage[model] = u;
  }
  for (const block of content.content) {
    if (block.type === "text" && block.text) {
      push({ type: "text", content: block.text });
    } else if (block.type === "thinking" && block.text) {
      push({ type: "thinking", content: block.text });
    } else if (block.type === "tool_use") {
      let input: Record<string, unknown> | undefined;
      if (block.input !== undefined && typeof block.input === "object" && block.input !== null) {
        input = block.input as Record<string, unknown>;
      }
      push({
        type: "tool-use",
        tool: block.name,
        callId: block.id,
        input,
      });
    }
  }
}

function handleUser(msg: ClaudeSDKMessage, push: (m: Message) => void): void {
  const content = msg.message as ClaudeMessageContent | undefined;
  if (!content?.content) return;
  for (const block of content.content) {
    if (block.type === "tool_result") {
      let out = "";
      if (block.content !== undefined) {
        out = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
      }
      push({
        type: "tool-result",
        callId: block.tool_use_id,
        output: out,
      });
    }
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

function buildClaudeArgs(opts: ExecOptions): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
  ];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.maxTurns && opts.maxTurns > 0) {
    args.push("--max-turns", String(opts.maxTurns));
  }
  if (opts.systemPrompt) {
    args.push("--append-system-prompt", opts.systemPrompt);
  }
  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }
  return args;
}

async function writeClaudeInput(
  stdin: NodeJS.WritableStream,
  prompt: string,
): Promise<void> {
  const payload = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  };
  const line = JSON.stringify(payload) + "\n";
  await new Promise<void>((resolve, reject) => {
    stdin.write(line, (err) => (err ? reject(err) : resolve()));
  });
}
