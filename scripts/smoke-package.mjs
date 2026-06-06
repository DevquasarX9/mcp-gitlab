#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const packageInfo = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const packageName = packageInfo.name;
const packageVersion = packageInfo.version;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: {
      ...process.env,
      ...options.env
    },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit"
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .filter((item) => typeof item === "string" && item.length > 0)
      .join("\n")
      .trim();
    throw new Error(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  }

  return result.stdout;
}

function resolveBinPath(prefixDir) {
  return process.platform === "win32"
    ? join(prefixDir, "gitlab-mcp-server.cmd")
    : join(prefixDir, "bin", "gitlab-mcp-server");
}

const workDir = await mkdtemp(join(tmpdir(), "gitlab-mcp-package-smoke-"));

try {
  const packOutput = run("npm", ["pack", "--json", "--pack-destination", workDir], {
    capture: true
  });
  const packed = JSON.parse(packOutput);
  const filename = packed[0]?.filename;

  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("npm pack did not return a tarball filename.");
  }

  const tarballPath = join(workDir, filename);
  const prefixDir = join(workDir, "prefix");
  const expectedTarballName = `${packageName}-${packageVersion}.tgz`;

  if (filename !== expectedTarballName) {
    throw new Error(`Expected package tarball ${expectedTarballName}, got ${filename}.`);
  }

  run("npm", ["install", "--global", "--prefix", prefixDir, tarballPath]);

  const installedCommand = resolveBinPath(prefixDir);
  run("npm", ["run", "smoke:stdio"], {
    env: {
      MCP_SMOKE_COMMAND: installedCommand
    }
  });
  run("npm", ["run", "smoke:http"], {
    env: {
      MCP_SMOKE_COMMAND: installedCommand
    }
  });

  console.log(`package smoke ok: ${filename}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
