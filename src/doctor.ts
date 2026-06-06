import { loadConfig, type AppConfig } from "./config.js";
import { GitLabClient } from "./gitlab/client.js";
import type { JsonMap } from "./gitlab/types.js";
import { buildTokenValidationAdvisory } from "./tools/instance.js";

function stringValue(value: unknown, fallback = "n/a"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function booleanLabel(value: boolean): string {
  return value ? "enabled" : "disabled";
}

function bulletList(items: readonly string[]): readonly string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

function isLocalHttpHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]";
}

export function resolveCliMode(
  argv: readonly string[],
  env: Partial<Pick<NodeJS.ProcessEnv, "MCP_TRANSPORT">> = process.env
): "server" | "doctor" | "http" {
  const firstArg = argv[0];

  if (firstArg === "doctor" || firstArg === "--doctor") {
    return "doctor";
  }

  if (firstArg === "serve-http" || firstArg === "--http") {
    return "http";
  }

  return env.MCP_TRANSPORT === "http" ? "http" : "server";
}

export function formatDoctorReport(params: {
  readonly config: AppConfig;
  readonly user: JsonMap;
  readonly version: JsonMap;
  readonly personalAccessToken: JsonMap | null;
  readonly advisory: JsonMap;
}): string {
  const advisoryWarnings = Array.isArray(params.advisory.warnings)
    ? params.advisory.warnings.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const recommendedNextChecks = Array.isArray(params.advisory.recommended_next_checks)
    ? params.advisory.recommended_next_checks.filter(
        (item): item is string => typeof item === "string" && item.length > 0
      )
    : [];
  const likelyBlockedCapabilities = Array.isArray(params.advisory.likely_blocked_capabilities)
    ? params.advisory.likely_blocked_capabilities.filter(
        (item): item is string => typeof item === "string" && item.length > 0
      )
    : [];
  const scopeSummary = typeof params.advisory.scope_summary === "object" && params.advisory.scope_summary !== null
    ? (params.advisory.scope_summary as JsonMap)
    : {};
  const accessControls = typeof params.advisory.access_controls === "object" && params.advisory.access_controls !== null
    ? (params.advisory.access_controls as JsonMap)
    : {};
  const scopes = Array.isArray(scopeSummary.token_scopes)
    ? scopeSummary.token_scopes.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const expiryDays = typeof params.advisory.token_expiry_days === "number"
    ? params.advisory.token_expiry_days
    : null;

  return [
    "GitLab MCP Doctor",
    "",
    "Connection",
    `- GitLab API base URL: ${params.config.gitlabBaseUrl}`,
    `- Token header mode: ${params.config.tokenHeaderMode}`,
    `- Authenticated user: ${stringValue(params.user.username)} (${stringValue(params.user.name)})`,
    `- GitLab version: ${stringValue(params.version.version)} (${stringValue(params.version.revision)})`,
    "",
    "Server Posture",
    `- Server mode: ${stringValue(params.advisory.server_mode)}`,
    `- MCP transport: ${params.config.mcpTransport}`,
    `- Tool profile: ${params.config.toolProfile}`,
    `- Disabled write tools exposed: ${booleanLabel(params.config.exposeDisabledWriteTools)}`,
    `- Write tools: ${booleanLabel(params.config.enableWriteTools)}`,
    `- Destructive tools: ${booleanLabel(params.config.enableDestructiveTools)}`,
    `- Dry run: ${booleanLabel(params.config.enableDryRun)}`,
    "",
    "HTTP Transport",
    `- HTTP host: ${params.config.mcpHttpHost}`,
    `- HTTP port: ${params.config.mcpHttpPort}`,
    `- HTTP path: ${params.config.mcpHttpPath}`,
    `- HTTP auth token configured: ${params.config.mcpHttpAuthToken ? "yes" : "no"}`,
    `- HTTP localhost bind: ${isLocalHttpHost(params.config.mcpHttpHost) ? "yes" : "no"}`,
    `- HTTP non-local bind override: ${booleanLabel(params.config.mcpHttpAllowNonLocalhost)}`,
    `- HTTP allowed host count: ${params.config.mcpHttpAllowedHosts.length}`,
    `- HTTP allowed origin count: ${params.config.mcpHttpAllowedOrigins.length}`,
    "",
    "Payload Limits",
    `- Max file size bytes: ${params.config.maxFileSizeBytes}`,
    `- Max diff size bytes: ${params.config.maxDiffSizeBytes}`,
    `- Max API response bytes: ${params.config.maxApiResponseBytes}`,
    `- GitLab HTTP timeout ms: ${params.config.httpTimeoutMs}`,
    "",
    "Token Summary",
    `- Token kind: ${stringValue(params.advisory.token_kind)}`,
    `- Personal access token introspection: ${params.personalAccessToken ? "available" : "unavailable"}`,
    `- Token scopes known: ${scopeSummary.token_scopes_known === true ? "yes" : "no"}`,
    `- Token scopes: ${scopes.length > 0 ? scopes.join(", ") : "n/a"}`,
    `- PAT expires in days: ${expiryDays ?? "n/a"}`,
    "",
    "Access Controls",
    `- Project allowlist enabled: ${accessControls.project_allowlist_enabled === true ? "yes" : "no"}`,
    `- Group allowlist enabled: ${accessControls.group_allowlist_enabled === true ? "yes" : "no"}`,
    `- Project denylist enabled: ${accessControls.project_denylist_enabled === true ? "yes" : "no"}`,
    `- Project aliases enabled: ${accessControls.project_aliases_enabled === true ? "yes" : "no"}`,
    `- Group aliases enabled: ${accessControls.group_aliases_enabled === true ? "yes" : "no"}`,
    `- Project alias count: ${typeof accessControls.project_alias_count === "number" ? accessControls.project_alias_count : 0}`,
    `- Group alias count: ${typeof accessControls.group_alias_count === "number" ? accessControls.group_alias_count : 0}`,
    `- Explicit enabled tool count: ${typeof accessControls.enabled_tool_count === "number" ? accessControls.enabled_tool_count : 0}`,
    `- Explicit disabled tool count: ${typeof accessControls.disabled_tool_count === "number" ? accessControls.disabled_tool_count : 0}`,
    `- Project allowlist count: ${typeof accessControls.project_allowlist_count === "number" ? accessControls.project_allowlist_count : 0}`,
    `- Group allowlist count: ${typeof accessControls.group_allowlist_count === "number" ? accessControls.group_allowlist_count : 0}`,
    `- Project denylist count: ${typeof accessControls.project_denylist_count === "number" ? accessControls.project_denylist_count : 0}`,
    "",
    "Likely Blocked Capabilities",
    ...bulletList(likelyBlockedCapabilities),
    "",
    "Warnings",
    ...bulletList(advisoryWarnings),
    "",
    "Recommended Next Checks",
    ...bulletList(recommendedNextChecks)
  ].join("\n");
}

async function getPersonalAccessTokenDetails(client: GitLabClient): Promise<JsonMap | null> {
  try {
    const response = await client.getJson<JsonMap>("/personal_access_tokens/self");
    return response.data;
  } catch {
    return null;
  }
}

export async function runDoctor(config: AppConfig = loadConfig()): Promise<void> {
  const client = new GitLabClient(config);
  const [userResponse, versionResponse, personalAccessToken] = await Promise.all([
    client.getJson<JsonMap>("/user"),
    client.getJson<JsonMap>("/version"),
    getPersonalAccessTokenDetails(client)
  ]);

  const advisory = buildTokenValidationAdvisory(config, personalAccessToken);

  console.log(
    formatDoctorReport({
      config,
      user: userResponse.data,
      version: versionResponse.data,
      personalAccessToken,
      advisory
    })
  );
}
