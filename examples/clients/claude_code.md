# Claude Code Setup

Install globally:

```bash
npm install -g gitlab-mcp-cli
```

Or use `npx` if you do not want a global install:

```bash
claude mcp add gitlab -- npx -y gitlab-mcp-cli
```

If you installed globally, add the server directly:

```bash
claude mcp add gitlab -- gitlab-mcp-server
```

Set the required environment variables before launching Claude Code:

```bash
export GITLAB_BASE_URL="https://gitlab.com"
export GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"
export ENABLE_WRITE_TOOLS="false"
export ENABLE_DESTRUCTIVE_TOOLS="false"
```

Optional alias examples:

```bash
export PROJECT_ALIASES="platform-api=platform/backend-api"
export GROUP_ALIASES="platform=platform"
```

Recommended local preflight before launching Claude Code:

```bash
gitlab-mcp-server doctor
```

Recommended first check inside Claude Code:

```text
Use gitlab_validate_token and tell me whether the current setup is read-only or write-enabled.
```

Recommended first workflow prompts inside Claude Code:

```text
Use gitlab_summarize_project_status_workflow for project_id="platform-api".
```

```text
Use gitlab_explain_failed_pipeline_workflow for project_id="platform-api" and pipeline_id="12345".
```

If you want a chat-ready result from a supported higher-level tool, ask for `output_format="markdown"`.

Keep `ENABLE_WRITE_TOOLS` and `ENABLE_DESTRUCTIVE_TOOLS` disabled until you explicitly need them.
