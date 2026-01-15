/**
 * Stream all normalized messages as NDJSON, then the final Result.
 *
 *   npm run build && node --experimental-strip-types examples/stream-events.ts claude "prompt"
 */
import { createBackend, type ProviderId } from "../dist/index.js";

const provider = (process.argv[2] ?? "claude") as ProviderId;
const prompt = process.argv.slice(3).join(" ") || "Reply with hello.";

const backend = createBackend(provider, {});
const { messages, result } = backend.execute(prompt, { cwd: process.cwd() });

for await (const m of messages) {
  console.log(JSON.stringify({ kind: "message", ...m }));
}

const r = await result;
console.log(JSON.stringify({ kind: "RESULT", ...r }));

process.exit(r.status === "completed" ? 0 : 1);
