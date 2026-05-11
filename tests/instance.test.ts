import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { buildTokenValidationAdvisory } from "../src/tools/instance.js";

const baseConfig: AppConfig = {
  gitlabBaseUrl: "https://gitlab.com/api/v4",
  gitlabToken: "test-token",
  tokenHeaderMode: "bearer",
  enableWriteTools: false,
  enableDestructiveTools: false,
  enableDryRun: false,
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
        project_allowlist_enabled: true,
        group_allowlist_enabled: true,
        project_denylist_enabled: true,
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
