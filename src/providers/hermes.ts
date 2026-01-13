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

const PROVIDER_ID: ProviderId = "hermes";

type RpcResult = { result?: unknown; error?: { code: number; message: string } };

export class HermesBackend {
  readonly providerId = PROVIDER_ID;
  constructor(private readonly cfg: BackendConfig = {}) {}

  execute(prompt: string, opts: ExecOptions): ExecuteHandle {
    const execPath = this.cfg.executablePath?.trim() || "hermes";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { push, iterate, close } = createMessageStream();

    const result = new Promise<Result>((resolve) => {
      const env = { ...mergeChildEnv(this.cfg.env), HERMES_YOLO_MODE: "1" };
      const child = spawn(execPath, ["acp"], {
        cwd: opts.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const start = Date.now();
      const stdin = child.stdin!;
      const stdout = child.stdout!;
      let finalStatus: Result["status"] = "completed";
      let finalError = "";
      let outputText = "";
      let sessionId = "";
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };

      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

      const client = new HermesClient(
        stdin,
        (msg) => {
          if (msg.type === "text" && msg.content) outputText += msg.content;
          push(msg);
        },
        (u) => {
          usage.inputTokens = Math.max(usage.inputTokens, u.inputTokens);
          usage.outputTokens = Math.max(usage.outputTokens, u.outputTokens);
          usage.cacheReadTokens = Math.max(usage.cacheReadTokens, u.cacheReadTokens);
        },
      );

      const reader = createInterface({ input: stdout, crlfDelay: Infinity });
      void (async () => {
        try {
          for await (const line of reader) {
            client.handleLine(String(line).trim());
          }
        } finally {
          client.closeAllPending(new Error("eof"));
        }
      })();

      void (async () => {
        try {
          await client.request("initialize", {
            protocolVersion: 1,
            clientInfo: { name: "agentfuse", version: "0.1.0" },
            clientCapabilities: {},
          });

          const cwd = opts.cwd || ".";
          if (opts.resumeSessionId) {
            await client.request("session/resume", {
              cwd,
              sessionId: opts.resumeSessionId,
            });
            sessionId = opts.resumeSessionId;
          } else {
            const sr = await client.request("session/new", {
              cwd,
              mcpServers: [],
            });
            sessionId = extractSessionId(sr);
            if (!sessionId) throw new Error("hermes session/new: no session id");
          }

          let userText = prompt;
          if (opts.systemPrompt) {
            userText = opts.systemPrompt + "\n\n---\n\n" + prompt;
          }

          await client.request("session/prompt", {
            sessionId,
            prompt: [{ type: "text", text: userText }],
          });
        } catch (e) {
          finalStatus = "failed";
          finalError = String(e);
        }
        stdin.end();
        clearTimeout(timer);
        try {
          await once(child, "close");
        } catch {
          /* ignore */
        }
        close();
        const durationMs = Date.now() - start;
        const model = opts.model || "unknown";
        const usageMap: Record<string, TokenUsage> = {};
        if (usage.inputTokens || usage.outputTokens || usage.cacheReadTokens) {
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
      })();
    });

    return { messages: iterate(), result };
  }
}

function extractSessionId(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  return String((result as { sessionId?: string }).sessionId ?? "");
}

class HermesClient {
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: RpcResult) => void; method: string }>();

  constructor(
    private stdin: NodeJS.WritableStream,
    private onMessage: (m: Message) => void,
    private onUsage: (u: TokenUsage) => void,
  ) {}

  async request(method: string, params: unknown): Promise<unknown> {
    this.nextId++;
    const id = this.nextId;
    const res = await new Promise<RpcResult>((resolve, reject) => {
      this.pending.set(id, { resolve, method });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("rpc timeout: " + method));
        }
      }, 600_000);
      const msg = { jsonrpc: "2.0", id, method, params };
      const line = JSON.stringify(msg) + "\n";
      void this.stdin.write(line, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
    if (res.error) {
      throw new Error(`${method}: ${res.error.message}`);
    }
    return res.result;
  }

  closeAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      p.resolve({ error: { code: -1, message: err.message } });
    }
    this.pending.clear();
  }

  handleLine(line: string): void {
    if (!line) return;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if ("id" in raw && raw.result !== undefined) {
      const id = Number(raw.id);
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        p.resolve({ result: raw.result });
      }
      return;
    }
    if ("id" in raw && raw.error !== undefined) {
      const id = Number(raw.id);
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        p.resolve({ error: raw.error as { code: number; message: string } });
      }
      return;
    }
    if (raw.method === "session/update") {
      const params = raw.params as Record<string, unknown> | undefined;
      const update = params?.update as Record<string, unknown> | undefined;
      if (!update) return;
      const su = String(update.sessionUpdate ?? "");
      if (su === "agent_message_chunk") {
        const content = update.content as { text?: string } | undefined;
        const text = content?.text ?? "";
        if (text) this.onMessage({ type: "text", content: text });
      }
      if (su === "agent_thought_chunk") {
        const content = update.content as { text?: string } | undefined;
        const text = content?.text ?? "";
        if (text) this.onMessage({ type: "thinking", content: text });
      }
      if (su === "usage_update") {
        const u = update.usage as
          | {
              inputTokens?: number;
              outputTokens?: number;
              cachedReadTokens?: number;
            }
          | undefined;
        if (u) {
          this.onUsage({
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            cacheReadTokens: u.cachedReadTokens ?? 0,
            cacheWriteTokens: 0,
          });
        }
      }
    }
  }
}
