# GitLab MCP Server

[![npm version](https://img.shields.io/npm/v/gitlab-mcp-cli)](https://www.npmjs.com/package/gitlab-mcp-cli)
[![npm downloads](https://img.shields.io/npm/dm/gitlab-mcp-cli)](https://www.npmjs.com/package/gitlab-mcp-cli)
[![CI](https://github.com/DevquasarX9/mcp-gitlab/actions/workflows/ci.yml/badge.svg)](https://github.com/DevquasarX9/mcp-gitlab/actions/workflows/ci.yml)

`gitlab-mcp-server` is a stdio [Model Context Protocol](https://modelcontextprotocol.io/) server for GitLab.com and self-managed GitLab.

It gives AI agents and developer tools structured access to GitLab projects, repositories, issues, merge requests, pipelines, releases, governance data, and higher-level delivery summaries. The server is read-only by default and uses explicit gates for write and destructive actions.

- npm package: [gitlab-mcp-cli](https://www.npmjs.com/package/gitlab-mcp-cli)
- Repository: [DevquasarX9/mcp-gitlab](https://github.com/DevquasarX9/mcp-gitlab)
- Works with: Claude Code, Claude Desktop, Codex, Cursor, and other MCP clients

## Why This Server

- Safe defaults: read-only mode is the default, with separate write and destructive-action gates.
- GitLab coverage: projects, groups, repositories, issues, merge requests, pipelines, releases, packages, approvals, and protected branches.
- AI-friendly tools: higher-level tools summarize project health, review risk, release notes, delivery status, and pipeline failures.
- Self-managed support: works with `https://gitlab.com` and private GitLab instances.
- Operational controls: allowlists, denylist, payload caps, timeout control, optional audit logging, and secret redaction.

## Install

Requirements:

- Node.js `>=20.11.0`
- A GitLab token with the scopes needed for the resources you want to access

Install globally:

```bash
npm install -g gitlab-mcp-cli
```

Run without a global install:

```bash
npx -y gitlab-mcp-cli
```

The published package name is `gitlab-mcp-cli`. The installed executable is `gitlab-mcp-server`.

## Quick Start

Run the server directly after setting the required environment variables:

```bash
GITLAB_BASE_URL=https://gitlab.com \
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx \
gitlab-mcp-server
```

From source:

```bash
npm ci
npm run build
GITLAB_BASE_URL=https://gitlab.com \
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx \
node dist/cli.js
```

For local development, copy `.env.example` to `.env` and keep credentials out of git.

## MCP Client Setup

Example client configs live in [`examples/clients/`](https://github.com/DevquasarX9/mcp-gitlab/tree/main/examples/clients):

- [Claude Code guide](https://github.com/DevquasarX9/mcp-gitlab/blob/main/examples/clients/claude_code.md)
- [Claude Desktop JSON config](https://github.com/DevquasarX9/mcp-gitlab/blob/main/examples/clients/claude_desktop_config.json)
- [Codex TOML config](https://github.com/DevquasarX9/mcp-gitlab/blob/main/examples/clients/codex-config.toml)
- [Cursor MCP JSON config](https://github.com/DevquasarX9/mcp-gitlab/blob/main/examples/clients/cursor.mcp.json)

### Generic stdio config

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "gitlab-mcp-server",
      "env": {
        "GITLAB_BASE_URL": "https://gitlab.com",
        "GITLAB_TOKEN": "your-token-here",
        "ENABLE_WRITE_TOOLS": "false",
        "ENABLE_DESTRUCTIVE_TOOLS": "false"
      }
    }
  }
}
```

### `npx` config

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "gitlab-mcp-cli"],
      "env": {
        "GITLAB_BASE_URL": "https://gitlab.com",
        "GITLAB_TOKEN": "your-token-here",
        "ENABLE_WRITE_TOOLS": "false",
        "ENABLE_DESTRUCTIVE_TOOLS": "false"
      }
    }
  }
}
```

### Codex TOML config

```toml
[mcp_servers.gitlab]
command = "gitlab-mcp-server"

[mcp_servers.gitlab.env]
GITLAB_BASE_URL = "https://gitlab.com"
GITLAB_TOKEN = "your-token-here"
ENABLE_WRITE_TOOLS = "false"
ENABLE_DESTRUCTIVE_TOOLS = "false"
```

## Configuration

The server normalizes `GITLAB_BASE_URL` to `/api/v4` automatically. If you already pass an `/api/v4` URL, it is preserved.

### Core settings

| Variable | Required | Default | Notes |
|---|---|---:|---|
| `GITLAB_BASE_URL` | No | `https://gitlab.com` | GitLab instance base URL or `/api/v4` URL |
| `GITLAB_TOKEN` | Yes |  | GitLab PAT, project access token, group access token, or OAuth bearer token |
| `GITLAB_TOKEN_HEADER_MODE` | No | `bearer` | Use `private-token` when required by some self-managed setups |
| `ENABLE_WRITE_TOOLS` | No | `false` | Enables write-capable tools |
| `ENABLE_DESTRUCTIVE_TOOLS` | No | `false` | Enables destructive tools that also require per-call confirmation |
| `ENABLE_DRY_RUN` | No | `false` | Returns intended write requests without mutating GitLab |

### Access controls and limits

| Variable | Default | Purpose |
|---|---:|---|
| `PROJECT_ALLOWLIST` | empty | Comma-separated project IDs or paths that are allowed |
| `GROUP_ALLOWLIST` | empty | Comma-separated group IDs or paths that are allowed |
| `PROJECT_DENYLIST` | empty | Comma-separated project IDs or paths that are always denied |
| `MAX_FILE_SIZE_BYTES` | `1048576` | Maximum repository file payload |
| `MAX_DIFF_SIZE_BYTES` | `2097152` | Maximum diff payload |
| `MAX_API_RESPONSE_BYTES` | `4194304` | Maximum total API response payload |
| `GITLAB_HTTP_TIMEOUT_MS` | `30000` | Request timeout |

### Operational settings

| Variable | Default | Purpose |
|---|---:|---|
| `GITLAB_USER_AGENT` | `gitlab-mcp-server` | Custom outbound user agent |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |
| `AUDIT_LOG_PATH` | unset | Optional JSON-line audit log path |
| `EXPOSE_SECRET_VARIABLE_VALUES` | `false` | Keeps CI/CD secret values redacted unless explicitly enabled |

See [`.env.example`](https://github.com/DevquasarX9/mcp-gitlab/blob/main/.env.example) for a complete local template.

## Token Setup

Recommended scopes:

- Read-only mode: `read_api`
- Write mode: `api`

Notes:

- Project and group access tokens work when their scopes match the requested resources.
- Some self-managed GitLab instances work better with `GITLAB_TOKEN_HEADER_MODE=private-token`.
- Keep write and destructive modes off unless you explicitly need them.

## Safety Model

- Read-only is the default and recommended starting point.
- Write-capable tools require `ENABLE_WRITE_TOOLS=true`.
- Destructive tools require `ENABLE_DESTRUCTIVE_TOOLS=true` and `confirm_destructive=true` in the tool call.
- `ENABLE_DRY_RUN=true` lets agents inspect a write request before changing GitLab.
- Allowlists and the denylist are enforced before risky operations.
- Secret CI/CD variable values remain redacted unless `EXPOSE_SECRET_VARIABLE_VALUES=true`.
- The server does not execute shell commands. It talks directly to the GitLab REST and GraphQL APIs.

Security details: [SECURITY.md](https://github.com/DevquasarX9/mcp-gitlab/blob/main/SECURITY.md) and [docs/security-model.md](https://github.com/DevquasarX9/mcp-gitlab/blob/main/docs/security-model.md)

## Available Tool Areas

The server exposes concrete `gitlab_*` MCP tools. Representative examples:

- Instance and access: `gitlab_validate_token`, `gitlab_get_current_user`, `gitlab_list_accessible_projects`
- Projects and groups: `gitlab_search_projects`, `gitlab_get_project_dashboard`, `gitlab_get_group_delivery_overview`
- Repository: `gitlab_get_file`, `gitlab_search_code`, `gitlab_compare_refs`, `gitlab_get_commit_diff`
- Issues: `gitlab_list_issues`, `gitlab_create_issue`, `gitlab_add_issue_comment`
- Merge requests: `gitlab_get_merge_request`, `gitlab_get_merge_request_review_state`, `gitlab_merge_merge_request`
- Pipelines: `gitlab_list_pipelines`, `gitlab_explain_failed_pipeline`, `gitlab_find_flaky_jobs`
- Releases and packages: `gitlab_list_releases`, `gitlab_create_release`, `gitlab_get_package`
- Governance: `gitlab_get_project_approval_rules`, `gitlab_check_project_write_risk`
- Intelligence: `gitlab_summarize_project_status`, `gitlab_review_merge_request_risks`, `gitlab_generate_release_notes`

Write-capable tools stay unavailable until you explicitly enable them.

For design notes and implementation details, see:

- [docs/tool-design.md](https://github.com/DevquasarX9/mcp-gitlab/blob/main/docs/tool-design.md)
- [docs/architecture.md](https://github.com/DevquasarX9/mcp-gitlab/blob/main/docs/architecture.md)

## Common AI Workflows

This server is useful when you want an agent to:

- inspect a GitLab repository without cloning it first
- review merge request diffs, discussions, approvals, and pipeline state together
- summarize recent team activity across issues, merge requests, and pipelines
- trace a failed job back to its pipeline, commit, and merge request context
- draft release notes from tags, compares, and recent delivery activity
- assess whether a project is safe for AI-assisted writes before enabling write mode

If you want agents and other developers to discover the right tools quickly, refer to the actual MCP tool names in prompts, examples, and client instructions.

## Troubleshooting

- `401 Unauthorized`: the token is invalid, expired, or using the wrong header mode.
- `403 Forbidden`: the token lacks access or the resource is outside the configured allowlists.
- `404 Not Found`: the resource is missing or hidden by GitLab permissions.
- `429 Too Many Requests`: the GitLab rate limit was hit.
- Large file or diff errors: raise payload limits only when you trust the workload.
- CLI not found from source: run `npm run build` and invoke `node dist/cli.js`.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run pack:dry-run
```

Supporting docs:

- [CONTRIBUTING.md](https://github.com/DevquasarX9/mcp-gitlab/blob/main/CONTRIBUTING.md)
- [CHANGELOG.md](https://github.com/DevquasarX9/mcp-gitlab/blob/main/CHANGELOG.md)
- [docs/](https://github.com/DevquasarX9/mcp-gitlab/tree/main/docs)

## Publishing

This repository uses npm trusted publishing from GitHub Actions through [`publish.yml`](https://github.com/DevquasarX9/mcp-gitlab/blob/main/.github/workflows/publish.yml).

Release flow:

1. Update `package.json` version.
2. Commit and push.
3. Create and push a matching tag such as `v<package-version>`.
4. Publish a GitHub Release for that tag.
5. GitHub Actions publishes the package to npm through OIDC.

Manual fallback:

```bash
npm login
npm whoami
npm run clean
npm run build
npm test
npm run pack:dry-run
npm publish --access public
```

No `NPM_TOKEN` secret is required for the default GitHub Actions release path.

## Published Package Contents

The npm tarball intentionally stays small and only publishes:

- `dist/`
- `README.md`
- `LICENSE`
- `package.json`
