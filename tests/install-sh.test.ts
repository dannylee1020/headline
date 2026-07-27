import { access, chmod, cp, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const shellScript = join(process.cwd(), "install.sh");

async function fakePath(hosts: Record<string, string> = {}, options: { archive?: string; npmFailure?: boolean; fakeNode?: boolean } = {}): Promise<{ path: string; marker: string }> {
  const root = await mkdtemp(join(tmpdir(), "headline-path-"));
  const marker = join(root, "curl-called");
  const bin = join(root, "bin");
  await mkdir(bin);
  await symlink("/usr/bin/tar", join(bin, "tar"));
  if (options.fakeNode) {
    await writeFile(join(bin, "node"), `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'v24.0.1\\n'; exit 0; fi
if [ "$1" = "-e" ]; then
  awk -v a="$3" -v b="$4" 'BEGIN {
    sub(/^[^0-9]*/, "", a); sub(/^[^0-9]*/, "", b)
    split(a, av, "."); split(b, bv, ".")
    for (i = 1; i <= 3; i++) {
      if ((av[i] + 0) > (bv[i] + 0)) exit 0
      if ((av[i] + 0) < (bv[i] + 0)) exit 1
    }
    exit 0
  }'
  exit $?
fi
exit 0
`);
    await writeFile(join(bin, "npm"), `#!/bin/sh\n${options.npmFailure ? "printf 'npm build failure detail\\n' >&2\nexit 1" : "printf 'npm internal noise\\n'\nexit 0"}\n`);
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
        HEADLINE_HOME: join(tmpdir(), "headline-no-host-home"),
      },
    }).catch((error: any) => error);
    expect(result.code).toBe(2);
    expect(String(result.stdout)).toContain("! No supported agent found");
    expect(String(result.stdout)).toContain("Install Claude Code, OpenCode 1.18.4+, or Pi 0.81.1+, then retry.");
    await expect(import("node:fs/promises").then(({ access }) => access(fake.marker))).rejects.toBeTruthy();
  });

  it("installs every compatible detected host", async () => {
    const archive = await sourceArchive();
    const home = await mkdtemp(join(tmpdir(), "headline-all-hosts-home-"));
    const fake = await fakePath({ claude: "2.1.137", opencode: "1.18.4", pi: "0.81.1" }, { archive, fakeNode: true });
    const result = await execFileAsync("sh", [shellScript], {
      env: {
        ...process.env,
        PATH: fake.path,
        HEADLINE_HOME: home,
      },
    });
    expect(result.stdout).toContain("Headline\n\nAgents");
    expect(result.stdout).toContain("✓ Claude Code 2.1.137");
    expect(result.stdout).toContain("✓ OpenCode 1.18.4");
    expect(result.stdout).toContain("✓ Pi 0.81.1");
    expect(result.stdout).toContain("✓ Source downloaded");
    expect(result.stdout).toContain("✓ Application built");
    expect(result.stdout).toContain("✓ Application installed");
    expect(result.stdout).toContain("✓ Claude Code connected");
    expect(result.stdout).toContain("✓ OpenCode connected");
    expect(result.stdout).toContain("✓ Pi connected");
    expect(result.stdout).toContain(`Installed\n  ${home}`);
    expect(result.stdout).not.toContain("npm internal noise");
  });

  it("marks old OpenCode unsupported without blocking Pi", async () => {
    const archive = await sourceArchive();
    const home = await mkdtemp(join(tmpdir(), "headline-old-opencode-home-"));
    const fake = await fakePath({ opencode: "1.0.0", pi: "0.81.1" }, { archive, fakeNode: true });
    const result = await execFileAsync("sh", [shellScript], {
      env: {
        ...process.env,
        PATH: fake.path,
        HEADLINE_HOME: home,
      },
    });
    expect(result.stdout).toContain("! OpenCode 1.0.0 requires 1.18.4 or newer");
    expect(result.stdout).toContain("✓ Pi 0.81.1");
    expect(result.stdout).toContain("✓ Pi connected");
    expect(result.stdout).toContain("Skipped: OpenCode 1.0.0 (<1.18.4)");
  });
});

async function sourceArchive(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "headline-archive-"));
  const source = join(root, "headline-source");
  const archive = join(root, "headline-source.tar.gz");
  await mkdir(source);
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "vitest.config.ts", "install.sh", "README.md"]) {
    await cp(join(process.cwd(), file), join(source, file));
  }
  for (const directory of ["src", "tests", "dist"]) {
    await cp(join(process.cwd(), directory), join(source, directory), { recursive: true });
  }
  await execFileAsync("tar", ["-czf", archive, "-C", root, "headline-source"]);
  return archive;
}

describe("install.sh staging", () => {
  it("leaves the current install unchanged when the source build fails", async () => {
    const archive = await sourceArchive();
    const home = await mkdtemp(join(tmpdir(), "headline-current-"));
    const installDir = join(home, "app");
    await mkdir(installDir);
    const sentinel = join(installDir, "sentinel");
    await writeFile(sentinel, "keep");
    const fake = await fakePath({ pi: "0.81.1" }, { archive, npmFailure: true, fakeNode: true });
    const result = await execFileAsync("sh", [shellScript], {
      env: {
        ...process.env,
        PATH: fake.path,
        HEADLINE_HOME: home,
      },
    }).catch((error: any) => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("npm build failure detail");
    expect(result.stderr).toContain("source build failed; existing install was not changed");
    expect(await import("node:fs/promises").then(({ readFile }) => readFile(sentinel, "utf8"))).toBe("keep");
  });

  it("replaces the application while preserving user data", async () => {
    const archive = await sourceArchive();
    const parent = await mkdtemp(join(tmpdir(), "headline-promote-"));
    const home = join(parent, "home");
    const installDir = join(home, "app");
    const oldApplicationFile = join(installDir, "old-version");
    await mkdir(installDir, { recursive: true });
    await mkdir(join(home, "cache"), { recursive: true });
    await writeFile(oldApplicationFile, "replace me\n");
    await writeFile(join(home, "config.json"), "{\"visibility\":\"always\"}\n");
    await writeFile(join(home, "cache", "snapshot.json"), "cached\n");
    const fake = await fakePath({ pi: "0.81.1" }, { archive, fakeNode: true });
    const result = await execFileAsync("sh", [shellScript], {
      env: {
        ...process.env,
        PATH: fake.path,
        HEADLINE_HOME: home,
      },
    });
    expect(result.stdout).toContain("✓ Application installed");
    expect(result.stdout).toContain(`Installed\n  ${home}`);
    await access(join(installDir, "dist", "cli", "index.js"));
    await expect(access(oldApplicationFile)).rejects.toBeTruthy();
    expect((await readdir(home)).filter((name) => name.startsWith("app.backup."))).toEqual([]);
    const launcher = join(home, "bin", "headline");
    const launcherContents = await readFile(launcher, "utf8");
    expect(launcherContents).toContain(join(installDir, "dist", "cli", "index.js"));
    expect(launcherContents).toContain('"$@"');
    expect(launcherContents).not.toContain('"\\$@"');
    expect(await readFile(join(home, "config.json"), "utf8")).toContain("always");
    expect(await readFile(join(home, "cache", "snapshot.json"), "utf8")).toBe("cached\n");
  });
});
