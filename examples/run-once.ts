/**
 * Run after build:
 *   npm run build && node examples/run-once.ts claude "Hello"
 */
import { createBackend, type ProviderId } from "../dist/index.js";

const provider = (process.argv[2] ?? "claude") as ProviderId;
const prompt = process.argv.slice(3).join(" ") || "Say hello.";

const backend = createBackend(provider, {});
const { messages, result } = backend.execute(prompt, { cwd: process.cwd() });

for await (const m of messages) {
  if (m.type === "text" && m.content) process.stdout.write(m.content);
}
const r = await result;
console.error("\n---\n", r.status, r.error || "");
process.exit(r.status === "completed" ? 0 : 1);
