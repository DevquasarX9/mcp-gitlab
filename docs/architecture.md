# Phase 3: Architecture

## Chosen approach

- Language: TypeScript
- Runtime: Node.js
- MCP SDK: official stable `@modelcontextprotocol/sdk` v1.x
- Transport in this implementation: stdio
- HTTP client: `undici`
- Validation: `zod`
- Tests: `vitest`

## Project structure

```text
src/
  config.ts
  index.ts
  gitlab/
    client.ts
    graphqlClient.ts
    errors.ts
    pagination.ts
    types.ts
  security/
    guards.ts
    redaction.ts
  tools/
    shared.ts
    instance.ts
    projects.ts
    repository.ts
    issues.ts
    mergeRequests.ts
    pipelines.ts
    projectDashboard.ts
    reviewState.ts
    releases.ts
    groups.ts
    groupDeliveryOverview.ts
    intelligence.ts
    deliveryShared.ts
  utils/
    result.ts
tests/
examples/clients/
docs/
```

## Configuration model

Environment-driven, with safe defaults:

- `GITLAB_BASE_URL`
- `GITLAB_TOKEN`
- `GITLAB_TOKEN_HEADER_MODE`
- `ENABLE_WRITE_TOOLS`
- `ENABLE_DESTRUCTIVE_TOOLS`
- `ENABLE_DRY_RUN`
- `PROJECT_ALLOWLIST`
- `GROUP_ALLOWLIST`
- `PROJECT_DENYLIST`
- `MAX_FILE_SIZE_BYTES`
- `MAX_DIFF_SIZE_BYTES`
- `MAX_API_RESPONSE_BYTES`
- `GITLAB_HTTP_TIMEOUT_MS`
- `LOG_LEVEL`
- `AUDIT_LOG_PATH`
- `EXPOSE_SECRET_VARIABLE_VALUES`

## Base URL handling

- Input accepts GitLab.com or self-managed instance URL.
- The loader normalizes plain instance URLs to `/api/v4`.
- If the caller already provides `/api/v4`, it is preserved.

## Token handling

- Tokens are injected only through environment variables.
- The server never echoes the configured token back in responses.
- Audit output is redacted.
- PAT/project/group token support is immediate.
- OAuth bearer-token mode is supported by header strategy without implementing a local OAuth flow.

## HTTP client design

- `GitLabClient` for REST endpoints and `GitLabGraphQLClient` for aggregate queries
- JSON request helpers for `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`
- GraphQL `query()` helper with the same auth, timeout, and payload limits
- Timeout via `AbortSignal.timeout`
- Response-size cap enforced before/after body read
- Audit helper on the REST client for consistent logging

## Pagination abstraction

- Parse `x-page`, `x-next-page`, `x-total`, `x-total-pages`
- Parse `Link` header for next-link traversal
- Preserve partial pagination metadata because GitLab.com may omit some headers

## Rate-limit handling

- Normalize `429`
- Surface `Retry-After` when present
- Keep request fan-out modest in higher-level tools
- Avoid hidden background retries in the server core

## Error normalization

- Map REST/GraphQL style failures into consistent user-facing errors
- Preserve GitLab request ID when present
- Keep detailed raw error payloads off user-facing output unless safe
- The first GraphQL-backed aggregate tool is `gitlab_get_merge_request_review_state`

## Logging and audit

- JSON-line audit entries
- Optional audit log file path
- Secret redaction before write
- Log write/destructive attempts distinctly from normal reads

## Caching

Current release:

- No persistent cache
- Prefer correctness and explicitness over stale responses

Planned later:

- Optional in-memory TTL cache for read-heavy metadata
- Optional ETag/conditional request support

## Testing strategy

- Unit tests first for guardrails and parsing
- Add integration tests later with mocked GitLab HTTP responses
- Keep intelligence tools deterministic and API-driven, not prompt-driven

## Docker support

- Two-stage Docker build
- Production image installs only runtime dependencies
- Container entrypoint runs stdio server

## CI/CD pipeline recommendation

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. Build/publish Docker image

## Release strategy

- Start at `0.x`
- Treat new write/destructive tools as minor releases with explicit changelog notes
- Keep default behavior conservative; require opt-in for anything risky
