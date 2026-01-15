# Contributing to Agentfuse

Thanks for helping improve Agentfuse. This repository is **independent** of Multica and other products — contribute here as you would any small open-source TypeScript library.

## Principles

- **Focused changes** — one logical concern per pull request.
- **Match existing style** — strict TypeScript, `async`/`await`, no unnecessary dependencies.
- **Provider parity** — when changing how a CLI is spawned or parsed, align with the **documented** behavior of that upstream tool (and note version quirks in PR text).

## Development

```bash
git clone https://github.com/YOUR_ORG/agentfuse.git
cd agentfuse
npm install
npm run build
npm run typecheck
npm test
```

Replace `YOUR_ORG` with the real GitHub org/username after the repo is published.

## Before the first push

1. Create the empty GitHub repository (no README/license if you want a clean history from this repo).
2. Replace every `YOUR_ORG` in `package.json`, `README.md`, and `CONTRIBUTING.md` with your org or username.
3. `git remote add origin https://github.com/<you>/agentfuse.git`
4. `git push -u origin main`

## Project layout

| Path | Role |
|------|------|
| `src/types.ts` | Shared `Message`, `Result`, `ExecOptions` |
| `src/providers/*.ts` | One file per CLI integration |
| `src/registry.ts` | `createBackend()` factory |
| `src/detect.ts` | PATH / `--version` discovery |
| `src/cli/` | `agentfuse` CLI |
| `examples/` | Runnable examples (see `examples/README.md`) |

## Tests

- **Vitest** — `npm test`
- Prefer **unit tests** that don’t require real CLIs (mock `child_process` if you add integration-style tests).

## Commits

Use clear messages, e.g. `feat(cursor): …`, `fix(codex): …`, `docs: …`, `test: …`.

## Pull requests

1. Open an issue for larger design changes (optional but encouraged).
2. Describe **what** changed and **why** in the PR body.
3. Ensure `npm run typecheck` and `npm test` pass.

## Code of conduct

Be respectful and constructive. Report harassment to repository maintainers.
