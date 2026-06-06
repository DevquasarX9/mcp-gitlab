#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.cwd();
const cliPath = resolve(root, "dist/cli.js");
const commandOverride = process.env.MCP_SMOKE_COMMAND;

function parseSmokeArgs() {
  if (!process.env.MCP_SMOKE_ARGS_JSON) {
    return [];
  }

  const parsed = JSON.parse(process.env.MCP_SMOKE_ARGS_JSON);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("MCP_SMOKE_ARGS_JSON must be a JSON string array.");
  }

  return parsed;
}

function inheritedEnv(overrides = {}) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry) => typeof entry[1] === "string")
    ),
    GITLAB_TOKEN: process.env.GITLAB_TOKEN ?? "smoke-test-token",
    LOG_LEVEL: "error",
    MCP_TRANSPORT: "stdio",
    GITLAB_MCP_TOOL_PROFILE: "readonly",
    GITLAB_MCP_ENABLED_TOOLS: "",
    GITLAB_MCP_DISABLED_TOOLS: "",
    GITLAB_MCP_EXPOSE_DISABLED_WRITES: "false",
    ENABLE_WRITE_TOOLS: "false",
    ENABLE_DESTRUCTIVE_TOOLS: "false",
    ...overrides
  };
}

async function assertBuiltCliExists() {
  try {
    await access(cliPath);
  } catch {
    throw new Error("dist/cli.js is missing. Run npm run build before the stdio smoke test.");
  }
}

async function main() {
  if (!commandOverride) {
    await assertBuiltCliExists();
  }

  const client = new Client({
    name: "gitlab-mcp-stdio-smoke",
    version: "1.0.0"
  });
  const transport = new StdioClientTransport({
    command: commandOverride ?? process.execPath,
    args: commandOverride ? parseSmokeArgs() : [cliPath],
    cwd: root,
    env: inheritedEnv(),
    stderr: "pipe"
  });

  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk).toString("utf8"));
  });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    const toolNames = new Set(result.tools.map((tool) => tool.name));

    if (!toolNames.has("gitlab_validate_token")) {
      throw new Error("MCP stdio smoke did not advertise gitlab_validate_token.");
    }

    console.log(`stdio smoke ok: ${result.tools.length} tools advertised`);
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    if (stderr.length > 0) {
      console.error(stderr);
    }

    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
