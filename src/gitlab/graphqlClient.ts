import { fetch, Headers } from "undici";

import type { AppConfig } from "../config.js";
import { redactSecrets, redactValue } from "../security/redaction.js";
import {
  ResponseTooLargeError,
  normalizeGitLabError,
  normalizeGitLabGraphQLError,
  type GitLabGraphQLErrorDetail
} from "./errors.js";
import type { JsonMap } from "./types.js";

interface GraphQLResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly GitLabGraphQLErrorDetail[];
}

export class GitLabGraphQLClient {
  public constructor(private readonly config: AppConfig) {}

  public async query<TData>(
    query: string,
    variables?: JsonMap
  ): Promise<TData> {
    const endpoint = deriveGitLabGraphqlUrl(this.config.gitlabBaseUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(this.config),
      body: JSON.stringify({
        query,
        variables
      }),
      signal: AbortSignal.timeout(this.config.httpTimeoutMs)
    });

    if (!response.ok) {
      const errorBody = await this.tryReadErrorBody(response);
      throw normalizeGitLabError({
        status: response.status,
        endpoint,
        requestId: response.headers.get("x-request-id"),
        retryAfterHeader: response.headers.get("retry-after"),
        body: errorBody
      });
    }

    const buffer = await this.readBody(response);
    const payload = JSON.parse(buffer.toString("utf8")) as GraphQLResponse<TData>;

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw normalizeGitLabGraphQLError({
        endpoint,
        requestId: response.headers.get("x-request-id"),
        errors: redactValue(payload.errors, [this.config.gitlabToken]) as readonly GitLabGraphQLErrorDetail[]
      });
    }

    if (payload.data === undefined) {
      throw new Error("GitLab GraphQL response did not include data.");
    }

    return payload.data;
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

export function deriveGitLabGraphqlUrl(baseUrl: string): string {
  return baseUrl.replace(/\/api\/v4$/, "/api/graphql");
}

function buildHeaders(config: AppConfig): Headers {
  const headers = new Headers();
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");
  headers.set("user-agent", config.gitlabUserAgent);

  if (config.tokenHeaderMode === "private-token") {
    headers.set("private-token", config.gitlabToken);
  } else {
    headers.set("authorization", `Bearer ${config.gitlabToken}`);
  }

  return headers;
}
