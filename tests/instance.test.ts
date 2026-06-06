import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { buildTokenValidationAdvisory } from "../src/tools/instance.js";

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

describe("buildTokenValidationAdvisory", () => {
  it("summarizes read-only mode and broad token scope clearly", () => {
    const advisory = buildTokenValidationAdvisory(baseConfig, {
      scopes: ["read_api", "api"],
      expires_at: "2099-01-01"
    });

    expect(advisory).toMatchObject({
      server_mode: "read-only",
      token_kind: "personal_access_token",
      dry_run_recommended: false,
      scope_summary: {
        token_scopes_known: true,
        token_scopes: ["read_api", "api"],
        has_read_api_scope: true,
        has_write_api_scope: true
      },
      access_controls: {
        project_aliases_enabled: false,
        group_aliases_enabled: false,
        project_allowlist_enabled: false,
        group_allowlist_enabled: false,
        project_denylist_enabled: false
      }
    });

    expect(advisory.likely_blocked_capabilities).toContain(
      "All write-capable tools are blocked because ENABLE_WRITE_TOOLS is disabled."
    );
    expect(advisory.warnings).toContain(
      "No project or group allowlists are configured, so accessible scope is controlled only by the GitLab token permissions."
    );
    expect(advisory.recommended_next_checks).toContain(
      "Run gitlab_list_accessible_projects with membership=true to confirm which projects are visible to this token."
    );
  });

  it("warns when write mode is enabled without api scope and surfaces allowlist restrictions", () => {
    const advisory = buildTokenValidationAdvisory(
      {
        ...baseConfig,
        enableWriteTools: true,
        projectAliases: {
          platform: "group/project"
        },
        groupAliases: {
          core: "group"
        },
        projectAllowlist: ["group/project"],
        groupAllowlist: ["group"],
        projectDenylist: ["group/legacy"]
      },
      {
        scopes: ["read_api"],
        expires_at: "2099-01-01"
      }
    );

    expect(advisory).toMatchObject({
      server_mode: "write-enabled",
      dry_run_recommended: true,
      scope_summary: {
        has_read_api_scope: true,
        has_write_api_scope: false
      },
      access_controls: {
        project_aliases_enabled: true,
        group_aliases_enabled: true,
        project_allowlist_enabled: true,
        group_allowlist_enabled: true,
        project_denylist_enabled: true,
        project_alias_count: 1,
        group_alias_count: 1,
        project_allowlist_count: 1,
        group_allowlist_count: 1,
        project_denylist_count: 1
      }
    });

    expect(advisory.likely_blocked_capabilities).toContain(
      "Write-capable tools will likely fail because the token scopes do not include api."
    );
    expect(advisory.likely_blocked_capabilities).toContain(
      "Projects outside PROJECT_ALLOWLIST are blocked."
    );
    expect(advisory.likely_blocked_capabilities).toContain(
      "Groups and projects outside GROUP_ALLOWLIST are blocked."
    );
    expect(advisory.warnings).toContain(
      "ENABLE_WRITE_TOOLS is enabled, but the detected personal access token scopes do not include api."
    );
    expect(advisory.recommended_next_checks).toContain(
      "Use a token with api scope before attempting write-capable tools."
    );
    expect(advisory.recommended_next_checks).toContain(
      "Consider enabling ENABLE_DRY_RUN=true before the first write-enabled session so intended mutations can be reviewed safely."
    );
  });

  it("warns when write and destructive modes are enabled without allowlists", () => {
    const advisory = buildTokenValidationAdvisory(
      {
        ...baseConfig,
        enableWriteTools: true,
        enableDestructiveTools: true
      },
      {
        scopes: ["api"],
        expires_at: "2099-01-01"
      }
    );

    expect(advisory).toMatchObject({
      server_mode: "destructive-enabled",
      security_posture: {
        write_mode_without_allowlist: true,
        destructive_mode_enabled: true
      }
    });
    expect(advisory.warnings).toContain(
      "ENABLE_WRITE_TOOLS is enabled without PROJECT_ALLOWLIST or GROUP_ALLOWLIST, so any project visible to the token may be writable."
    );
    expect(advisory.warnings).toContain(
      "ENABLE_DESTRUCTIVE_TOOLS is enabled; destructive tools still require confirm_destructive=true but should be used only with narrow allowlists."
    );
    expect(advisory.warnings).toContain(
      "Destructive tools are enabled without PROJECT_ALLOWLIST or GROUP_ALLOWLIST."
    );
    expect(advisory.recommended_next_checks).toContain(
      "Configure PROJECT_ALLOWLIST or GROUP_ALLOWLIST before write-enabled sessions so agent writes stay inside reviewed targets."
    );
    expect(advisory.recommended_next_checks).toContain(
      "Keep destructive mode temporary, scoped by allowlists, and paired with per-call confirm_destructive=true review."
    );
  });

  it("surfaces non-local HTTP bind risk and startup blockers", () => {
    const advisory = buildTokenValidationAdvisory(
      {
        ...baseConfig,
        mcpTransport: "http",
        mcpHttpHost: "0.0.0.0"
      },
      {
        scopes: ["read_api"],
        expires_at: "2099-01-01"
      }
    );

    expect(advisory).toMatchObject({
      security_posture: {
        http_bind_is_local: false,
        http_auth_configured: false,
        http_non_local_startup_blocked: true,
        response_caps: {
          max_file_size_bytes: 1_048_576,
          max_diff_size_bytes: 2_097_152,
          max_api_response_bytes: 4_194_304,
          gitlab_http_timeout_ms: 30_000
        }
      }
    });
    expect(advisory.likely_blocked_capabilities).toContain(
      "HTTP transport startup is blocked because non-local binding requires MCP_HTTP_ALLOW_NON_LOCALHOST=true and MCP_HTTP_AUTH_TOKEN."
    );
    expect(advisory.warnings).toContain(
      "MCP_HTTP_HOST is configured outside localhost without the required non-local override and bearer token."
    );
    expect(advisory.recommended_next_checks).toContain(
      "For non-local HTTP mode, set MCP_HTTP_AUTH_TOKEN, MCP_HTTP_ALLOW_NON_LOCALHOST=true, and strict MCP_HTTP_ALLOWED_HOSTS/MCP_HTTP_ALLOWED_ORIGINS."
    );
  });

  it("handles non-PAT tokens by surfacing unknown scope visibility", () => {
    const advisory = buildTokenValidationAdvisory(baseConfig, null);

    expect(advisory).toMatchObject({
      token_kind: "project_group_or_oauth_token",
      scope_summary: {
        token_scopes_known: false,
        token_scopes: [],
        has_read_api_scope: null,
        has_write_api_scope: null
      },
      token_expiry_days: null
    });

    expect(advisory.recommended_next_checks).toContain(
      "If this is not a personal access token, confirm the token type and resource scope directly in GitLab because PAT scope introspection is unavailable."
    );
  });
});
