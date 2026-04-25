import { z } from "zod";

const truthyValues = new Set(["1", "true", "yes", "on"]);

const envSchema = z.object({
  GITLAB_BASE_URL: z.string().default("https://gitlab.com"),
  GITLAB_TOKEN: z.string().min(1, "GITLAB_TOKEN is required"),
  GITLAB_TOKEN_HEADER_MODE: z.enum(["bearer", "private-token"]).default("bearer"),
  ENABLE_WRITE_TOOLS: z.string().default("false"),
  ENABLE_DESTRUCTIVE_TOOLS: z.string().default("false"),
  ENABLE_DRY_RUN: z.string().default("false"),
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

export interface AppConfig {
  readonly gitlabBaseUrl: string;
  readonly gitlabToken: string;
  readonly tokenHeaderMode: TokenHeaderMode;
  readonly enableWriteTools: boolean;
  readonly enableDestructiveTools: boolean;
  readonly enableDryRun: boolean;
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
    enableWriteTools: parseBoolean(parsed.ENABLE_WRITE_TOOLS),
    enableDestructiveTools: parseBoolean(parsed.ENABLE_DESTRUCTIVE_TOOLS),
    enableDryRun: parseBoolean(parsed.ENABLE_DRY_RUN),
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

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}
