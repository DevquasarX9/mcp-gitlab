import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { formatDoctorReport, resolveCliMode } from "../src/doctor.js";

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

describe("resolveCliMode", () => {
  it("defaults to server mode", () => {
    expect(resolveCliMode([], {})).toBe("server");
    expect(resolveCliMode(["serve"], {})).toBe("server");
  });

  it("recognizes doctor mode", () => {
    expect(resolveCliMode(["doctor"], {})).toBe("doctor");
    expect(resolveCliMode(["--doctor"], { MCP_TRANSPORT: "http" })).toBe("doctor");
  });

  it("recognizes HTTP mode from CLI or env with CLI taking precedence", () => {
    expect(resolveCliMode(["serve-http"], {})).toBe("http");
    expect(resolveCliMode(["--http"], {})).toBe("http");
    expect(resolveCliMode([], { MCP_TRANSPORT: "http" })).toBe("http");
    expect(resolveCliMode(["doctor"], { MCP_TRANSPORT: "http" })).toBe("doctor");
  });
});

describe("formatDoctorReport", () => {
  it("renders a readable diagnostics report", () => {
    const report = formatDoctorReport({
      config: {
        ...baseConfig,
        enableWriteTools: true
      },
      user: {
        username: "alice",
        name: "Alice"
      },
      version: {
        version: "18.2.1",
        revision: "abc123"
      },
      personalAccessToken: {
        scopes: ["read_api", "api"]
      },
      advisory: {
        server_mode: "write-enabled",
        token_kind: "personal_access_token",
        token_expiry_days: 120,
        scope_summary: {
          token_scopes_known: true,
          token_scopes: ["read_api", "api"]
        },
        access_controls: {
          project_aliases_enabled: false,
          group_aliases_enabled: false,
          project_alias_count: 0,
          group_alias_count: 0,
          project_allowlist_enabled: false,
          group_allowlist_enabled: false,
          project_denylist_enabled: false,
          project_allowlist_count: 0,
          group_allowlist_count: 0,
          project_denylist_count: 0
        },
        likely_blocked_capabilities: [
          "Destructive tools are blocked because ENABLE_DESTRUCTIVE_TOOLS is disabled."
        ],
        warnings: [
          "No project or group allowlists are configured, so accessible scope is controlled only by the GitLab token permissions."
        ],
        recommended_next_checks: [
          "Run gitlab_list_accessible_projects with membership=true to confirm which projects are visible to this token."
        ]
      }
    });

    expect(report).toContain("GitLab MCP Doctor");
    expect(report).toContain("Authenticated user: alice (Alice)");
    expect(report).toContain("Server mode: write-enabled");
    expect(report).toContain("MCP transport: stdio");
    expect(report).toContain("HTTP host: 127.0.0.1");
    expect(report).toContain("HTTP localhost bind: yes");
    expect(report).toContain("Max API response bytes: 4194304");
    expect(report).toContain("Token scopes: read_api, api");
    expect(report).toContain("Warnings");
    expect(report).toContain("Recommended Next Checks");
  });
});
