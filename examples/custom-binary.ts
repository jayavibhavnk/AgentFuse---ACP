/**
 * Use a custom executable path (wrapper script or absolute path).
 *
 *   npm run build
 *   AGENTFUSE_CLAUDE_PATH=claude node --experimental-strip-types examples/custom-binary.ts
 */
import { createBackend, type ProviderId } from "../dist/index.js";

const provider = (process.argv[2] ?? "claude") as ProviderId;
const prompt = process.argv.slice(3).join(" ") || "Say hello in one word.";

const envKey = `AGENTFUSE_${provider.toUpperCase()}_PATH`;
const fromEnv = process.env[envKey];
const executablePath = fromEnv ?? undefined;

if (executablePath) {
  console.error(`Using ${envKey}=${executablePath}`);
}

const backend = createBackend(provider, { executablePath });
const { messages, result } = backend.execute(prompt, { cwd: process.cwd() });

for await (const m of messages) {
  if (m.type === "text" && m.content) process.stdout.write(m.content);
}

const r = await result;
console.error("\n---\n", r.status, r.error || "");
process.exit(r.status === "completed" ? 0 : 1);
