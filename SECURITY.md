# Security

## Supported versions

Security fixes are applied to the **latest minor** release line. Use the newest published version from npm when possible.

## Reporting a vulnerability

**Please do not** open a public GitHub issue for undisclosed security vulnerabilities.

Instead:

1. Open a **private security advisory** on GitHub for this repository (if enabled), or  
2. Email maintainers with a clear subject line such as `[agentfuse] security report`, including:
   - Description of the issue and impact
   - Steps to reproduce (if applicable)
   - Whether you believe it affects child-process spawning, dependency supply chain, or documentation only

We aim to acknowledge reports within a few business days.

## Scope notes

Agentfuse **executes third-party CLIs** you install (`claude`, `agent`, `codex`, etc.). Treat those binaries and their configuration like any other executable on your machine: use trusted installs, review prompts, and follow your organization’s policies.
