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

const PROVIDER_ID: ProviderId = "codex";

export class CodexBackend {
  readonly providerId = PROVIDER_ID;
  constructor(private readonly cfg: BackendConfig = {}) {}

  execute(prompt: string, opts: ExecOptions): ExecuteHandle {
    const execPath = this.cfg.executablePath?.trim() || "codex";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { push, iterate, close } = createMessageStream();

    const result = new Promise<Result>((resolve) => {
      const child = spawn(execPath, ["app-server", "--listen", "stdio://"], {
        cwd: opts.cwd,
        env: mergeChildEnv(this.cfg.env),
        stdio: ["pipe", "pipe", "pipe"],
      });

      const start = Date.now();
      const stdin = child.stdin!;
      const stdout = child.stdout!;
      let finalStatus: Result["status"] = "completed";
      let finalError = "";
      let outputText = "";
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };

      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

      let resolveTurn!: (aborted: boolean) => void;
      const turnDonePromise = new Promise<boolean>((r) => {
        resolveTurn = r;
      });

      const client = new CodexClient(stdin, (msg) => {
        if (msg.type === "text" && msg.content) {
          outputText += msg.content;
        }
        push(msg);
      }, (aborted) => {
        resolveTurn(aborted);
      });

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
            clientInfo: { name: "agentfuse", title: "Agentfuse", version: "0.1.0" },
            capabilities: { experimentalApi: true },
          });
          client.notify("initialized");

          const tr = await client.request("thread/start", {
            model: opts.model || null,
            modelProvider: null,
            profile: null,
            cwd: opts.cwd ?? null,
            approvalPolicy: null,
            sandbox: null,
            config: null,
            baseInstructions: null,
            developerInstructions: opts.systemPrompt || null,
            compactPrompt: null,
            includeApplyPatchTool: null,
            experimentalRawEvents: false,
            persistExtendedHistory: true,
          });
          const threadId = extractThreadId(tr);
          if (!threadId) {
            throw new Error("no thread id");
          }
          client.threadId = threadId;

          await client.request("turn/start", {
            threadId,
            input: [{ type: "text", text: prompt }],
          });

          const aborted = await Promise.race([
            turnDonePromise,
            new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs)),
          ]);

          if (aborted) {
            finalStatus = "aborted";
            finalError = "turn aborted";
          }
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
        if (usage.inputTokens || usage.outputTokens || usage.cacheReadTokens || usage.cacheWriteTokens) {
          usageMap[model] = usage;
        }
        resolve({
          status: finalStatus,
          output: outputText,
          error: finalError,
          durationMs,
          sessionId: client.threadId ?? "",
          usage: usageMap,
        });
      })();
    });

    return { messages: iterate(), result };
  }
}

function extractThreadId(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  const r = result as { thread?: { id?: string } };
  return r.thread?.id ?? "";
}

type RpcResult = { result?: unknown; error?: { code: number; message: string } };

class CodexClient {
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: RpcResult) => void; method: string }>();
  threadId = "";

  constructor(
    private stdin: NodeJS.WritableStream,
    private onMessage: (m: Message) => void,
    private onTurnDone: (aborted: boolean) => void,
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

  notify(method: string): void {
    const msg = { jsonrpc: "2.0", method };
    const line = JSON.stringify(msg) + "\n";
    this.stdin.write(line);
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
    if ("id" in raw && raw.method !== undefined) {
      const id = Number(raw.id);
      const method = String(raw.method);
      const resp = this.respondServerRequest(method);
      const out = { jsonrpc: "2.0", id, result: resp };
      this.stdin.write(JSON.stringify(out) + "\n");
      return;
    }
    if (raw.method !== undefined) {
      this.handleNotification(String(raw.method), raw.params as Record<string, unknown> | undefined);
    }
  }

  respondServerRequest(method: string): Record<string, unknown> {
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "execCommandApproval"
    ) {
      return { decision: "accept" };
    }
    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
      return { decision: "accept" };
    }
    return {};
  }

  handleNotification(method: string, params: Record<string, unknown> | undefined): void {
    if (method === "codex/event" || method.startsWith("codex/event/")) {
      const msg = params?.msg as Record<string, unknown> | undefined;
      if (msg) this.handleLegacyEvent(msg);
      return;
    }
    if (
      method === "turn/started" ||
      method === "turn/completed" ||
      method === "thread/started" ||
      method.startsWith("item/")
    ) {
      this.handleRawNotification(method, params ?? {});
    }
  }

  handleLegacyEvent(msg: Record<string, unknown>): void {
    const t = String(msg.type ?? "");
    if (t === "task_started") {
      this.onMessage({ type: "status", status: "running" });
    }
    if (t === "agent_message") {
      const text = String(msg.message ?? "");
      if (text) this.onMessage({ type: "text", content: text });
    }
    if (t === "task_complete") {
      this.onTurnDone(false);
    }
    if (t === "turn_aborted") {
      this.onTurnDone(true);
    }
  }

  handleRawNotification(method: string, params: Record<string, unknown>): void {
    if (method === "turn/started") {
      this.onMessage({ type: "status", status: "running" });
    }
    if (method === "turn/completed") {
      const turn = params.turn as Record<string, unknown> | undefined;
      const status = turn && String((turn as { status?: string }).status ?? "");
      const aborted =
        status === "cancelled" ||
        status === "canceled" ||
        status === "aborted" ||
        status === "interrupted";
      this.onTurnDone(aborted);
    }
    if (method.startsWith("item/")) {
      const item = params.item as Record<string, unknown> | undefined;
      if (!item) return;
      const it = String(item.type ?? "");
      if (method === "item/completed" && it === "agentMessage") {
        const text = String(item.text ?? "");
        const phase = String(item.phase ?? "");
        if (text) this.onMessage({ type: "text", content: text });
        if (phase === "final_answer") {
          this.onTurnDone(false);
        }
      }
    }
  }
}
