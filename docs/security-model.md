# Phase 4: Security Model

## Threat model

Threats considered:

- Prompt injection through repository text, issues, merge requests, comments, and job logs
- Accidental destructive actions by the model
- Token leakage in logs or responses
- Cross-project access beyond intended scope
- Unsafe repository-path input
- Oversized files/diffs/logs
- Hidden shell execution or command injection

## Security posture

- Read-only by default
- `readonly` tool profile is the default MCP discovery surface
- Disabled write and destructive tools are hidden from tool discovery by default
- Write tools disabled unless `ENABLE_WRITE_TOOLS=true`
- Destructive tools disabled unless `ENABLE_DESTRUCTIVE_TOOLS=true`
- Destructive operations require `confirm_destructive=true`
- Project/group allowlists supported
- Project denylist supported
- File/diff/response size limits enforced
- Timeout limits enforced
- HTTP transport is localhost-only by default, with host/origin checks and optional bearer auth
- Audit logging enabled when configured
- Secret redaction applied to audit output
- No shell execution anywhere in the implementation

## Prompt injection mitigation

- Repository content, notes, job traces, and search results are treated as untrusted data
- Tools that return untrusted text mark it in the structured response
- The server does not interpret repository content as instructions
- High-level analysis is derived from GitLab metadata and heuristics, not from repository-authored prompts

## Token leakage prevention

- Tokens are environment-only
- Tokens are redacted before logging
- Secret CI/CD variable values are redacted by default in responses
- Job traces are returned only as bounded tail snippets, not full unbounded logs

## Permission validation

Write operations require:

1. Write mode enabled
2. Target project allowed by configuration
3. Minimum GitLab access level check in-server, matched to the operation
4. GitLab API permission check on execution

Write mode is only the MCP server-side feature gate. It does not expand the configured GitLab credential. If a write tool reaches GitLab and returns `insufficient_scope`, the MCP write guard has already passed and the token itself lacks the required GitLab scope, usually `api` for write-capable REST or GraphQL operations.

Comment-style write tools, including issue comments, merge request comments, merge request discussion replies, and draft notes, require Guest-level project access in-server. Internal issue and merge request notes require Reporter-level access. Other safe-write tools continue to require Developer-level access unless the tool documents a more specific GitLab permission.

When GitLab omits effective access from the project `permissions` payload, the server falls back to the authenticated user's effective project membership from the project members API before applying the local access guard. GitLab's API permission check still remains the final authority on execution.

Destructive operations require:

1. Destructive mode enabled
2. `confirm_destructive=true`
3. Target project allowed
4. Minimum GitLab access level check

## Branch protection awareness

The server does not bypass GitLab branch protection. Merge and pipeline operations still go through GitLab’s native authorization checks and project policy checks.

## Input validation

- Zod validates tool inputs
- Repository paths are normalized and traversal is rejected
- Refs must be non-empty and null-byte free
- Pagination bounds are capped

## Command execution avoidance

- No shelling out to `git`, `glab`, or system commands
- All GitLab interactions are over the GitLab HTTP API only

## HTTP transport safeguards

- Stdio remains the default transport.
- HTTP mode binds to `127.0.0.1` by default.
- The HTTP server validates allowed hostnames to reduce DNS rebinding risk.
- Missing origins are allowed for non-browser clients, localhost browser origins are allowed, and remote browser origins require explicit `MCP_HTTP_ALLOWED_ORIGINS` entries.
- `MCP_HTTP_AUTH_TOKEN` enables bearer-token protection for HTTP requests.
- Non-local binds are refused unless both `MCP_HTTP_ALLOW_NON_LOCALHOST=true` and `MCP_HTTP_AUTH_TOKEN` are configured.
- CLI mode takes precedence over `MCP_TRANSPORT`, so `doctor` cannot be accidentally hidden by an HTTP-only environment.

## Logging without secrets

- Structured audit events
- Secret redaction for token values and auth headers
- Sensitive variable values hidden by default

## Safe defaults

- Read-only mode
- Read-only tool profile
- Hidden disabled write/destructive tools unless compatibility exposure is explicitly enabled
- Localhost-only HTTP mode unless non-local binding is explicitly unlocked with bearer auth
- Dry-run available for write tools
- Redacted variable values
- Capped job-trace output
- Capped file/diff payloads

## Residual risks

- Job traces can still contain sensitive text not matching token-redaction patterns
- HTTP mode can expose the server to additional client/network surfaces if non-local binding is enabled
- GitLab API behavior varies slightly across versions and plan tiers
- Some GitLab endpoints are deprecated and may need version-sensitive handling later
