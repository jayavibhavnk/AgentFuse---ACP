#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createBackend, detectAll } from "../index.js";
import type { ProviderId } from "../types.js";

const providers = new Set<string>([
  "claude",
  "cursor",
  "codex",
  "opencode",
  "openclaw",
  "hermes",
]);

function printHelp(): void {
  console.log(`agentfuse — unified coding agent CLI harness

Usage:
  agentfuse detect [--json]
  agentfuse run --provider <id> [--cwd <dir>] [--model <m>] [--json] <prompt>
  agentfuse --help

Examples:
  agentfuse detect
  agentfuse run --provider claude "Say hello in one sentence."
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    printHelp();
    process.exit(0);
  }

  const cmd = argv[0];
  if (cmd === "detect") {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { json: { type: "boolean", short: "j" } },
    });
    const list = await detectAll();
    if (values.json) {
      console.log(JSON.stringify(list, null, 2));
    } else {
      for (const d of list) {
        console.log(`${d.providerId}\t${d.path}\t${d.version || "(v?)"}`);
      }
    }
    return;
  }

  if (cmd === "run") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: {
        provider: { type: "string", short: "p" },
        cwd: { type: "string" },
        model: { type: "string" },
        json: { type: "boolean", short: "j" },
      },
      allowPositionals: true,
    });
    const pid = values.provider as string | undefined;
    if (!pid || !providers.has(pid)) {
      console.error("agentfuse run: --provider <claude|cursor|codex|opencode|openclaw|hermes> is required");
      process.exit(2);
    }
    const prompt = positionals.join(" ").trim();
    if (!prompt) {
      console.error("agentfuse run: prompt text is required");
      process.exit(2);
    }
    const backend = createBackend(pid as ProviderId, {});
    const { messages, result } = backend.execute(prompt, {
      cwd: values.cwd,
      model: values.model,
    });
    for await (const m of messages) {
      if (values.json) {
        console.log(JSON.stringify(m));
      } else {
        const kind = m.type;
        if (kind === "text" && m.content) console.log(m.content);
        else if (kind === "error") console.error(m.content ?? "");
        else if (kind === "log") console.error(`[log] ${m.content ?? ""}`);
      }
    }
    const r = await result;
    if (values.json) {
      console.log(JSON.stringify({ result: r }));
    } else {
      if (r.status !== "completed") {
        console.error(`status: ${r.status} ${r.error}`);
        process.exit(1);
      }
    }
    return;
  }

  printHelp();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
