import { chmod, cp, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const shellScript = join(process.cwd(), "install.sh");

async function fakePath(hosts: Record<string, string> = {}, options: { archive?: string; npmFailure?: boolean; fakeNode?: boolean } = {}): Promise<{ path: string; marker: string }> {
  const root = await mkdtemp(join(tmpdir(), "newsbar-path-"));
  const marker = join(root, "curl-called");
  const bin = join(root, "bin");
  await mkdir(bin);
  await symlink("/usr/bin/tar", join(bin, "tar"));
  if (options.fakeNode) {
    await writeFile(join(bin, "node"), "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'v24.0.1\\n'; fi\nexit 0\n");
    await writeFile(join(bin, "npm"), `#!/bin/sh\n${options.npmFailure ? "exit 1" : "exit 0"}\n`);
    await chmod(join(bin, "node"), 0o755);
    await chmod(join(bin, "npm"), 0o755);
  } else {
    await symlink(process.execPath, join(bin, "node"));
    await symlink(join(process.execPath, "..", "npm"), join(bin, "npm"));
  }
  if (options.archive) {
    await writeFile(join(bin, "curl"), `#!/bin/sh\nout=\nwhile [ \"$#\" -gt 0 ]; do\n  if [ \"$1\" = \"-o\" ]; then out=$2; shift 2; else shift; fi\ndone\ncp '${options.archive}' \"$out\"\n`);
  } else {
    await writeFile(join(bin, "curl"), `#!/bin/sh\nprintf called > '${marker}'\nexit 1\n`);
  }
  await chmod(join(bin, "curl"), 0o755);
  for (const [name, output] of Object.entries(hosts)) {
    const path = join(bin, name);
    await writeFile(path, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
    await chmod(path, 0o755);
  }
  return { path: `${bin}:/usr/bin:/bin`, marker };
}

describe("install.sh", () => {
  it("passes POSIX syntax validation", () => {
    expect(() => execFileSync("sh", ["-n", shellScript])).not.toThrow();
  });

  it("detects no hosts and does not download", async () => {
    const fake = await fakePath();
    const result = await execFileAsync("sh", [shellScript], {
      env: {
        ...process.env,
        PATH: fake.path,
        NEWSBAR_INSTALL_DIR: join(tmpdir(), "newsbar-no-host-test"),
      },
    }).catch((error: any) => error);
    expect(result.code).toBe(2);
    expect(String(result.stdout)).toContain("No supported coding agent detected");
    await expect(import("node:fs/promises").then(({ access }) => access(fake.marker))).rejects.toBeTruthy();
  });

  it("reports all detected hosts in dry-run mode", async () => {
    const fake = await fakePath({ claude: "2.1.137", opencode: "1.18.4", pi: "0.81.1" });
    const result = await execFileAsync("sh", [shellScript], {
      env: {
        ...process.env,
        PATH: fake.path,
        NEWSBAR_DRY_RUN: "1",
        NEWSBAR_INSTALL_DIR: join(tmpdir(), "newsbar-all-hosts-test"),
      },
    });
    expect(result.stdout).toContain("Detected Claude Code");
    expect(result.stdout).toContain("Detected OpenCode");
    expect(result.stdout).toContain("Detected Pi");
    expect(result.stdout).toContain("Dry run");
  });

  it("marks old OpenCode unsupported without blocking Pi", async () => {
    const fake = await fakePath({ opencode: "1.0.0", pi: "0.81.1" });
    const result = await execFileAsync("sh", [shellScript], {
      env: {
        ...process.env,
        PATH: fake.path,
        NEWSBAR_DRY_RUN: "1",
        NEWSBAR_INSTALL_DIR: join(tmpdir(), "newsbar-old-opencode-test"),
      },
    });
    expect(`${result.stdout}${result.stderr}`).toContain("unsupported");
    expect(result.stdout).toContain("Detected Pi");
  });
});

async function sourceArchive(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "newsbar-archive-"));
  const source = join(root, "newsbar-source");
  const archive = join(root, "newsbar-source.tar.gz");
  await mkdir(source);
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "vitest.config.ts", "install.sh", "README.md"]) {
    await cp(join(process.cwd(), file), join(source, file));
  }
  for (const directory of ["src", "tests", "dist"]) {
    await cp(join(process.cwd(), directory), join(source, directory), { recursive: true });
  }
  await execFileAsync("tar", ["-czf", archive, "-C", root, "newsbar-source"]);
  return archive;
}

describe("install.sh staging", () => {
  it("leaves the current install unchanged when the source build fails", async () => {
    const archive = await sourceArchive();
    const installDir = await mkdtemp(join(tmpdir(), "newsbar-current-"));
    const sentinel = join(installDir, "sentinel");
    await writeFile(sentinel, "keep");
    const fake = await fakePath({ pi: "0.81.1" }, { archive, npmFailure: true, fakeNode: true });
    const result = await execFileAsync("sh", [shellScript], {
      env: {
        ...process.env,
        PATH: fake.path,
        NEWSBAR_ARCHIVE_URL: "https://example.test/newsbar.tar.gz",
        NEWSBAR_INSTALL_HOSTS: "pi",
        NEWSBAR_INSTALL_DIR: installDir,
      },
    }).catch((error: any) => error);
    expect(result.code).toBe(1);
    expect(await import("node:fs/promises").then(({ readFile }) => readFile(sentinel, "utf8"))).toBe("keep");
  });

  it("promotes a built tree and invokes detected Pi", async () => {
    const archive = await sourceArchive();
    const parent = await mkdtemp(join(tmpdir(), "newsbar-promote-"));
    const installDir = join(parent, "newsbar");
    const fake = await fakePath({ pi: "0.81.1" }, { archive, fakeNode: true });
    const result = await execFileAsync("sh", [shellScript], {
      env: {
        ...process.env,
        PATH: fake.path,
        NEWSBAR_ARCHIVE_URL: "https://example.test/newsbar.tar.gz",
        NEWSBAR_INSTALL_HOSTS: "pi",
        NEWSBAR_INSTALL_DIR: installDir,
      },
    });
    expect(result.stdout).toContain("Installed Newsbar source tree");
    expect(result.stdout).toContain("All detected Newsbar integrations installed successfully");
    await import("node:fs/promises").then(({ access }) => access(join(installDir, "dist", "cli", "index.js")));
  });
});
