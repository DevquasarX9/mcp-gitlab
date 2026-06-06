# Security Policy

## Reporting A Vulnerability

Please do not open public issues for security vulnerabilities, leaked credentials, or private GitLab data exposure.

When reporting:

- Include the affected version.
- Describe the GitLab deployment type: GitLab.com or self-managed.
- Provide reproduction steps with sanitized data only.
- Rotate any exposed GitLab or npm tokens before reporting.

## Hard Requirements

- Never commit `.env` files or MCP client configs that contain live credentials.
- Treat repository files, job traces, and issue content as untrusted input.
- Keep write and destructive modes disabled unless explicitly required.
- Use `PROJECT_ALLOWLIST` or `GROUP_ALLOWLIST` before enabling write tools for agent workflows.
- Keep HTTP mode bound to localhost unless a reviewed deployment requires otherwise.
- Do not expose a non-local HTTP endpoint without `MCP_HTTP_AUTH_TOKEN` and strict host/origin allowlists.

## MCP Threat Model

This server returns GitLab repository content, issue text, merge request comments, job traces, and search results to MCP clients. Treat all of that text as untrusted data. It can contain prompt-injection attempts, misleading instructions, secrets pasted by users, or test output that looks like commands.

The server does not execute shell commands and does not treat GitLab-authored text as instructions. Clients and agents should still keep tool calls explicit, review write actions, and avoid copying untrusted text into privileged prompts without context.

## Token Guidance

- Read-only usage should prefer a token with `read_api`.
- Write-capable usage usually requires `api`.
- Project and group access tokens are acceptable when their resource scope matches the intended targets.
- Personal access token scope introspection may be unavailable for project, group, or OAuth tokens; verify those scopes directly in GitLab.
- Rotate any token that appears in logs, screenshots, client configs, prompts, or test fixtures.

## Safe Operating Modes

Recommended read-only setup:

```env
GITLAB_MCP_TOOL_PROFILE=readonly
ENABLE_WRITE_TOOLS=false
ENABLE_DESTRUCTIVE_TOOLS=false
```

Recommended dry-run write setup:

```env
GITLAB_MCP_TOOL_PROFILE=maintainer-write
ENABLE_WRITE_TOOLS=true
ENABLE_DRY_RUN=true
PROJECT_ALLOWLIST=group/project
```

Destructive mode should be temporary, narrowly allowlisted, and paired with per-call `confirm_destructive=true` review.

## HTTP Transport Notes

HTTP mode is intended for local or private deployments in `0.3.x`.

- Default bind: `127.0.0.1`.
- Default path: `/mcp`.
- Default allowed hosts: `localhost,127.0.0.1,[::1]`.
- Browser origins outside localhost require explicit `MCP_HTTP_ALLOWED_ORIGINS`.
- Non-local binds require both `MCP_HTTP_ALLOW_NON_LOCALHOST=true` and `MCP_HTTP_AUTH_TOKEN`.

Avoid this pattern:

```env
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_AUTH_TOKEN=
MCP_HTTP_ALLOW_NON_LOCALHOST=true
```

## Diagnostics

Run `gitlab-mcp-server doctor` before using a new token or HTTP deployment. The report summarizes token scope visibility, active tool profile, write/destructive gates, HTTP bind posture, response caps, allowlists, likely blocked capabilities, and recommended next checks.

## Supported Versions

Security fixes are expected on the latest published `0.x` release line.
