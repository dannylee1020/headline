import { spawn } from "node:child_process";

export interface PiInstallOptions {
  readonly installPath: string;
  readonly project?: boolean;
  readonly command?: string;
}

export class PiInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiInstallError";
  }
}

export function piInstallArgs(options: PiInstallOptions): readonly string[] {
  return options.project ? ["install", "-l", options.installPath] : ["install", options.installPath];
}

export function installPi(options: PiInstallOptions): Promise<void> {
  const command = options.command ?? "pi";
  const args = piInstallArgs(options);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    } catch (error) {
      reject(new PiInstallError(error instanceof Error ? error.message : String(error)));
      return;
    }
    child.once("error", (error) => reject(new PiInstallError(error.message)));
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new PiInstallError(`pi install failed${signal ? ` with ${signal}` : ` with exit code ${code ?? "unknown"}`}`));
    });
  });
}
