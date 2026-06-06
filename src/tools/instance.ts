import { z } from "zod";

import type { AppConfig } from "../config.js";
import { assertGroupAllowed, assertProjectAllowed } from "../security/guards.js";
import type { JsonMap } from "../gitlab/types.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";

function isAllowedProject(config: ToolDeps["config"], project: JsonMap): boolean {
  try {
    assertProjectAllowed(config, project);
    return true;
  } catch {
    return false;
  }
}

function isAllowedGroup(config: ToolDeps["config"], group: JsonMap): boolean {
  try {
    assertGroupAllowed(config, group);
    return true;
  } catch {
    return false;
  }
}

function extractTokenScopes(personalAccessToken: JsonMap | null): readonly string[] | null {
  if (!personalAccessToken) {
    return null;
  }

  const scopes = personalAccessToken.scopes;
  if (Array.isArray(scopes)) {
    return scopes.filter((scope): scope is string => typeof scope === "string" && scope.length > 0);
  }

  const scope = personalAccessToken.scope;
  if (typeof scope === "string" && scope.length > 0) {
    return [scope];
  }

  return null;
}

function daysUntil(isoDate: unknown): number | null {
  if (typeof isoDate !== "string" || isoDate.length === 0) {
    return null;
  }

  const target = Date.parse(isoDate);
  if (!Number.isFinite(target)) {
    return null;
  }

  return Math.ceil((target - Date.now()) / (1000 * 60 * 60 * 24));
}

function modeSummary(config: AppConfig): string {
  if (config.enableDestructiveTools) {
    return "destructive-enabled";
  }

  if (config.enableWriteTools) {
    return "write-enabled";
  }

  return "read-only";
}

function isLocalHttpHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]";
}

export function buildTokenValidationAdvisory(
  config: AppConfig,
  personalAccessToken: JsonMap | null
): JsonMap {
  const tokenScopes = extractTokenScopes(personalAccessToken);
  const hasReadApiScope = tokenScopes === null
    ? null
    : tokenScopes.includes("read_api") || tokenScopes.includes("api");
  const hasWriteApiScope = tokenScopes === null ? null : tokenScopes.includes("api");
  const expiryDays = daysUntil(personalAccessToken?.expires_at);
  const hasProjectOrGroupAllowlist = config.projectAllowlist.length > 0 || config.groupAllowlist.length > 0;
  const httpBindIsLocal = isLocalHttpHost(config.mcpHttpHost);
  const httpNonLocalStartupBlocked = !httpBindIsLocal &&
    (!config.mcpHttpAllowNonLocalhost || !config.mcpHttpAuthToken);

  const likelyBlockedCapabilities: string[] = [];
  const warnings: string[] = [];
  const recommendedNextChecks: string[] = [];

  if (!config.enableWriteTools) {
    likelyBlockedCapabilities.push("All write-capable tools are blocked because ENABLE_WRITE_TOOLS is disabled.");
  }

  if (!config.enableDestructiveTools) {
    likelyBlockedCapabilities.push(
      "Destructive tools are blocked because ENABLE_DESTRUCTIVE_TOOLS is disabled."
    );
  }

  if (config.projectAllowlist.length > 0) {
    likelyBlockedCapabilities.push("Projects outside PROJECT_ALLOWLIST are blocked.");
  }

  if (config.groupAllowlist.length > 0) {
    likelyBlockedCapabilities.push("Groups and projects outside GROUP_ALLOWLIST are blocked.");
  }

  if (config.projectDenylist.length > 0) {
    likelyBlockedCapabilities.push("Projects listed in PROJECT_DENYLIST are blocked.");
  }

  if (httpNonLocalStartupBlocked) {
    likelyBlockedCapabilities.push(
      "HTTP transport startup is blocked because non-local binding requires MCP_HTTP_ALLOW_NON_LOCALHOST=true and MCP_HTTP_AUTH_TOKEN."
    );
  }

  if (config.enableWriteTools && hasWriteApiScope === false) {
    likelyBlockedCapabilities.push(
      "Write-capable tools will likely fail because the token scopes do not include api."
    );
    warnings.push(
      "ENABLE_WRITE_TOOLS is enabled, but the detected personal access token scopes do not include api."
    );
  }

  if (hasReadApiScope === false) {
    warnings.push(
      "The detected personal access token scopes do not include read_api or api, so some repository and project reads may fail."
    );
  }

  if (!config.enableWriteTools && hasWriteApiScope === true) {
    warnings.push(
      "The token appears capable of writes, but this server is still operating in read-only mode until ENABLE_WRITE_TOOLS is enabled."
    );
  }

  if (!hasProjectOrGroupAllowlist) {
    warnings.push(
      "No project or group allowlists are configured, so accessible scope is controlled only by the GitLab token permissions."
    );
  }

  if (config.enableWriteTools && !hasProjectOrGroupAllowlist) {
    warnings.push(
      "ENABLE_WRITE_TOOLS is enabled without PROJECT_ALLOWLIST or GROUP_ALLOWLIST, so any project visible to the token may be writable."
    );
  }

  if (Object.keys(config.projectAliases).length > 0 || Object.keys(config.groupAliases).length > 0) {
    recommendedNextChecks.push(
      "If you use aliases, confirm the expected canonical project and group paths before sharing example prompts with the team."
    );
  }

  if (config.enableDestructiveTools && !config.enableWriteTools) {
    warnings.push(
      "ENABLE_DESTRUCTIVE_TOOLS is enabled without ENABLE_WRITE_TOOLS, so destructive actions remain inconsistent with the broader write posture."
    );
  }

  if (config.enableDestructiveTools) {
    warnings.push(
      "ENABLE_DESTRUCTIVE_TOOLS is enabled; destructive tools still require confirm_destructive=true but should be used only with narrow allowlists."
    );
  }

  if (config.enableDestructiveTools && !hasProjectOrGroupAllowlist) {
    warnings.push(
      "Destructive tools are enabled without PROJECT_ALLOWLIST or GROUP_ALLOWLIST."
    );
  }

  if (!httpBindIsLocal) {
    if (httpNonLocalStartupBlocked) {
      warnings.push(
        "MCP_HTTP_HOST is configured outside localhost without the required non-local override and bearer token."
      );
    } else {
      warnings.push(
        "MCP_HTTP_HOST is configured outside localhost; expose it only on trusted networks with bearer auth and strict host/origin allowlists."
      );
    }
  }

  if (expiryDays !== null && expiryDays < 0) {
    warnings.push("The detected personal access token reports an expiry date in the past.");
  } else if (expiryDays !== null && expiryDays <= 14) {
    warnings.push(`The detected personal access token expires in ${expiryDays} day(s).`);
  }

  recommendedNextChecks.push(
    "Run gitlab_list_accessible_projects with membership=true to confirm which projects are visible to this token."
  );

  if (config.projectAllowlist.length > 0 || config.groupAllowlist.length > 0) {
    recommendedNextChecks.push(
      "Verify that your intended project is inside the configured allowlists before relying on agent workflows."
    );
  }

  if (!config.enableWriteTools) {
    recommendedNextChecks.push(
      "Keep using read-only workflows, or enable ENABLE_WRITE_TOOLS=true only when safe-write tools are explicitly needed."
    );
  } else if (!hasProjectOrGroupAllowlist) {
    recommendedNextChecks.push(
      "Configure PROJECT_ALLOWLIST or GROUP_ALLOWLIST before write-enabled sessions so agent writes stay inside reviewed targets."
    );
  } else if (!config.enableDryRun) {
    recommendedNextChecks.push(
      "Consider enabling ENABLE_DRY_RUN=true before the first write-enabled session so intended mutations can be reviewed safely."
    );
  }

  if (config.enableWriteTools && hasWriteApiScope === false) {
    recommendedNextChecks.push(
      "Use a token with api scope before attempting write-capable tools."
    );
  }

  if (!config.enableDestructiveTools) {
    recommendedNextChecks.push(
      "Leave destructive tools disabled unless you have a narrow, reviewed need for them."
    );
  } else {
    recommendedNextChecks.push(
      "Keep destructive mode temporary, scoped by allowlists, and paired with per-call confirm_destructive=true review."
    );
  }

  if (httpNonLocalStartupBlocked) {
    recommendedNextChecks.push(
      "For non-local HTTP mode, set MCP_HTTP_AUTH_TOKEN, MCP_HTTP_ALLOW_NON_LOCALHOST=true, and strict MCP_HTTP_ALLOWED_HOSTS/MCP_HTTP_ALLOWED_ORIGINS."
    );
  } else if (!httpBindIsLocal) {
    recommendedNextChecks.push(
      "Review MCP_HTTP_ALLOWED_HOSTS and MCP_HTTP_ALLOWED_ORIGINS before sharing a non-local HTTP endpoint."
    );
  }

  if (tokenScopes === null) {
    recommendedNextChecks.push(
      "If this is not a personal access token, confirm the token type and resource scope directly in GitLab because PAT scope introspection is unavailable."
    );
  }

  return {
    server_mode: modeSummary(config),
    tool_profile: config.toolProfile,
    token_kind: personalAccessToken ? "personal_access_token" : "project_group_or_oauth_token",
    scope_summary: {
      token_scopes_known: tokenScopes !== null,
      token_scopes: tokenScopes ?? [],
      has_read_api_scope: hasReadApiScope,
      has_write_api_scope: hasWriteApiScope
    },
    security_posture: {
      write_mode_without_allowlist: config.enableWriteTools && !hasProjectOrGroupAllowlist,
      destructive_mode_enabled: config.enableDestructiveTools,
      http_bind_is_local: httpBindIsLocal,
      http_auth_configured: Boolean(config.mcpHttpAuthToken),
      http_non_local_startup_blocked: httpNonLocalStartupBlocked,
      response_caps: {
        max_file_size_bytes: config.maxFileSizeBytes,
        max_diff_size_bytes: config.maxDiffSizeBytes,
        max_api_response_bytes: config.maxApiResponseBytes,
        gitlab_http_timeout_ms: config.httpTimeoutMs
      }
    },
    access_controls: {
      enabled_tool_count: config.enabledTools.length,
      disabled_tool_count: config.disabledTools.length,
      disabled_write_tools_exposed: config.exposeDisabledWriteTools,
      project_aliases_enabled: Object.keys(config.projectAliases).length > 0,
      group_aliases_enabled: Object.keys(config.groupAliases).length > 0,
      project_allowlist_enabled: config.projectAllowlist.length > 0,
      group_allowlist_enabled: config.groupAllowlist.length > 0,
      project_denylist_enabled: config.projectDenylist.length > 0,
      project_alias_count: Object.keys(config.projectAliases).length,
      group_alias_count: Object.keys(config.groupAliases).length,
      project_allowlist_count: config.projectAllowlist.length,
      group_allowlist_count: config.groupAllowlist.length,
      project_denylist_count: config.projectDenylist.length
    },
    likely_blocked_capabilities: likelyBlockedCapabilities,
    warnings,
    recommended_next_checks: recommendedNextChecks,
    dry_run_recommended: config.enableWriteTools && !config.enableDryRun,
    token_expiry_days: expiryDays
  };
}

export function registerInstanceTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_get_current_user",
    title: "Get Current User",
    description: "Return the authenticated GitLab user associated with the configured token.",
    safety: "read-only",
    inputSchema: {},
    handler: async (_args, { client }) => {
      const response = await client.getJson<JsonMap>("/user");
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_validate_token",
    title: "Validate Token",
    description:
      "Validate the configured token against GitLab and return identity, version, and server configuration status.",
    safety: "read-only",
    inputSchema: {},
    handler: async (_args, { client, config }) => {
      const [userResponse, versionResponse] = await Promise.all([
        client.getJson<JsonMap>("/user"),
        client.getJson<JsonMap>("/version")
      ]);

      let patDetails: JsonMap | null = null;

      try {
        const patResponse = await client.getJson<JsonMap>("/personal_access_tokens/self");
        patDetails = patResponse.data;
      } catch {
        patDetails = null;
      }

      return {
        valid: true,
        user: userResponse.data,
        version: versionResponse.data,
        token_header_mode: config.tokenHeaderMode,
        tool_profile: config.toolProfile,
        enabled_tools: config.enabledTools,
        disabled_tools: config.disabledTools,
        disabled_write_tools_exposed: config.exposeDisabledWriteTools,
        write_tools_enabled: config.enableWriteTools,
        destructive_tools_enabled: config.enableDestructiveTools,
        dry_run_enabled: config.enableDryRun,
        personal_access_token: patDetails,
        advisory: buildTokenValidationAdvisory(config, patDetails)
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_version",
    title: "Get GitLab Version",
    description: "Return the version metadata of the connected GitLab instance.",
    safety: "read-only",
    inputSchema: {},
    handler: async (_args, { client }) => {
      const response = await client.getJson<JsonMap>("/version");
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_list_accessible_projects",
    title: "List Accessible Projects",
    description:
      "List projects accessible to the configured token, filtered by configured allowlists and deny lists.",
    safety: "read-only",
    inputSchema: {
      membership: z.boolean().optional().default(true),
      search: z.string().trim().optional(),
      archived: z.boolean().optional(),
      min_access_level: z.number().int().min(0).max(50).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, config }) => {
      const response = await client.getJson<JsonMap[]>("/projects", {
        query: cleanQuery({
          membership: args.membership,
          search: args.search,
          archived: args.archived,
          min_access_level: args.min_access_level,
          page: args.page,
          per_page: args.per_page,
          simple: true
        })
      });

      return {
        items: response.data.filter((project) => isAllowedProject(config, project)),
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_list_accessible_groups",
    title: "List Accessible Groups",
    description:
      "List groups accessible to the configured token, filtered by the configured group allowlist when present.",
    safety: "read-only",
    inputSchema: {
      search: z.string().trim().optional(),
      min_access_level: z.number().int().min(0).max(50).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, config }) => {
      const response = await client.getJson<JsonMap[]>("/groups", {
        query: cleanQuery({
          search: args.search,
          min_access_level: args.min_access_level,
          page: args.page,
          per_page: args.per_page,
          all_available: false
        })
      });

      return {
        items: response.data.filter((group) => isAllowedGroup(config, group)),
        pagination: response.pagination
      };
    }
  });
}
