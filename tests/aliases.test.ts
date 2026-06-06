import { describe, expect, it } from "vitest";

import { loadConfig, type AppConfig } from "../src/config.js";
import { resolveConfiguredAlias, resolveToolArgumentAliases } from "../src/tools/shared.js";

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
  logLevel: "info",
  exposeSecretVariableValues: false
};

describe("alias config parsing", () => {
  it("defaults to the readonly tool profile and hidden disabled writes", () => {
    const config = loadConfig({
      GITLAB_TOKEN: "test-token"
    });

    expect(config.toolProfile).toBe("readonly");
    expect(config.enabledTools).toEqual([]);
    expect(config.disabledTools).toEqual([]);
    expect(config.exposeDisabledWriteTools).toBe(false);
    expect(config.mcpTransport).toBe("stdio");
    expect(config.mcpHttpHost).toBe("127.0.0.1");
    expect(config.mcpHttpPort).toBe(3333);
    expect(config.mcpHttpPath).toBe("/mcp");
    expect(config.mcpHttpAllowedOrigins).toEqual([]);
    expect(config.mcpHttpAllowedHosts).toEqual(["localhost", "127.0.0.1", "[::1]"]);
    expect(config.mcpHttpAllowNonLocalhost).toBe(false);
  });

  it("parses tool profile filters from env", () => {
    const config = loadConfig({
      GITLAB_TOKEN: "test-token",
      GITLAB_MCP_TOOL_PROFILE: "mr-review",
      GITLAB_MCP_ENABLED_TOOLS: "gitlab_get_merge_request,gitlab_get_merge_request_diff",
      GITLAB_MCP_DISABLED_TOOLS: "gitlab_merge_merge_request",
      GITLAB_MCP_EXPOSE_DISABLED_WRITES: "true"
    });

    expect(config.toolProfile).toBe("mr-review");
    expect(config.enabledTools).toEqual([
      "gitlab_get_merge_request",
      "gitlab_get_merge_request_diff"
    ]);
    expect(config.disabledTools).toEqual(["gitlab_merge_merge_request"]);
    expect(config.exposeDisabledWriteTools).toBe(true);
  });

  it("parses project and group aliases from env", () => {
    const config = loadConfig({
      GITLAB_TOKEN: "test-token",
      PROJECT_ALIASES: "platform=group/platform-api,storefront=commerce/storefront",
      GROUP_ALIASES: "core=engineering/core,commerce=commerce"
    });

    expect(config.projectAliases).toEqual({
      platform: "group/platform-api",
      storefront: "commerce/storefront"
    });
    expect(config.groupAliases).toEqual({
      core: "engineering/core",
      commerce: "commerce"
    });
  });

  it("rejects invalid alias entries", () => {
    expect(() =>
      loadConfig({
        GITLAB_TOKEN: "test-token",
        PROJECT_ALIASES: "broken-entry"
      })
    ).toThrow(/PROJECT_ALIASES entries must use alias=value format/);
  });

  it("parses HTTP transport settings from env", () => {
    const config = loadConfig({
      GITLAB_TOKEN: "test-token",
      MCP_TRANSPORT: "http",
      MCP_HTTP_HOST: "localhost",
      MCP_HTTP_PORT: "4444",
      MCP_HTTP_PATH: "/gitlab-mcp/",
      MCP_HTTP_ALLOWED_ORIGINS: "https://mcp.example.test, http://localhost:3000",
      MCP_HTTP_ALLOWED_HOSTS: "mcp.example.test,localhost",
      MCP_HTTP_AUTH_TOKEN: " secret-token ",
      MCP_HTTP_ALLOW_NON_LOCALHOST: "true"
    });

    expect(config.mcpTransport).toBe("http");
    expect(config.mcpHttpHost).toBe("localhost");
    expect(config.mcpHttpPort).toBe(4444);
    expect(config.mcpHttpPath).toBe("/gitlab-mcp");
    expect(config.mcpHttpAllowedOrigins).toEqual([
      "https://mcp.example.test",
      "http://localhost:3000"
    ]);
    expect(config.mcpHttpAllowedHosts).toEqual(["mcp.example.test", "localhost"]);
    expect(config.mcpHttpAuthToken).toBe("secret-token");
    expect(config.mcpHttpAllowNonLocalhost).toBe(true);
  });

  it("rejects invalid HTTP transport settings", () => {
    expect(() =>
      loadConfig({
        GITLAB_TOKEN: "test-token",
        MCP_HTTP_PORT: "70000"
      })
    ).toThrow(/MCP_HTTP_PORT must be between 1 and 65535/);

    expect(() =>
      loadConfig({
        GITLAB_TOKEN: "test-token",
        MCP_HTTP_PATH: "mcp"
      })
    ).toThrow(/MCP_HTTP_PATH must start with \//);
  });
});

describe("alias resolution", () => {
  it("resolves direct and chained aliases", () => {
    expect(
      resolveConfiguredAlias(
        "api",
        {
          api: "platform",
          platform: "group/platform-api"
        },
        "project"
      )
    ).toBe("group/platform-api");
  });

  it("detects alias cycles", () => {
    expect(() =>
      resolveConfiguredAlias(
        "api",
        {
          api: "platform",
          platform: "api"
        },
        "project"
      )
    ).toThrow(/alias cycle/i);
  });

  it("normalizes project_id and group_id tool arguments through configured aliases", () => {
    const normalized = resolveToolArgumentAliases(
      {
        project_id: "api",
        group_id: "core",
        merge_request_iid: 42
      },
      {
        ...baseConfig,
        projectAliases: {
          api: "group/platform-api"
        },
        groupAliases: {
          core: "engineering/core"
        }
      }
    );

    expect(normalized).toEqual({
      project_id: "group/platform-api",
      group_id: "engineering/core",
      merge_request_iid: 42
    });
  });
});
