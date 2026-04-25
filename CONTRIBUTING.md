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

## Pull Requests

- Keep changes focused.
- Update `README.md`, `.env.example`, and client examples when configuration changes.
- Run `npm run pack:dry-run` before opening a release-oriented change.
