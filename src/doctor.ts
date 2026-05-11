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

export function resolveCliMode(argv: readonly string[]): "server" | "doctor" {
  const firstArg = argv[0];

  return firstArg === "doctor" || firstArg === "--doctor" ? "doctor" : "server";
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
    `- Write tools: ${booleanLabel(params.config.enableWriteTools)}`,
    `- Destructive tools: ${booleanLabel(params.config.enableDestructiveTools)}`,
    `- Dry run: ${booleanLabel(params.config.enableDryRun)}`,
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
