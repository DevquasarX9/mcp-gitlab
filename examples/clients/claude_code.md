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

Recommended first check inside Claude Code:

```text
Use gitlab_validate_token and tell me whether the current setup is read-only or write-enabled.
```

Keep `ENABLE_WRITE_TOOLS` and `ENABLE_DESTRUCTIVE_TOOLS` disabled until you explicitly need them.
