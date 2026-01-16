# Agentfuse

**Fuse any Node.js or TypeScript app with coding agent CLIs** — one interface for [Claude Code](https://github.com/anthropics/claude-code), Cursor (`agent`), Codex, OpenCode, OpenClaw, Hermes (ACP), and more.

Inspired by the agent abstraction in [Multica](https://github.com/multica-ai/multica) (`server/pkg/agent`). This package is **standalone**: no Multica runtime required.

## Install

```bash
npm install agentfuse
```

From a checkout: `npm install && npm run build`, then `node examples/run-once.ts` (Node 22+ with `--experimental-strip-types`) or run the compiled `dist` entry via the imports shown in `examples/run-once.ts`.

## Library

```typescript
import { createBackend, detectAll } from "agentfuse";

const installed = await detectAll();
const backend = createBackend("claude", {});
const { messages, result } = backend.execute("Fix the typo in README", {
  cwd: "/path/to/repo",
});

for await (const m of messages) {
  console.log(m.type, m.content);
}
console.log(await result);
```

## CLI

```bash
# List CLIs on your PATH
npx agentfuse detect

# Run a single prompt (streams text to stdout)
npx agentfuse run --provider claude "Explain what Agentfuse does in one sentence."
```

## Providers

| ID | Default binary | Notes |
|----|----------------|--------|
| `claude` | `claude` | Stream JSON |
| `cursor` | `agent` | Cursor headless CLI |
| `codex` | `codex` | `app-server` JSON-RPC |
| `opencode` | `opencode` | `run --format json` |
| `openclaw` | `openclaw` | Parses JSON on stderr |
| `hermes` | `hermes` | `acp` ACP JSON-RPC |

Upstream CLIs are separate installs with their own licenses.

## License

MIT
