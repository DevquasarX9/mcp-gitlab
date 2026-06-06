# 0.3.0 Release Checklist

## Required Checks

Run from the repository root:

```bash
npm run release:check
```

Expanded checks:

```bash
npm run typecheck
npm test
npm run docs:check-secrets
npm run build
npm run smoke:stdio
npm run smoke:http
npm run pack:dry-run
```

## Source Smoke Tests

The scripted source smokes initialize the MCP server, list tools, and assert that `gitlab_validate_token` is advertised. They use a placeholder `GITLAB_TOKEN` by default and do not call GitLab.

Stdio:

```bash
npm run build
npm run smoke:stdio
```

HTTP:

```bash
npm run build
npm run smoke:http
```

To run both after building:

```bash
npm run smoke:source
```

The HTTP smoke starts `node dist/cli.js serve-http` on a temporary localhost port, initializes through Streamable HTTP, then stops the process.

## Package Smoke Tests

Before publishing:

```bash
npm pack --dry-run
npm run smoke:package
```

After publishing:

```bash
npm view gitlab-mcp-cli version
PREFIX_DIR="$(mktemp -d)"
npm install --global --prefix "${PREFIX_DIR}" gitlab-mcp-cli@0.3.0
MCP_SMOKE_COMMAND="${PREFIX_DIR}/bin/gitlab-mcp-server" npm run smoke:stdio
MCP_SMOKE_COMMAND="${PREFIX_DIR}/bin/gitlab-mcp-server" npm run smoke:http
```

## Documentation Checks

- README includes stdio and HTTP setup.
- `examples/clients/` includes stdio and HTTP guidance.
- `SECURITY.md` documents prompt injection, token scopes, allowlists, and HTTP safety.
- `docs/parity.md` maps official GitLab MCP beta tools to this server.
- `npm run docs:check-secrets` confirms docs and client examples use placeholders, not live secrets.
- Changelog has a dated `0.3.0` section before tagging.

## Release Steps

1. Confirm `package.json` and `package-lock.json` are set to `0.3.0`.
2. Confirm `CHANGELOG.md` has a dated `0.3.0` section.
3. Commit the release changes.
4. Tag `v0.3.0`.
5. Push the branch and tag.
6. Publish a GitHub Release for the tag so trusted publishing can publish to npm.
