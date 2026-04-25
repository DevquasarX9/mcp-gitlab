export class GitLabApiError extends Error {
  public readonly status: number;
  public readonly endpoint: string;
  public readonly requestId?: string;
  public readonly details?: unknown;
  public readonly retryAfterSeconds?: number;

  public constructor(params: {
    message: string;
    status: number;
    endpoint: string;
    requestId?: string;
    details?: unknown;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = "GitLabApiError";
    this.status = params.status;
    this.endpoint = params.endpoint;
    this.requestId = params.requestId;
    this.details = params.details;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }
}

export interface GitLabGraphQLErrorDetail {
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly extensions?: Record<string, unknown>;
}

export class GitLabGraphQLError extends Error {
  public readonly endpoint: string;
  public readonly requestId?: string;
  public readonly details: readonly GitLabGraphQLErrorDetail[];

  public constructor(params: {
    message: string;
    endpoint: string;
    requestId?: string;
    details: readonly GitLabGraphQLErrorDetail[];
  }) {
    super(params.message);
    this.name = "GitLabGraphQLError";
    this.endpoint = params.endpoint;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class GuardrailError extends Error {
  public readonly code: string;

  public constructor(message: string, code = "GUARDRAIL_VIOLATION") {
    super(message);
    this.name = "GuardrailError";
    this.code = code;
  }
}

export class ResponseTooLargeError extends Error {
  public readonly limitBytes: number;

  public constructor(message: string, limitBytes: number) {
    super(message);
    this.name = "ResponseTooLargeError";
    this.limitBytes = limitBytes;
  }
}

export function normalizeGitLabError(input: {
  status: number;
  endpoint: string;
  requestId?: string | null;
  retryAfterHeader?: string | null;
  body?: unknown;
}): GitLabApiError {
  const retryAfterSeconds = input.retryAfterHeader
    ? Number.parseInt(input.retryAfterHeader, 10)
    : undefined;

  return new GitLabApiError({
    message: buildErrorMessage(input.status, input.body),
    status: input.status,
    endpoint: input.endpoint,
    requestId: input.requestId ?? undefined,
    details: input.body,
    retryAfterSeconds:
      retryAfterSeconds && Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds
        : undefined
  });
}

export function normalizeGitLabGraphQLError(input: {
  endpoint: string;
  requestId?: string | null;
  errors: readonly GitLabGraphQLErrorDetail[];
}): GitLabGraphQLError {
  const summary = input.errors
    .map((item) => item.message.trim())
    .filter((item) => item.length > 0)
    .slice(0, 3)
    .join("; ");

  return new GitLabGraphQLError({
    message: summary.length > 0
      ? `GitLab GraphQL query failed: ${summary}`
      : "GitLab GraphQL query failed.",
    endpoint: input.endpoint,
    requestId: input.requestId ?? undefined,
    details: input.errors
  });
}

export function buildUserFacingError(error: unknown): string {
  if (error instanceof GuardrailError) {
    return error.message;
  }

  if (error instanceof ResponseTooLargeError) {
    return error.message;
  }

  if (error instanceof GitLabApiError) {
    const requestId = error.requestId ? ` Request ID: ${error.requestId}.` : "";
    const retryAfter = error.retryAfterSeconds
      ? ` Retry after ${error.retryAfterSeconds} seconds.`
      : "";
    return `${error.message}${requestId}${retryAfter}`;
  }

  if (error instanceof GitLabGraphQLError) {
    const requestId = error.requestId ? ` Request ID: ${error.requestId}.` : "";
    return `${error.message}${requestId}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred.";
}

function buildErrorMessage(status: number, body: unknown): string {
  const suffix = extractBodyMessage(body);

  switch (status) {
    case 400:
      return suffix ? `GitLab rejected the request: ${suffix}` : "GitLab rejected the request.";
    case 401:
      return suffix
        ? `GitLab authentication failed: ${suffix}`
        : "GitLab authentication failed. Verify the token and token header mode.";
    case 403:
      return suffix
        ? `GitLab denied access: ${suffix}`
        : "GitLab denied access to the requested resource.";
    case 404:
      return suffix
        ? `GitLab resource not found: ${suffix}`
        : "GitLab could not find the requested resource.";
    case 408:
      return "GitLab timed out while processing the request.";
    case 409:
      return suffix ? `GitLab reported a conflict: ${suffix}` : "GitLab reported a conflict.";
    case 422:
      return suffix ? `GitLab validation failed: ${suffix}` : "GitLab validation failed.";
    case 429:
      return suffix ? `GitLab rate limit exceeded: ${suffix}` : "GitLab rate limit exceeded.";
    default:
      return suffix
        ? `GitLab API error (${status}): ${suffix}`
        : `GitLab API error (${status}).`;
  }
}

function extractBodyMessage(body: unknown): string | undefined {
  if (typeof body === "string") {
    return body.trim() || undefined;
  }

  if (body && typeof body === "object") {
    const message = Reflect.get(body, "message");
    const error = Reflect.get(body, "error");

    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }

    if (Array.isArray(message)) {
      return message.map((item) => String(item)).join(", ");
    }

    if (message && typeof message === "object") {
      return JSON.stringify(message);
    }

    if (typeof error === "string" && error.trim().length > 0) {
      return error.trim();
    }
  }

  return undefined;
}
