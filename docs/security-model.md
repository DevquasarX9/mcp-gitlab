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
- Write tools disabled unless `ENABLE_WRITE_TOOLS=true`
- Destructive tools disabled unless `ENABLE_DESTRUCTIVE_TOOLS=true`
- Destructive operations require `confirm_destructive=true`
- Project/group allowlists supported
- Project denylist supported
- File/diff/response size limits enforced
- Timeout limits enforced
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
3. Minimum GitLab access level check in-server
4. GitLab API permission check on execution

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

## Logging without secrets

- Structured audit events
- Secret redaction for token values and auth headers
- Sensitive variable values hidden by default

## Safe defaults

- Read-only mode
- Dry-run available for write tools
- Redacted variable values
- Capped job-trace output
- Capped file/diff payloads

## Residual risks

- Job traces can still contain sensitive text not matching token-redaction patterns
- GitLab API behavior varies slightly across versions and plan tiers
- Some GitLab endpoints are deprecated and may need version-sensitive handling later
