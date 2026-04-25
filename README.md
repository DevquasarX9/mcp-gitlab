# GitLab MCP Server

[![npm version](https://img.shields.io/npm/v/gitlab-mcp-cli)](https://www.npmjs.com/package/gitlab-mcp-cli)
[![npm downloads](https://img.shields.io/npm/dm/gitlab-mcp-cli)](https://www.npmjs.com/package/gitlab-mcp-cli)

`gitlab-mcp-server` is a stdio Model Context Protocol (MCP) server for GitLab.com and self-managed GitLab. It exposes repository, issue, merge request, pipeline, release, group, governance, and project tools with read-only defaults, guarded write operations, destructive-action confirmation, allowlists, payload limits, optional audit logging, and GraphQL-backed aggregate review and dashboard tools.

npm package: [gitlab-mcp-cli](https://www.npmjs.com/package/gitlab-mcp-cli)

## Installation

The default npm package name prepared in this repository is `gitlab-mcp-cli`. The installed command is `gitlab-mcp-server`.

```bash
npm install -g gitlab-mcp-cli
```

You can also run it without a global install:

```bash
npx -y gitlab-mcp-cli
```

If you publish under a scope later, replace `gitlab-mcp-cli` in the install and `npx` examples. The binary name can stay `gitlab-mcp-server`.

## Quick Start

Run the server after setting the required environment variables:

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

## Configuration

Copy `.env.example` to `.env` for local development. Never commit `.env`.

Core settings:

- `GITLAB_BASE_URL`: GitLab base URL such as `https://gitlab.com`. The server normalizes it to `/api/v4`.
- `GITLAB_TOKEN`: required GitLab PAT, project access token, group access token, or OAuth bearer token.
- `GITLAB_TOKEN_HEADER_MODE`: `bearer` or `private-token`.
- `ENABLE_WRITE_TOOLS`: defaults to `false`.
- `ENABLE_DESTRUCTIVE_TOOLS`: defaults to `false`.
- `ENABLE_DRY_RUN`: when `true`, guarded write tools return the intended request instead of mutating GitLab.

Operational settings:

- `PROJECT_ALLOWLIST`, `GROUP_ALLOWLIST`, `PROJECT_DENYLIST`
- `MAX_FILE_SIZE_BYTES`, `MAX_DIFF_SIZE_BYTES`, `MAX_API_RESPONSE_BYTES`
- `GITLAB_HTTP_TIMEOUT_MS`
- `GITLAB_USER_AGENT`
- `LOG_LEVEL`
- `AUDIT_LOG_PATH`
- `EXPOSE_SECRET_VARIABLE_VALUES`

## GitLab Token Setup

Recommended scopes:

- Read-only mode: `read_api`
- Write mode: `api`

Notes:

- Project and group access tokens also work when their scope matches the requested resources.
- Self-managed GitLab instances may require `GITLAB_TOKEN_HEADER_MODE=private-token`.
- Keep write and destructive modes disabled unless you explicitly need them.

## MCP Client Configuration

Global-install example:

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

`npx` example:

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

Basic Codex TOML example:

```toml
[mcp_servers.gitlab]
command = "gitlab-mcp-server"

[mcp_servers.gitlab.env]
GITLAB_BASE_URL = "https://gitlab.com"
GITLAB_TOKEN = "your-token-here"
ENABLE_WRITE_TOOLS = "false"
ENABLE_DESTRUCTIVE_TOOLS = "false"
```

## Read-Only And Write Modes

- Read-only is the default and is the recommended first setup for shared team use.
- Write tools require `ENABLE_WRITE_TOOLS=true`.
- Destructive tools require `ENABLE_DESTRUCTIVE_TOOLS=true` and `confirm_destructive=true` on the tool call.
- `ENABLE_DRY_RUN=true` is useful before enabling write mode broadly.

## Available Tools

The server currently includes these tool groups:

- Instance and auth: current user, token validation, GitLab version, accessible projects, accessible groups
- Projects and groups: search, metadata, members, languages, activity, statistics, GraphQL-backed project dashboard
- Repository: tree, file reads, blame, compare, commits, branches, tags, code search
- Issues: list, get, search, create, update, comment, close
- Merge requests: list, get, diffs, discussions, review-state aggregate, create/update, thread creation, thread replies, resolve/unresolve, review requests, approve, merge, rebase
- Pipelines: list, inspect, job traces, retry, cancel, trigger, project variables, failed-job summaries, flaky-job detection, run comparison, artifact metadata, job-to-MR tracing
- Releases and packages: list, inspect, create releases, inspect packages
- Governance: protected branches, branch protection details, approval rules, approval configuration, project write-risk analysis
- Intelligence: project summaries, stale MRs, blocked MRs, failed pipelines, release notes, recent activity, issue-to-MR and MR-to-pipeline tracing

Write-capable tools stay gated until you explicitly enable them.

## Security Notes

- Do not commit `.env`, tokens, or local MCP client configs with credentials.
- Prefer least-privilege tokens and allowlists for team deployments.
- Job traces, repository files, and issue content should be treated as untrusted input.
- Secret CI/CD variable values stay redacted unless `EXPOSE_SECRET_VARIABLE_VALUES=true`.
- The server does not execute shell commands; it talks directly to the GitLab API.

## Troubleshooting

- `401 Unauthorized`: token is invalid, expired, or using the wrong header mode.
- `403 Forbidden`: token lacks permission or the resource is outside allowlists.
- `404 Not Found`: the resource is missing or hidden by GitLab permissions.
- `429 Too Many Requests`: GitLab rate limit reached.
- Large file or diff errors: increase payload limits only when you trust the workload.
- CLI not found after source install: run `npm run build` and invoke `node dist/cli.js`.

## Development

```bash
npm ci
npm run lint
npm test
npm run build
npm run pack:dry-run
```

Repository docs and client examples live under `docs/` and `examples/clients/`.

## Manual Publishing Notes

Trusted publishing via GitHub Actions is the default release path for this repository. If you ever need a manual fallback:

1. Confirm the package name, repository metadata, and version in `package.json`.
2. Run `npm login` and `npm whoami`.
3. Run `npm run clean`, `npm run build`, `npm test`, and `npm run pack:dry-run`.
4. Publish with `npm publish` for an unscoped package or `npm publish --access public` for a public scoped package.

npm may prompt for an OTP if your account has 2FA enabled.

## Automated npm Publishing

This repository also includes [publish.yml](./.github/workflows/publish.yml) for npm trusted publishing from GitHub Actions.

The workflow:

- runs on GitHub Release `published`
- requires `id-token: write`
- uses Node.js 24 to satisfy npm trusted publishing runtime requirements
- verifies that the release tag matches `package.json` version
- verifies that `package.json.repository.url` matches the current GitHub repository
- runs install, typecheck, lint, test, build, and `npm pack --dry-run` before `npm publish`

Configure npm trusted publishing with:

- Organization or user: `DevquasarX9`
- Repository: `mcp-gitlab`
- Workflow filename: `publish.yml`
- Environment name: leave empty unless you later add a protected GitHub Environment to the workflow

Release flow:

1. Update `package.json` version.
2. Commit and push.
3. Create and push a matching tag like `v0.1.1`.
4. Publish a GitHub Release for that tag.
5. GitHub Actions publishes the package to npm through OIDC.

No `NPM_TOKEN` secret is required for publishing. Because this uses trusted publishing from GitHub Actions, npm will generate provenance automatically for a public package from a public repository.

## What Gets Published

The npm package is intentionally small. It only ships:

- `dist/`
- `README.md`
- `LICENSE`
- `package.json`

Source files, tests, docs, examples, local configs, and development artifacts stay out of the published tarball.

## Next Version TODO

- Better Codex MCP setup guidance
- `gitlab-mcp-server doctor`
- `gitlab-mcp-server init`
- `gitlab-mcp-server print-config`
- `gitlab-mcp-server validate-token`
- Optional setup wizard and config generator
