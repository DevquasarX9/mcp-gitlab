# Contributing

## Development Setup

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## Expectations

- Keep read-only behavior as the default.
- Guard every write-capable tool with `ENABLE_WRITE_TOOLS`.
- Guard every destructive operation with `ENABLE_DESTRUCTIVE_TOOLS` and `confirm_destructive=true`.
- Add or update tests for config parsing, guardrails, error handling, or pagination when behavior changes.
- Avoid shell execution and prefer direct GitLab API integration.
- Keep `README.md`, `.env.example`, and `examples/clients/` aligned with the actual tool surface and configuration model.
- Favor discoverable documentation: use the real MCP tool names, clear GitLab terminology, and concise setup examples that work on both GitHub and npm.

## Pull Requests

- Keep changes focused.
- Update `README.md`, `.env.example`, and client examples when configuration changes.
- Update package metadata such as `description`, `keywords`, repository links, and release notes when they become stale or misleading.
- Run `npm run pack:dry-run` before opening a release-oriented change.
