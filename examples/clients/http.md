# HTTP Transport Client Setup

Stdio remains the default and simplest setup for most local clients. Use HTTP when a client expects a URL-based MCP server or when you want one local server process shared by multiple tools.

## Start The Local HTTP Server

```bash
GITLAB_BASE_URL=https://gitlab.com \
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx \
gitlab-mcp-server serve-http
```

Default endpoint:

```text
http://127.0.0.1:3333/mcp
```

For a bearer-protected local endpoint:

```bash
GITLAB_BASE_URL=https://gitlab.com \
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx \
MCP_HTTP_AUTH_TOKEN=replace-with-a-local-secret \
gitlab-mcp-server serve-http
```

Keep `MCP_HTTP_HOST=127.0.0.1` unless you have a reviewed private-network deployment. Non-local binds require both `MCP_HTTP_ALLOW_NON_LOCALHOST=true` and `MCP_HTTP_AUTH_TOKEN`.

## Claude Code

```bash
claude mcp add --transport http gitlab http://127.0.0.1:3333/mcp
```

With HTTP bearer auth:

```bash
claude mcp add --transport http gitlab http://127.0.0.1:3333/mcp \
  --header "Authorization: Bearer replace-with-a-local-secret"
```

## VS Code / Copilot

Example `.vscode/mcp.json`:

```json
{
  "servers": {
    "gitlab": {
      "type": "http",
      "url": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

With HTTP bearer auth:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "gitlab-mcp-http-token",
      "description": "GitLab MCP HTTP bearer token",
      "password": true
    }
  ],
  "servers": {
    "gitlab": {
      "type": "http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer ${input:gitlab-mcp-http-token}"
      }
    }
  }
}
```

## Cursor

Use Cursor's MCP settings to add a URL-based Streamable HTTP server and set the URL to:

```text
http://127.0.0.1:3333/mcp
```

If your Cursor version accepts raw MCP JSON for HTTP servers, use the same URL and set the transport/type to its Streamable HTTP option. Cursor versions have used slightly different labels for URL-based MCP entries, so prefer the UI when possible.

## OpenAI Agents SDK

```ts
import { Agent, MCPServerStreamableHttp, run } from "@openai/agents";

const gitlabMcp = new MCPServerStreamableHttp({
  name: "gitlab",
  url: "http://127.0.0.1:3333/mcp"
});

const agent = new Agent({
  name: "GitLab assistant",
  instructions: "Use GitLab MCP tools for read-only repository and delivery analysis.",
  mcpServers: [gitlabMcp]
});

await run(agent, "Use gitlab_validate_token and summarize the advisory.");
```

With HTTP bearer auth:

```ts
const gitlabMcp = new MCPServerStreamableHttp({
  name: "gitlab",
  url: "http://127.0.0.1:3333/mcp",
  requestInit: {
    headers: {
      Authorization: `Bearer ${process.env.MCP_HTTP_AUTH_TOKEN ?? ""}`
    }
  }
});
```

## Preflight

Before connecting a client, run:

```bash
gitlab-mcp-server doctor
```

Then start HTTP and make a first client request:

```text
Use gitlab_validate_token and explain the advisory warnings and recommended next checks.
```

Reference docs:

- https://code.visualstudio.com/docs/agent-customization/mcp-servers
- https://code.claude.com/docs/en/mcp
- https://openai.github.io/openai-agents-js/guides/mcp/
- https://docs.cursor.com/context/model-context-protocol
