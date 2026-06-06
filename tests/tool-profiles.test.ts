import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { AppConfig } from "../src/config.js";
import { createServer } from "../src/index.js";

const baseConfig: AppConfig = {
  gitlabBaseUrl: "https://gitlab.com/api/v4",
  gitlabToken: "test-token",
  tokenHeaderMode: "bearer",
  toolProfile: "readonly",
  enabledTools: [],
  disabledTools: [],
  exposeDisabledWriteTools: false,
  mcpTransport: "stdio",
  mcpHttpHost: "127.0.0.1",
  mcpHttpPort: 3333,
  mcpHttpPath: "/mcp",
  mcpHttpAllowedOrigins: [],
  mcpHttpAllowedHosts: ["localhost", "127.0.0.1", "[::1]"],
  mcpHttpAllowNonLocalhost: false,
  enableWriteTools: false,
  enableDestructiveTools: false,
  enableDryRun: false,
  projectAliases: {},
  groupAliases: {},
  projectAllowlist: [],
  groupAllowlist: [],
  projectDenylist: [],
  maxFileSizeBytes: 1_048_576,
  maxDiffSizeBytes: 2_097_152,
  maxApiResponseBytes: 4_194_304,
  httpTimeoutMs: 30_000,
  gitlabUserAgent: "gitlab-mcp-server",
  logLevel: "error",
  exposeSecretVariableValues: false
};

async function listToolNames(config: AppConfig): Promise<readonly string[]> {
  const { server } = createServer(config);
  const client = new Client({
    name: "tool-profile-test-client",
    version: "1.0.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name).sort();
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe("tool profiles", () => {
  it("defaults to readonly and hides write-capable tools", async () => {
    const names = await listToolNames(baseConfig);

    expect(names).toContain("gitlab_get_issue");
    expect(names).toContain("gitlab_get_merge_request");
    expect(names).toContain("gitlab_get_merge_request_commits");
    expect(names).toContain("gitlab_get_merge_request_pipelines");
    expect(names).toContain("gitlab_get_pipeline");
    expect(names).not.toContain("gitlab_create_issue");
    expect(names).not.toContain("gitlab_merge_merge_request");
  });

  it("hides disabled writes even in the full profile by default", async () => {
    const names = await listToolNames({
      ...baseConfig,
      toolProfile: "full"
    });

    expect(names).toContain("gitlab_get_issue");
    expect(names).not.toContain("gitlab_create_issue");
    expect(names).not.toContain("gitlab_cancel_pipeline");
  });

  it("can expose disabled writes for compatibility without enabling execution", async () => {
    const names = await listToolNames({
      ...baseConfig,
      toolProfile: "full",
      exposeDisabledWriteTools: true
    });

    expect(names).toContain("gitlab_create_issue");
    expect(names).toContain("gitlab_merge_merge_request");
  });

  it("keeps destructive tools hidden until destructive mode is enabled", async () => {
    const writeOnlyNames = await listToolNames({
      ...baseConfig,
      toolProfile: "full",
      enableWriteTools: true
    });

    expect(writeOnlyNames).toContain("gitlab_create_issue");
    expect(writeOnlyNames).not.toContain("gitlab_merge_merge_request");

    const destructiveNames = await listToolNames({
      ...baseConfig,
      toolProfile: "full",
      enableWriteTools: true,
      enableDestructiveTools: true
    });

    expect(destructiveNames).toContain("gitlab_merge_merge_request");
  });

  it("honors explicit tool allow and deny lists after profile selection", async () => {
    const allowListNames = await listToolNames({
      ...baseConfig,
      toolProfile: "full",
      enabledTools: ["gitlab_get_issue", "gitlab_get_project"]
    });

    expect(allowListNames).toEqual(["gitlab_get_issue", "gitlab_get_project"]);

    const denyListNames = await listToolNames({
      ...baseConfig,
      disabledTools: ["gitlab_get_issue"]
    });

    expect(denyListNames).not.toContain("gitlab_get_issue");
    expect(denyListNames).toContain("gitlab_get_merge_request");
  });
});
