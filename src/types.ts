/**
 * Normalized event and result types — aligned with Multica's server/pkg/agent.
 */

export type MessageType =
  | "text"
  | "thinking"
  | "tool-use"
  | "tool-result"
  | "status"
  | "error"
  | "log";

export interface Message {
  type: MessageType;
  content?: string;
  tool?: string;
  callId?: string;
  input?: Record<string, unknown>;
  output?: string;
  status?: string;
  level?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Result {
  status: "completed" | "failed" | "aborted" | "timeout";
  output: string;
  error: string;
  durationMs: number;
  sessionId: string;
  usage: Record<string, TokenUsage>;
}

export interface ExecOptions {
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  timeoutMs?: number;
  resumeSessionId?: string;
}

export interface BackendConfig {
  executablePath?: string;
  env?: Record<string, string>;
}

export type ProviderId =
  | "claude"
  | "cursor"
  | "codex"
  | "opencode"
  | "openclaw"
  | "hermes";

export interface ExecuteHandle {
  messages: AsyncIterable<Message>;
  result: Promise<Result>;
}

export interface AgentBackend {
  readonly providerId: ProviderId;
  execute(prompt: string, opts: ExecOptions): ExecuteHandle;
}

export interface DetectedCLI {
  providerId: ProviderId;
  path: string;
  version: string;
}
