# GitLab MCP Parity Map

This server is not trying to mirror every official GitLab MCP beta tool one-for-one. The `0.3.0` direction is to cover stable low-level gaps while keeping this package differentiated around local/self-managed safety and higher-level workflow intelligence.

| Official GitLab MCP tool | This server equivalent | Status |
|---|---|---|
| `get_mcp_server_version` | `gitlab_get_version`, `gitlab_validate_token` | Implemented equivalent |
| `create_issue` | `gitlab_create_issue` | Implemented, write-gated |
| `get_issue` | `gitlab_get_issue` | Implemented |
| `create_merge_request` | `gitlab_create_merge_request` | Implemented, write-gated |
| `get_merge_request` | `gitlab_get_merge_request` | Implemented |
| `get_merge_request_commits` | `gitlab_get_merge_request_commits`, MR review/risk workflow tools | Implemented |
| `get_merge_request_diffs` | `gitlab_get_merge_request_diff` | Implemented |
| `get_merge_request_pipelines` | `gitlab_get_merge_request_pipelines`, `gitlab_trace_merge_request_to_pipeline_failures`, MR review/risk workflow tools | Implemented, with richer workflow equivalents |
| GitLab Draft Notes API | `gitlab_list_draft_notes`, `gitlab_get_draft_note`, `gitlab_create_draft_note`, `gitlab_update_draft_note`, `gitlab_delete_draft_note`, `gitlab_publish_draft_note`, `gitlab_bulk_publish_draft_notes` | Implemented; write operations are write-gated |
| `get_pipeline_jobs` | `gitlab_list_pipeline_jobs` | Implemented |
| `get_job_log` | `gitlab_get_job_trace`, `gitlab_explain_failed_pipeline` | Implemented with bounded trace output |
| `manage_pipeline` | `gitlab_list_pipelines`, `gitlab_retry_job`, `gitlab_trigger_pipeline`, `gitlab_cancel_pipeline` | Partial; delete/update pipeline operations are not exposed |
| `search` | `gitlab_search` | Implemented in `0.3.0` work |
| `search_labels` | `gitlab_search_labels` | Implemented in `0.3.0` work |
| `get_workitem_notes` | Planned GraphQL/Notes API follow-up | Deferred; the stable REST Notes/Discussions APIs do not document generic work item endpoints, and GraphQL work item entry points are still marked experimental |
| `create_workitem_note` | Planned GraphQL/Notes API follow-up | Deferred; GraphQL `createNote` is generic, but this package should not rely on experimental work item lookup shapes for write tools without version checks and dry-run design |
| `semantic_code_search` | None | Deferred unless a documented, stable-enough API path is confirmed |

## Richer Local Equivalents

This server also includes workflow tools that go beyond the official beta tool list:

- `gitlab_review_merge_request_risks`
- `gitlab_get_merge_request_review_state`
- `gitlab_explain_failed_pipeline`
- `gitlab_flaky_ci_triage`
- `gitlab_release_readiness_check`
- `gitlab_team_delivery_digest`
- `gitlab_portfolio_delivery_overview`
- `gitlab_summarize_commit_range`
- `gitlab_summarize_directory`

## Deferred Items

Work item notes are useful, and GitLab's official MCP tool docs now describe the user-facing inputs. This package should still avoid guessing at a GraphQL or REST implementation until the direct public API path is validated against target GitLab versions. Current docs show stable REST Notes/Discussions coverage for issues, merge requests, epics, snippets, and commits, while GraphQL work item lookup fields are marked experimental. Semantic code search remains beta and setup-dependent; it should not be approximated with keyword search under the same name. `gitlab_search` with `scope="blobs"` and `gitlab_search_code` remain keyword/search-backend tools.

Reference docs:

- https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server_tools/
- https://docs.gitlab.com/api/merge_requests/
- https://docs.gitlab.com/api/draft_notes/
- https://docs.gitlab.com/api/search/
- https://docs.gitlab.com/api/labels/
- https://docs.gitlab.com/api/notes/
- https://docs.gitlab.com/api/discussions/
- https://docs.gitlab.com/api/graphql/
- https://docs.gitlab.com/user/gitlab_duo/semantic_code_search/
