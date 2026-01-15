# Examples

All examples assume you ran **`npm run build`** from the repo root so `dist/` exists. Examples import from **`../dist/index.js`** so they work without publishing to npm.

## Requirements

- **Node 20+** (Node 22+ recommended if you run `.ts` with `--experimental-strip-types`).
- At least one **supported CLI** on your `PATH` (e.g. `claude`, `codex`).

---

## `run-once.ts`

Minimal “one prompt, stream text, print result” script.

```bash
npm run build
node --experimental-strip-types examples/run-once.ts claude "Say hello."
```

Arguments: `providerId` (optional, default `claude`), then the prompt.

---

## `detect-providers.ts`

Lists everything `detectAll()` finds — useful to verify PATH before integrating.

```bash
npm run build
node --experimental-strip-types examples/detect-providers.ts
```

---

## `stream-events.ts`

Prints **every** normalized message as NDJSON (one JSON object per line), then the final `Result` as a JSON line prefixed with `RESULT`. Good for debugging tool calls and thinking chunks.

```bash
npm run build
node --experimental-strip-types examples/stream-events.ts claude "What is 2+2?"
```

---

## `custom-binary.ts`

Shows how to point at a **non-default** executable (e.g. a wrapper script or absolute path).

```bash
npm run build
AGENTFUSE_CLAUDE_PATH=claude node --experimental-strip-types examples/custom-binary.ts
```

Edit the file to set `executablePath` for your setup.
