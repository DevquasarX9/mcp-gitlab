# Changelog

## 0.3.2

- Added GitLab Draft Notes tools for merge request review workflows, including create, update, delete, publish one, and bulk publish support behind the existing write gates.

## 0.3.0 - 2026-06-07

- Default MCP tool exposure now uses the `readonly` profile.
- Added server-side tool profile controls with explicit tool allow/deny lists.
- Disabled write and destructive tools are hidden from MCP tool discovery by default, with `GITLAB_MCP_EXPOSE_DISABLED_WRITES=true` available as a compatibility override.
- Added broad `gitlab_search` for global, project, or group scoped GitLab search with strict target validation.
- Added `gitlab_search_labels` for project and group label search.
- Added direct read-only `gitlab_get_merge_request_commits` and `gitlab_get_merge_request_pipelines` parity tools.
- Added opt-in Streamable HTTP transport via `serve-http`, `--http`, or `MCP_TRANSPORT=http`, with localhost defaults, host/origin checks, and bearer-token support.
- Added tool-profile, HTTP posture, payload-limit, and security warning details to token validation and doctor output.
- Expanded security guidance for MCP prompt injection, token scopes, write allowlists, and HTTP deployment.
- Added HTTP client setup guidance, an official GitLab MCP parity map, and a `0.3.0` release checklist.
- Added scripted source smoke checks for stdio and Streamable HTTP MCP initialization.
- Added a packed-package smoke check that installs the local tarball and initializes MCP over stdio and HTTP.
- Added an aggregate `npm run release:check` command for local release validation.
- Extended CI and publish validation to run documentation checks plus stdio/HTTP MCP smokes.
- Added a documentation secret scanner for release validation.
- Documented work item notes and semantic code search as deferred until stable implementation paths are confirmed.
- Added markdown output and clearer workflow metadata to group delivery overview and merge request review-state summaries.
- Added markdown output and clearer summary metadata to pipeline comparison and job-to-MR trace workflows.
- Updated workflow prompts with recommended tool profiles and structured-output guidance.
- Added README positioning for when to use this server versus official GitLab MCP or `glab mcp serve`.

## 0.2.3

- Published latest package release.
- Expanded workflow and delivery-oriented tool coverage.
- Added additional tests for prompts, dashboards, delivery summaries, review state, and output formatting.

## 0.1.0

- First public npm release candidate
- Stdio GitLab MCP server with read-only defaults and guarded write operations
- npm packaging cleanup for `dist/`-only publishing
- Basic client examples, CI validation, and maintainer publishing documentation
