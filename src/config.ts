import { z } from "zod";

const truthyValues = new Set(["1", "true", "yes", "on"]);
const defaultHttpAllowedHosts = "localhost,127.0.0.1,[::1]";

const envSchema = z.object({
  GITLAB_BASE_URL: z.string().default("https://gitlab.com"),
  GITLAB_TOKEN: z.string().min(1, "GITLAB_TOKEN is required"),
  GITLAB_TOKEN_HEADER_MODE: z.enum(["bearer", "private-token"]).default("bearer"),
  GITLAB_MCP_TOOL_PROFILE: z.enum([
    "full",
    "readonly",
    "core",
    "mr-review",
    "ci-triage",
    "delivery",
    "release",
    "governance",
    "maintainer-write"
  ]).default("readonly"),
  GITLAB_MCP_ENABLED_TOOLS: z.string().default(""),
  GITLAB_MCP_DISABLED_TOOLS: z.string().default(""),
  GITLAB_MCP_EXPOSE_DISABLED_WRITES: z.string().default("false"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_PORT: z.string().default("3333"),
  MCP_HTTP_PATH: z.string().default("/mcp"),
  MCP_HTTP_ALLOWED_ORIGINS: z.string().default(""),
  MCP_HTTP_ALLOWED_HOSTS: z.string().default(defaultHttpAllowedHosts),
  MCP_HTTP_AUTH_TOKEN: z.string().optional(),
  MCP_HTTP_ALLOW_NON_LOCALHOST: z.string().default("false"),
  ENABLE_WRITE_TOOLS: z.string().default("false"),
  ENABLE_DESTRUCTIVE_TOOLS: z.string().default("false"),
  ENABLE_DRY_RUN: z.string().default("false"),
  PROJECT_ALIASES: z.string().default(""),
  GROUP_ALIASES: z.string().default(""),
  PROJECT_ALLOWLIST: z.string().default(""),
  GROUP_ALLOWLIST: z.string().default(""),
  PROJECT_DENYLIST: z.string().default(""),
  MAX_FILE_SIZE_BYTES: z.string().default("1048576"),
  MAX_DIFF_SIZE_BYTES: z.string().default("2097152"),
  MAX_API_RESPONSE_BYTES: z.string().default("4194304"),
  GITLAB_HTTP_TIMEOUT_MS: z.string().default("30000"),
  GITLAB_USER_AGENT: z.string().default("gitlab-mcp-server"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  AUDIT_LOG_PATH: z.string().optional(),
  EXPOSE_SECRET_VARIABLE_VALUES: z.string().default("false")
});

export type LogLevel = "debug" | "info" | "warn" | "error";
export type TokenHeaderMode = "bearer" | "private-token";
export type McpTransportMode = "stdio" | "http";
export type AliasMap = Readonly<Record<string, string>>;
export type ToolProfile =
  | "full"
  | "readonly"
  | "core"
  | "mr-review"
  | "ci-triage"
  | "delivery"
  | "release"
  | "governance"
  | "maintainer-write";

export interface AppConfig {
  readonly gitlabBaseUrl: string;
  readonly gitlabToken: string;
  readonly tokenHeaderMode: TokenHeaderMode;
  readonly toolProfile: ToolProfile;
  readonly enabledTools: readonly string[];
  readonly disabledTools: readonly string[];
  readonly exposeDisabledWriteTools: boolean;
  readonly mcpTransport: McpTransportMode;
  readonly mcpHttpHost: string;
  readonly mcpHttpPort: number;
  readonly mcpHttpPath: string;
  readonly mcpHttpAllowedOrigins: readonly string[];
  readonly mcpHttpAllowedHosts: readonly string[];
  readonly mcpHttpAuthToken?: string;
  readonly mcpHttpAllowNonLocalhost: boolean;
  readonly enableWriteTools: boolean;
  readonly enableDestructiveTools: boolean;
  readonly enableDryRun: boolean;
  readonly projectAliases: AliasMap;
  readonly groupAliases: AliasMap;
  readonly projectAllowlist: readonly string[];
  readonly groupAllowlist: readonly string[];
  readonly projectDenylist: readonly string[];
  readonly maxFileSizeBytes: number;
  readonly maxDiffSizeBytes: number;
  readonly maxApiResponseBytes: number;
  readonly httpTimeoutMs: number;
  readonly gitlabUserAgent: string;
  readonly logLevel: LogLevel;
  readonly auditLogPath?: string;
  readonly exposeSecretVariableValues: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    gitlabBaseUrl: normalizeGitLabBaseUrl(parsed.GITLAB_BASE_URL),
    gitlabToken: parsed.GITLAB_TOKEN.trim(),
    tokenHeaderMode: parsed.GITLAB_TOKEN_HEADER_MODE,
    toolProfile: parsed.GITLAB_MCP_TOOL_PROFILE,
    enabledTools: parseCsvList(parsed.GITLAB_MCP_ENABLED_TOOLS),
    disabledTools: parseCsvList(parsed.GITLAB_MCP_DISABLED_TOOLS),
    exposeDisabledWriteTools: parseBoolean(parsed.GITLAB_MCP_EXPOSE_DISABLED_WRITES),
    mcpTransport: parsed.MCP_TRANSPORT,
    mcpHttpHost: parsed.MCP_HTTP_HOST.trim(),
    mcpHttpPort: parsePort(parsed.MCP_HTTP_PORT, "MCP_HTTP_PORT"),
    mcpHttpPath: normalizeHttpPath(parsed.MCP_HTTP_PATH),
    mcpHttpAllowedOrigins: parseCsvList(parsed.MCP_HTTP_ALLOWED_ORIGINS),
    mcpHttpAllowedHosts: parseCsvList(parsed.MCP_HTTP_ALLOWED_HOSTS),
    mcpHttpAuthToken: parsed.MCP_HTTP_AUTH_TOKEN?.trim() || undefined,
    mcpHttpAllowNonLocalhost: parseBoolean(parsed.MCP_HTTP_ALLOW_NON_LOCALHOST),
    enableWriteTools: parseBoolean(parsed.ENABLE_WRITE_TOOLS),
    enableDestructiveTools: parseBoolean(parsed.ENABLE_DESTRUCTIVE_TOOLS),
    enableDryRun: parseBoolean(parsed.ENABLE_DRY_RUN),
    projectAliases: parseAliasMap(parsed.PROJECT_ALIASES, "PROJECT_ALIASES"),
    groupAliases: parseAliasMap(parsed.GROUP_ALIASES, "GROUP_ALIASES"),
    projectAllowlist: parseCsvList(parsed.PROJECT_ALLOWLIST),
    groupAllowlist: parseCsvList(parsed.GROUP_ALLOWLIST),
    projectDenylist: parseCsvList(parsed.PROJECT_DENYLIST),
    maxFileSizeBytes: parsePositiveInt(parsed.MAX_FILE_SIZE_BYTES, "MAX_FILE_SIZE_BYTES"),
    maxDiffSizeBytes: parsePositiveInt(parsed.MAX_DIFF_SIZE_BYTES, "MAX_DIFF_SIZE_BYTES"),
    maxApiResponseBytes: parsePositiveInt(parsed.MAX_API_RESPONSE_BYTES, "MAX_API_RESPONSE_BYTES"),
    httpTimeoutMs: parsePositiveInt(parsed.GITLAB_HTTP_TIMEOUT_MS, "GITLAB_HTTP_TIMEOUT_MS"),
    gitlabUserAgent: parsed.GITLAB_USER_AGENT.trim(),
    logLevel: parsed.LOG_LEVEL,
    auditLogPath: parsed.AUDIT_LOG_PATH?.trim() || undefined,
    exposeSecretVariableValues: parseBoolean(parsed.EXPOSE_SECRET_VARIABLE_VALUES)
  };
}

function normalizeGitLabBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (trimmed.endsWith("/api/v4")) {
    return trimmed;
  }

  return `${trimmed}/api/v4`;
}

function parseBoolean(value: string): boolean {
  return truthyValues.has(value.trim().toLowerCase());
}

function parseCsvList(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseAliasMap(value: string, name: string): AliasMap {
  if (value.trim().length === 0) {
    return {};
  }

  const aliases: Record<string, string> = {};

  for (const entry of value.split(",").map((item) => item.trim()).filter((item) => item.length > 0)) {
    const separatorIndex = entry.indexOf("=");

    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error(`${name} entries must use alias=value format. Invalid entry: "${entry}".`);
    }

    const alias = entry.slice(0, separatorIndex).trim();
    const target = entry.slice(separatorIndex + 1).trim();

    if (alias.length === 0 || target.length === 0) {
      throw new Error(`${name} entries must use alias=value format. Invalid entry: "${entry}".`);
    }

    aliases[alias] = target;
  }

  return aliases;
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parsePort(value: string, name: string): number {
  const parsed = parsePositiveInt(value, name);

  if (parsed > 65535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }

  return parsed;
}

function normalizeHttpPath(value: string): string {
  const trimmed = value.trim();

  if (!trimmed.startsWith("/") || trimmed.includes("?") || trimmed.includes("#")) {
    throw new Error("MCP_HTTP_PATH must start with / and cannot include query strings or fragments");
  }

  return trimmed.replace(/\/+$/, "") || "/";
}
