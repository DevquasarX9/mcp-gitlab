# Client Setup

Use the raw config examples in this folder as the source of truth for MCP wiring:

- [Claude Desktop JSON](./claude_desktop_config.json)
- [Codex TOML](./codex-config.toml)
- [Cursor JSON](./cursor.mcp.json)
- [HTTP transport guide](./http.md)

For Claude Code, use the dedicated guide:

- [Claude Code guide](./claude_code.md)

## Shared Preflight

Before wiring the server into any client, run:

```bash
gitlab-mcp-server doctor
```

That report confirms:

- authenticated user and GitLab version
- read-only, write-enabled, or destructive-enabled posture
- token scope visibility when PAT introspection is available
- allowlists, denylist, and alias counts
- HTTP bind posture and payload limits
- likely blocked capabilities and recommended next checks

Important write-mode distinction:

- `ENABLE_WRITE_TOOLS=true` only opens the MCP server's write-tool guard.
- Normal GitLab writes still require a write-capable GitLab token and project permission.
- If write tools return `insufficient_scope`, tell the user the MCP write guard is no longer blocking them; the configured GitLab credential is missing the required scope, usually `api`.

Optional aliases for any client:

```bash
PROJECT_ALIASES=platform-api=platform/backend-api
GROUP_ALIASES=platform=platform
```

## Claude Desktop

Use [claude_desktop_config.json](./claude_desktop_config.json).

Good first requests:

```text
Use gitlab_validate_token and tell me whether the setup is read-only, write-enabled, or destructive-enabled.
```

```text
Use gitlab_team_delivery_digest_workflow for scope_type="project" and scope_id="platform-api".
```

## Codex

Use [codex-config.toml](./codex-config.toml).

Good first requests:

```text
Use gitlab_validate_token and summarize the advisory section.
```

```text
Use gitlab_summarize_project_status_workflow for project_id="platform-api".
```

```text
Use gitlab_review_merge_request_workflow for project_id="platform-api" and merge_request_iid="42".
```

## Cursor

Use [cursor.mcp.json](./cursor.mcp.json).

Good first requests:

```text
Use gitlab_validate_token and explain the advisory warnings and next checks.
```

```text
Use gitlab_explain_failed_pipeline_workflow for project_id="platform-api" and pipeline_id="12345".
```

```text
Use gitlab_flaky_ci_triage_workflow for project_id="platform-api" and ref="main".
```

## HTTP Clients

Use [http.md](./http.md) for clients that connect to a Streamable HTTP MCP URL, including VS Code, Claude Code HTTP mode, Cursor URL-based setup, and OpenAI Agents SDK integrations.

## Shareable Results

For chat-ready output from supported higher-level tools, ask for `output_format="markdown"`.

Keep `ENABLE_WRITE_TOOLS` and `ENABLE_DESTRUCTIVE_TOOLS` disabled unless you explicitly need them.
