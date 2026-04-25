# Phase 5: Implementation Plan

## 1. Project setup

- Tasks: initialize package, TypeScript config, dependencies, file layout
- Acceptance criteria: `npm run build` succeeds
- Test cases: typecheck/build
- Risks: SDK version drift
- Complexity: low

## 2. MCP server skeleton

- Tasks: stdio server entrypoint, tool registration pattern
- Acceptance criteria: server starts and registers tools
- Test cases: server creation smoke test later
- Risks: SDK API changes
- Complexity: low

## 3. GitLab client

- Tasks: base URL normalization, auth headers, JSON helpers, audit logging
- Acceptance criteria: client can perform authenticated requests and normalize failures
- Test cases: error normalization, response-size caps
- Risks: GitLab plan/version differences
- Complexity: medium

## 4. Authentication validation

- Tasks: current user/version/token validation tools
- Acceptance criteria: token validity and identity are inspectable
- Test cases: invalid token normalization
- Risks: PAT-only endpoints unavailable to project/group tokens
- Complexity: low

## 5. Read-only project/repository tools

- Tasks: projects, groups, repository tree/files/search/commits/branches/tags
- Acceptance criteria: high-value read workflows work without write enablement
- Test cases: path validation, pagination, size limits
- Risks: large repos and diff payloads
- Complexity: medium

## 6. Issues tools

- Tasks: list/get/search/create/update/comment/close
- Acceptance criteria: issue workflows work behind write flag for mutations
- Test cases: developer-access guard, dry-run behavior
- Risks: field drift across GitLab versions
- Complexity: medium

## 7. Merge request tools

- Tasks: list/get/changes/diffs/discussions/create/update/comment/approve/merge
- Acceptance criteria: review workflows work, merge is guarded
- Test cases: destructive confirmation, blocked MR status handling
- Risks: deprecated `/changes` endpoint
- Complexity: medium

## 8. CI/CD tools

- Tasks: pipelines, jobs, traces, retry/cancel/trigger, variables
- Acceptance criteria: pipeline failure triage works
- Test cases: secret-value redaction, destructive cancel gate
- Risks: trace sensitivity, rate limits
- Complexity: medium

## 9. Higher-level analysis tools

- Tasks: status summaries, stale/blocked MR detection, failed pipeline explanation, trace tools
- Acceptance criteria: tools provide workflow-level value, not just raw wrappers
- Test cases: deterministic heuristics for stale/block/risk detection
- Risks: heuristic false positives
- Complexity: medium

## 10. Write tools

- Tasks: enforce global write gate and dry-run support
- Acceptance criteria: writes blocked by default and previewable in dry-run
- Test cases: write-disabled errors
- Risks: inconsistent mutation permission semantics across endpoints
- Complexity: low

## 11. Safety controls

- Tasks: allowlists, denylist, size caps, timeout caps, redaction, audit log
- Acceptance criteria: risky requests blocked early
- Test cases: denylist, traversal rejection, destructive confirmation
- Risks: over-blocking valid workflows
- Complexity: medium

## 12. Testing

- Tasks: unit coverage for guardrails, pagination, errors, permission helpers
- Acceptance criteria: `npm test` passes
- Test cases: existing suite plus future client mocks
- Risks: no full integration coverage yet
- Complexity: low

## 13. Docker packaging

- Tasks: Dockerfile and docker-compose example
- Acceptance criteria: container builds and runs
- Test cases: `docker build`
- Risks: stdio container ergonomics differ by host client
- Complexity: low

## 14. Documentation

- Tasks: README, env example, client configs, design docs
- Acceptance criteria: user can install and configure without reading source
- Test cases: manual doc review
- Risks: docs drifting from code
- Complexity: medium

## 15. Example client configurations

- Tasks: Cursor, Claude Desktop, Claude Code, Codex examples
- Acceptance criteria: examples map cleanly to stdio launch
- Test cases: manual validation by client
- Risks: client config format changes over time
- Complexity: low
