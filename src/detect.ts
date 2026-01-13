import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DetectedCLI, ProviderId } from "./types.js";
import { detectCLIVersion } from "./version.js";
import { SUPPORTED_PROVIDERS } from "./registry.js";

const execFileAsync = promisify(execFile);

/** Default executable name on PATH for each provider (Multica parity). */
export const DEFAULT_EXECUTABLES: Record<ProviderId, string> = {
  claude: "claude",
  cursor: "agent",
  codex: "codex",
  opencode: "opencode",
  openclaw: "openclaw",
  hermes: "hermes",
};

async function resolveOnPath(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", [cmd], { timeout: 5000 });
    const p = String(stdout).trim().split("\n")[0];
    return p || null;
  } catch {
    return null;
  }
}

async function tryDetect(
  id: ProviderId,
  executablePath?: string,
): Promise<DetectedCLI | null> {
  const cmd = executablePath?.trim() || DEFAULT_EXECUTABLES[id];
  const path = await resolveOnPath(cmd);
  if (!path) return null;
  try {
    const version = await detectCLIVersion(path);
    return { providerId: id, path, version };
  } catch {
    return { providerId: id, path, version: "" };
  }
}

/** Discover all supported CLIs that resolve on PATH. */
export async function detectAll(): Promise<DetectedCLI[]> {
  const out: DetectedCLI[] = [];
  for (const id of SUPPORTED_PROVIDERS) {
    const d = await tryDetect(id);
    if (d) out.push(d);
  }
  return out;
}

export async function detectOne(
  id: ProviderId,
  executablePath?: string,
): Promise<DetectedCLI | null> {
  return tryDetect(id, executablePath);
}
