# Phase 1: Research Report

## Executive summary

The current MCP specification is moving quickly. The current protocol version on the official MCP site is `2025-11-25`, but the official TypeScript SDK repository explicitly states that the `main` branch is the in-development v2 line and that v1.x remains the recommended production SDK until v2 stabilizes. For this implementation, the practical production choice is:

- Use the official TypeScript SDK.
- Use the stable `@modelcontextprotocol/sdk` v1.x package for a stdio-first server.
- Avoid depending on the pre-alpha split v2 server package for a production baseline.

GitLab now provides an official MCP server endpoint and documents an official tool set, but the current coverage is narrow compared with real GitLab DevOps workflows. The built-in tool set is useful for issues, merge requests, some pipeline operations, search, and work item notes, but it lacks broad repository browsing, richer project/group inventory, safe variable handling, explicit allowlists, read-only-by-default controls, and opinionated higher-level DevOps analysis tools. GitLab also documents that some MCP-related surfaces remain beta or experimental.

## Official MCP findings

- MCP is a JSON-RPC based protocol with capability negotiation, tools/resources/prompts, and transport-specific guidance.
- The current protocol version is `2025-11-25`.
- Standard transports are `stdio` and Streamable HTTP.
- The MCP spec explicitly warns that tools are powerful and must be treated cautiously, with user consent and clear understanding of tool behavior.
- The MCP security guidance covers prompt injection, confused deputy issues, token passthrough risks, SSRF, and session hijacking.

## GitLab official MCP findings

- GitLab documents a built-in MCP server at `https://<gitlab-instance>/api/v4/mcp`.
- GitLab documents official client setup for Cursor, Claude Code, Claude Desktop, Codex, Zed, Gemini, and others.
- GitLab documents the current server tool set, which focuses on:
  - version
  - issue create/get
  - merge request create/get/commits/diffs/pipelines
  - pipeline management
  - work item notes
  - search
  - semantic code search
- GitLab also documents that its `glab mcp` CLI surface is experimental and not ready for production use.

## Limitations of current public GitLab MCP options

### GitLab official server

Strengths:

- First-party integration with GitLab auth and GitLab-hosted MCP endpoint.
- Official client setup guidance.
- Good fit for Duo and GitLab-centric workflows.

Weaknesses:

- Limited tool coverage compared with full DevOps usage.
- Repository tooling is not broad enough for file-centric workflows.
- No strong opinionated security envelope for third-party agent usage.
- No project/group allowlist model documented for AI safety.
- No read-only-by-default server that the user directly controls.
- Some GitLab MCP surfaces remain beta/experimental.

### Open-source servers reviewed

Reviewed projects:

- `Adit-999/gitlab-mcp`
- `zereight/gitlab-mcp`
- `yoda-digital/mcp-gitlab-server`

Observed strengths:

- Broader API coverage than GitLab’s official server in some cases.
- Some support read-only modes, multiple transports, or dynamic GitLab URLs.
- Faster iteration than first-party tooling.

Observed gaps:

- Safety controls are inconsistent across projects.
- Documentation quality and operational hardening vary.
- Destructive/write gating is often lighter than production AI-tool expectations.
- Token handling and redaction posture is often not the primary design axis.
- Higher-level DevOps intelligence tools are usually shallow wrappers rather than opinionated workflow tools.

## GitLab API findings

### REST API

Strengths:

- Broad coverage for projects, groups, repository tree, repository files, branches, tags, commits, issues, notes, merge requests, discussions, pipelines, jobs, variables, releases, packages, and more.
- Better fit for direct MCP tool mapping because endpoints are explicit and stable.
- Easier error normalization and per-tool guardrails.

Weaknesses:

- Cross-resource workflows often require many calls.
- Some endpoints still use offset pagination only.
- Large responses need careful size and timeout control.

### GraphQL API

Strengths:

- Good for joining nested data in fewer requests.
- Useful for higher-level intelligence queries when REST fan-out would be expensive.

Weaknesses:

- Complexity limit and query-size limit.
- Mutation behavior still needs strong write safety.
- More query-shape design work than REST.

Decision:

- Build the MVP on REST first.
- Keep GraphQL as a second-phase optimization for high-fan-out intelligence tools.

## Authentication findings

GitLab documents these API auth modes as relevant here:

- Personal access tokens
- Project access tokens
- Group access tokens
- OAuth 2.0 tokens

Important details:

- GitLab REST auth docs state that PATs, project tokens, and group tokens can be sent via `PRIVATE-TOKEN` or OAuth-style `Authorization: Bearer`.
- GitLab GraphQL docs state `read_api` is sufficient for queries and `api` is required for mutations.
- Project and group access tokens are bot users scoped to their resource boundary.
- Fine-grained personal access tokens are documented as beta and introduced in GitLab `18.10`.
- GitLab documents optional DPoP support for PATs; if enabled on the user account, API requests need valid DPoP headers.

Recommendation:

- Support PATs, project access tokens, and group access tokens immediately.
- Keep OAuth support at the token-header level, but avoid shipping a bespoke OAuth flow in the first release.
- Treat fine-grained PATs as desirable but beta-dependent.

## Rate limits, pagination, and common errors

### Pagination

- GitLab REST supports offset pagination broadly.
- GitLab progressively adds keyset pagination for selected resources.
- GitLab docs warn that some pagination headers may be missing on GitLab.com.
- Large result sets above 10,000 records may not include total-count headers.

### Rate limits

- GitLab.com documents `429` for rate-limited requests.
- GitLab.com documents API-specific limits, including project list, group list, group projects, single project, single group, and repository files.
- GitLab GraphQL documents page-size, complexity, query-size, and timeout limits.

### Common errors to normalize

- `401` invalid token / auth failure
- `403` permission denied
- `404` not found or private-resource hiding
- `409` state conflict or SHA mismatch
- `422` validation errors
- `429` rate limit hit
- `408` timeout

## Security risks specific to MCP for GitLab

- Prompt injection from repository files, issue text, MR descriptions, job logs, and comments
- Token leakage in logs or tool responses
- Destructive writes from model mis-selection
- Secret exposure from CI/CD variables and job traces
- Path traversal or malformed repository path input
- Unsafe command execution if the server shells out
- Over-broad access across projects/groups
- Session and auth misuse in HTTP-based MCP deployments

## Recommended architecture

- TypeScript
- Official MCP TypeScript SDK
- stdio-first transport for production baseline
- REST-first GitLab client
- Zod input validation
- Read-only default
- Explicit feature flags for write and destructive operations
- Project/group allowlist support
- Response/file/diff size caps
- Timeout caps
- Audit logging with secret redaction
- Dry-run support for write tools

## Recommended stack

- Node.js 20+
- TypeScript
- `@modelcontextprotocol/sdk` v1.x
- `zod`
- `undici`
- `dotenv`
- `vitest`
- Docker

## MVP scope

- Auth and instance identity tools
- Project and group inventory
- Repository tree/files/commits/branches/tags/search
- Issues tools
- Merge request tools
- Pipelines/jobs/variables
- Safe higher-level intelligence tools
- Read-only default
- Write tools behind `ENABLE_WRITE_TOOLS`
- Destructive tools behind `ENABLE_DESTRUCTIVE_TOOLS`

## Advanced scope

- Streamable HTTP transport after the official stable SDK path is mature enough
- GraphQL-backed aggregation for high-fan-out intelligence tools
- OAuth authorization flow support
- Caching and ETag support
- Approval-state and policy-aware MR analysis
- Project-level semantic/code graph search
- Optional remote deployment profile

## Sources

- [Model Context Protocol specification versioning](https://modelcontextprotocol.io/specification/versioning)
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [Model Context Protocol transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Model Context Protocol security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [Official MCP TypeScript SDK repository](https://github.com/modelcontextprotocol/typescript-sdk)
- [GitLab MCP server docs](https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/)
- [GitLab MCP server tools](https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server_tools/)
- [glab mcp docs](https://docs.gitlab.com/cli/mcp/)
- [GitLab REST authentication](https://docs.gitlab.com/api/rest/authentication/)
- [GitLab GraphQL API](https://docs.gitlab.com/api/graphql/)
- [GitLab token overview](https://docs.gitlab.com/security/tokens/)
- [Fine-grained PATs](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens/)
- [GitLab REST API pagination](https://docs.gitlab.com/api/rest/)
- [GitLab.com rate limits](https://docs.gitlab.com/user/gitlab_com/)
- [GitLab Search API](https://docs.gitlab.com/api/search/)
- [GitLab Projects API](https://docs.gitlab.com/api/projects/)
- [GitLab Repository Files API](https://docs.gitlab.com/api/repository_files/)
- [GitLab Merge Requests API](https://docs.gitlab.com/api/merge_requests/)
- [GitLab Discussions API](https://docs.gitlab.com/api/discussions/)
- [GitLab Issues API](https://docs.gitlab.com/api/issues/)
- [GitLab Notes API](https://docs.gitlab.com/api/notes/)
- [GitLab Jobs API](https://docs.gitlab.com/api/jobs/)
- [GitLab Project variables API](https://docs.gitlab.com/api/project_level_variables/)
- [Adit-999/gitlab-mcp](https://github.com/Adit-999/gitlab-mcp)
- [zereight/gitlab-mcp](https://github.com/zereight/gitlab-mcp)
- [yoda-digital/mcp-gitlab-server](https://github.com/yoda-digital/mcp-gitlab-server)
