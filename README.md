# Agentfuse

**One TypeScript library to drive coding-agent CLIs** — spawn, stream, and normalize output from [Claude Code](https://github.com/anthropics/claude-code), Cursor (`agent`), Codex, OpenCode, OpenClaw, Hermes (ACP), and more.

Agentfuse is **its own open-source project**. The API is *inspired by* the same “unified backend” idea used in many codebases, but this package is standalone and published separately.

---

## Why Agentfuse

- **Embed in any Node or TypeScript app** — task runners, IDEs, CI, internal tools.
- **One shape for messages and results** — `Message` stream + final `Result` (status, output, usage).
- **Discover what’s installed** — `detectAll()` uses your `PATH` and `--version`.
- **CLI for smoke tests** — `agentfuse detect` and `agentfuse run` without writing code.

Upstream CLIs are **separate installs** with their own terms and licenses. Agentfuse only orchestrates processes you already have.

---

## Install

```bash
npm install agentfuse
```

**From a git clone** (contributors):

```bash
git clone https://github.com/jayavibhavnk/AgentFuse---ACP.git
cd AgentFuse---ACP
npm install
npm run build
npm test
```

---

## Quick start (library)

```typescript
import { createBackend, detectAll } from "agentfuse";

const available = await detectAll();
console.log("On PATH:", available.map((d) => d.providerId).join(", "));

const backend = createBackend("claude", {});
const { messages, result } = backend.execute("Summarize the src folder in one sentence.", {
  cwd: "/path/to/your/repo",
});

for await (const m of messages) {
  if (m.type === "text") console.log(m.content);
}

const final = await result;
console.log(final.status, final.output.slice(0, 200));
```

---

## CLI

```bash
# What’s installed?
npx agentfuse detect
npx agentfuse detect --json

# One-shot prompt (text streams to stdout)
npx agentfuse run --provider claude "Say hello in exactly three words."
npx agentfuse run --provider cursor --cwd . "List files in the current directory."
```

---

## Providers

| ID | Default binary | Transport |
|----|----------------|-------------|
| `claude` | `claude` | Stream JSON |
| `cursor` | `agent` | Stream JSON |
| `codex` | `codex` | JSON-RPC (`app-server`) |
| `opencode` | `opencode` | JSON lines |
| `openclaw` | `openclaw` | JSON on stderr |
| `hermes` | `hermes` | ACP JSON-RPC |

Override the binary with `BackendConfig.executablePath` when needed.

---

## Examples

See **[examples/README.md](examples/README.md)** for runnable scripts (`detect`, streaming, custom binary path).

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## Security

See **[SECURITY.md](SECURITY.md)** for reporting vulnerabilities.

---

## License

MIT — see [LICENSE](LICENSE).
