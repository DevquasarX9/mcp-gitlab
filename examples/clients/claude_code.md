Install the package first:

```bash
npm install -g gitlab-mcp-cli
```

Add the server:

```bash
claude mcp add gitlab -- gitlab-mcp-server
```

Environment variables:

```bash
export GITLAB_BASE_URL="https://gitlab.com"
export GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"
export ENABLE_WRITE_TOOLS="false"
export ENABLE_DESTRUCTIVE_TOOLS="false"
```
