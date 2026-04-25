import { appendFile } from "node:fs/promises";

import { fetch, Headers } from "undici";

import type { AppConfig, LogLevel } from "../config.js";
import {
  ResponseTooLargeError,
  normalizeGitLabError
} from "./errors.js";
import { parsePaginationHeaders, type PaginationMeta } from "./pagination.js";
import { redactSecrets, redactValue } from "../security/redaction.js";

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  readonly query?: Record<string, string | number | boolean | undefined | null | readonly string[]>;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface JsonResponse<T> {
  readonly data: T;
  readonly headers: Headers;
  readonly pagination: PaginationMeta;
}

export interface AuditEntry {
  readonly level?: LogLevel;
  readonly event: string;
  readonly tool?: string;
  readonly safety?: string;
  readonly status?: "ok" | "error" | "blocked";
  readonly metadata?: Record<string, unknown>;
}

export class GitLabClient {
  public constructor(private readonly config: AppConfig) {}

  public async getJson<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<JsonResponse<T>> {
    return this.requestJson<T>(path, { ...options, method: "GET" });
  }

  public async head(path: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<Headers> {
    const response = await this.requestRaw(path, { ...options, method: "HEAD" });
    return response.headers;
  }

  public async postJson<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<JsonResponse<T>> {
    return this.requestJson<T>(path, { ...options, method: "POST" });
  }

  public async putJson<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<JsonResponse<T>> {
    return this.requestJson<T>(path, { ...options, method: "PUT" });
  }

  public async patchJson<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<JsonResponse<T>> {
    return this.requestJson<T>(path, { ...options, method: "PATCH" });
  }

  public async deleteJson<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<JsonResponse<T>> {
    return this.requestJson<T>(path, { ...options, method: "DELETE" });
  }

  public async audit(entry: AuditEntry): Promise<void> {
    const payload = {
      timestamp: new Date().toISOString(),
      level: entry.level ?? "info",
      ...entry
    };

    const line = redactSecrets(JSON.stringify(payload), [this.config.gitlabToken]);

    if (this.config.auditLogPath) {
      await appendFile(this.config.auditLogPath, `${line}\n`, "utf8");
      return;
    }

    if (shouldLog(this.config.logLevel, payload.level)) {
      console.error(line);
    }
  }

  public async requestJson<T>(path: string, options: RequestOptions = {}): Promise<JsonResponse<T>> {
    const response = await this.requestRaw(path, options);

    if (options.method === "HEAD") {
      return {
        data: undefined as T,
        headers: response.headers,
        pagination: parsePaginationHeaders(response.headers)
      };
    }

    const buffer = await this.readBody(response);
    const contentType = response.headers.get("content-type") ?? "";
    const text = buffer.toString("utf8");
    const data = contentType.includes("application/json") && text.length > 0
      ? (JSON.parse(text) as T)
      : (text as T);

    return {
      data,
      headers: response.headers,
      pagination: parsePaginationHeaders(response.headers)
    };
  }

  private async requestRaw(path: string, options: RequestOptions) {
    const url = buildUrl(this.config.gitlabBaseUrl, path, options.query);
    const method = options.method ?? "GET";
    const headers = buildHeaders(this.config, options.headers, method, options.body);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(this.config.httpTimeoutMs)
    });

    if (!response.ok) {
      const errorBody = await this.tryReadErrorBody(response);
      throw normalizeGitLabError({
        status: response.status,
        endpoint: url,
        requestId: response.headers.get("x-request-id"),
        retryAfterHeader: response.headers.get("retry-after"),
        body: errorBody
      });
    }

    return response;
  }

  private async readBody(response: Response): Promise<Buffer> {
    const contentLength = response.headers.get("content-length");
    const headerBytes = contentLength ? Number.parseInt(contentLength, 10) : undefined;

    if (headerBytes && Number.isFinite(headerBytes) && headerBytes > this.config.maxApiResponseBytes) {
      throw new ResponseTooLargeError(
        `GitLab response exceeds the configured limit (${headerBytes} bytes > ${this.config.maxApiResponseBytes} bytes).`,
        this.config.maxApiResponseBytes
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength > this.config.maxApiResponseBytes) {
      throw new ResponseTooLargeError(
        `GitLab response exceeds the configured limit (${buffer.byteLength} bytes > ${this.config.maxApiResponseBytes} bytes).`,
        this.config.maxApiResponseBytes
      );
    }

    return buffer;
  }

  private async tryReadErrorBody(response: Response): Promise<unknown> {
    try {
      const buffer = await this.readBody(response);
      const text = buffer.toString("utf8");
      const contentType = response.headers.get("content-type") ?? "";

      if (contentType.includes("application/json") && text.length > 0) {
        return redactValue(JSON.parse(text), [this.config.gitlabToken]);
      }

      return redactSecrets(text, [this.config.gitlabToken]);
    } catch {
      return undefined;
    }
  }
}

function buildHeaders(
  config: AppConfig,
  headers: Record<string, string> | undefined,
  method: string,
  body: unknown
): Headers {
  const resolved = new Headers(headers);
  resolved.set("accept", "application/json");
  resolved.set("user-agent", config.gitlabUserAgent);

  if (config.tokenHeaderMode === "private-token") {
    resolved.set("private-token", config.gitlabToken);
  } else {
    resolved.set("authorization", `Bearer ${config.gitlabToken}`);
  }

  if (body !== undefined && method !== "HEAD") {
    resolved.set("content-type", "application/json");
  }

  return resolved;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: RequestOptions["query"]
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (!query) {
    return url.toString();
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function shouldLog(current: LogLevel, incoming: LogLevel): boolean {
  const order: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
  };

  return order[incoming] >= order[current];
}
