import { execFile } from "node:child_process";

export function detectCLIVersion(executablePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executablePath, ["--version"], { timeout: 30_000 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}
