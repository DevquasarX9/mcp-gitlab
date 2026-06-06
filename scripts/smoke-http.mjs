#!/usr/bin/env node
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = process.cwd();
const cliPath = resolve(root, "dist/cli.js");
const host = "127.0.0.1";
const commandOverride = process.env.MCP_SMOKE_COMMAND;

function parseSmokeArgs(defaultArgs) {
  if (!process.env.MCP_SMOKE_ARGS_JSON) {
    return defaultArgs;
  }

  const parsed = JSON.parse(process.env.MCP_SMOKE_ARGS_JSON);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("MCP_SMOKE_ARGS_JSON must be a JSON string array.");
  }

  return parsed;
}

function inheritedEnv(port) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry) => typeof entry[1] === "string")
    ),
    GITLAB_TOKEN: process.env.GITLAB_TOKEN ?? "smoke-test-token",
    LOG_LEVEL: "error",
    GITLAB_MCP_TOOL_PROFILE: "readonly",
    GITLAB_MCP_ENABLED_TOOLS: "",
    GITLAB_MCP_DISABLED_TOOLS: "",
    GITLAB_MCP_EXPOSE_DISABLED_WRITES: "false",
    ENABLE_WRITE_TOOLS: "false",
    ENABLE_DESTRUCTIVE_TOOLS: "false",
    MCP_HTTP_HOST: host,
    MCP_HTTP_PORT: String(port),
    MCP_HTTP_PATH: "/mcp",
    MCP_HTTP_ALLOWED_ORIGINS: "",
    MCP_HTTP_ALLOWED_HOSTS: "localhost,127.0.0.1,[::1]",
    MCP_HTTP_AUTH_TOKEN: "",
    MCP_HTTP_ALLOW_NON_LOCALHOST: "false"
  };
}

async function assertBuiltCliExists() {
  try {
    await access(cliPath);
  } catch {
    throw new Error("dist/cli.js is missing. Run npm run build before the HTTP smoke test.");
  }
}

async function getFreePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate an HTTP smoke test port.")));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolvePort(port);
      });
    });
  });
}

async function waitForHttpServer(child, stderrChunks) {
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for MCP HTTP smoke server to start."));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stderr.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const onData = (chunk) => {
      const text = Buffer.from(chunk).toString("utf8");
      stderrChunks.push(text);

      if (text.includes("GitLab MCP HTTP server listening")) {
        cleanup();
        resolveReady();
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`MCP HTTP smoke server exited before startup with code ${code ?? "unknown"}.`));
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  await new Promise((resolveExit) => {
    if (child.exitCode !== null) {
      resolveExit();
      return;
    }

    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

async function main() {
  if (!commandOverride) {
    await assertBuiltCliExists();
  }

  const port = await getFreePort();
  const env = inheritedEnv(port);
  const child = spawn(
    commandOverride ?? process.execPath,
    commandOverride ? parseSmokeArgs(["serve-http"]) : [cliPath, "serve-http"],
    {
      cwd: root,
      env,
      stdio: ["ignore", "ignore", "pipe"]
    }
  );
  const stderrChunks = [];

  try {
    await waitForHttpServer(child, stderrChunks);

    const client = new Client({
      name: "gitlab-mcp-http-smoke",
      version: "1.0.0"
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}${env.MCP_HTTP_PATH}`)
    );

    try {
      await client.connect(transport);
      const result = await client.listTools();
      const toolNames = new Set(result.tools.map((tool) => tool.name));

      if (!toolNames.has("gitlab_validate_token")) {
        throw new Error("MCP HTTP smoke did not advertise gitlab_validate_token.");
      }

      console.log(`http smoke ok: ${result.tools.length} tools advertised at http://${host}:${port}${env.MCP_HTTP_PATH}`);
    } finally {
      await client.close();
    }
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    if (stderr.length > 0) {
      console.error(stderr);
    }

    throw error;
  } finally {
    await stopServer(child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
