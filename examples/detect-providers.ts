/**
 * Print CLIs discovered on PATH (same logic as `agentfuse detect`).
 *
 *   npm run build && node --experimental-strip-types examples/detect-providers.ts
 */
import { detectAll } from "../dist/index.js";

const list = await detectAll();
if (list.length === 0) {
  console.log("No supported CLIs found on PATH.");
  process.exit(1);
}

for (const d of list) {
  console.log(`${d.providerId}\t${d.path}\t${d.version || "(version unknown)"}`);
}
