# Phase 2: Tool Design

## Common response contract

Every tool returns the same outer envelope:

```json
{
  "ok": true,
  "data": {},
  "warnings": []
}
```

On failure:

```json
{
  "ok": false,
  "error": "User-facing normalized error text",
  "warnings": []
}
```

Common error handling:

- `401`: invalid or expired token
- `403`: permission denied
- `404`: project/group/resource not found or private
- `409`: state conflict or SHA mismatch
- `422`: validation error
- `429`: rate limit hit
- `408`: GitLab timeout

Common edge handling:

- Project/group allowlists and denylist are enforced before risky work
- Repository paths are normalized and traversal is rejected
- File, diff, and total API response sizes are capped
- Repository content, comments, and job traces are treated as untrusted
- Secret variable values are redacted by default

## A. Instance / Auth

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_get_current_user` | Return authenticated user identity | none | current user object | valid token | `GET /user` | read-only | `gitlab_get_current_user {}` | fails on invalid token |
| `gitlab_validate_token` | Validate token and show server context | none | user, version, config flags, PAT self-details if available | valid token | `GET /user`, `GET /version`, optional `GET /personal_access_tokens/self` | read-only | `gitlab_validate_token {}` | PAT self endpoint may be unavailable to project/group tokens |
| `gitlab_get_version` | Return instance version metadata | none | version object | public or token | `GET /version` | read-only | `gitlab_get_version {}` | some self-managed proxies may restrict metadata |
| `gitlab_list_accessible_projects` | List visible projects for token | `membership`, `search`, `archived`, pagination | list of project objects | read access | `GET /projects` | read-only | `gitlab_list_accessible_projects {"membership":true}` | filtered by allowlists/denylist |
| `gitlab_list_accessible_groups` | List visible groups for token | `search`, `min_access_level`, pagination | list of group objects | read access | `GET /groups` | read-only | `gitlab_list_accessible_groups {}` | filtered by group allowlist |

## B. Projects

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_search_projects` | Search projects by name/path | `search`, pagination | list of projects | read access | `GET /projects?search=` | read-only | `gitlab_search_projects {"search":"platform"}` | GitLab search semantics vary by instance |
| `gitlab_get_project` | Get full project metadata | `project_id` | project object | project read access | `GET /projects/:id` | read-only | `gitlab_get_project {"project_id":"group/project"}` | allowlist enforced |
| `gitlab_get_project_members` | List effective project members | `project_id`, `query`, pagination | list of members | membership visibility | `GET /projects/:id/members/all` | read-only | `gitlab_get_project_members {"project_id":"group/project"}` | invited/private-group behavior follows GitLab rules |
| `gitlab_get_project_languages` | Show language breakdown | `project_id` | language percentage map | project read access | `GET /projects/:id/languages` | read-only | `gitlab_get_project_languages {"project_id":"group/project"}` | empty repo returns empty map |
| `gitlab_get_project_activity` | Show recent project events | `project_id`, filters, pagination | list of events | project read access | `GET /projects/:id/events` | read-only | `gitlab_get_project_activity {"project_id":"group/project","after":"2026-04-01T00:00:00Z"}` | event volume depends on project activity limits |
| `gitlab_get_project_statistics` | Show storage/repo stats | `project_id` | project statistics object | project read access | `GET /projects/:id/statistics` | read-only | `gitlab_get_project_statistics {"project_id":"group/project"}` | stats availability can vary by plan/version |

## C. Repository

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_list_repository_tree` | List files/directories | `project_id`, `path`, `ref`, pagination | list of tree entries | repo read access | `GET /projects/:id/repository/tree` | read-only | `gitlab_list_repository_tree {"project_id":"group/project","path":"src"}` | traversal rejected |
| `gitlab_get_file` | Read file metadata and decoded content | `project_id`, `file_path`, `ref` | file object + `decoded_content` | repo read access | `HEAD` + `GET /projects/:id/repository/files/:file_path` | read-only | `gitlab_get_file {"project_id":"group/project","file_path":"README.md"}` | file-size cap enforced, content untrusted |
| `gitlab_search_code` | Search code snippets | `project_id`, `search`, `search_type` | list of blob search hits | project search access | `GET /projects/:id/search?scope=blobs` | read-only | `gitlab_search_code {"project_id":"group/project","search":"auth middleware"}` | advanced/exact search depends on instance features |
| `gitlab_get_file_blame` | Show blame ranges for a file | `project_id`, `file_path`, `ref` | list of blame ranges | repo read access | `GET /projects/:id/repository/files/:file_path/blame` | read-only | `gitlab_get_file_blame {"project_id":"group/project","file_path":"src/index.ts"}` | content trimmed and untrusted |
| `gitlab_compare_refs` | Compare refs | `project_id`, `from`, `to` | compare object + diffs | repo read access | `GET /projects/:id/repository/compare` | read-only | `gitlab_compare_refs {"project_id":"group/project","from":"main","to":"release"}` | diff-size cap enforced; compare may overflow/time out |
| `gitlab_get_commits` | List commits | `project_id`, `ref_name`, `path`, pagination | list of commits | repo read access | `GET /projects/:id/repository/commits` | read-only | `gitlab_get_commits {"project_id":"group/project","ref_name":"main"}` | large histories should use pagination |
| `gitlab_get_commit` | Get commit details | `project_id`, `sha`, `stats` | commit object | repo read access | `GET /projects/:id/repository/commits/:sha` | read-only | `gitlab_get_commit {"project_id":"group/project","sha":"main"}` | SHA/ref mismatch yields 404 |
| `gitlab_get_commit_diff` | Get commit diff | `project_id`, `sha`, `unidiff` | list of diff entries | repo read access | `GET /projects/:id/repository/commits/:sha/diff` | read-only | `gitlab_get_commit_diff {"project_id":"group/project","sha":"abc123"}` | diff-size cap enforced |
| `gitlab_get_branch` | Get branch metadata | `project_id`, `branch` | branch object | repo read access | `GET /projects/:id/repository/branches/:branch` | read-only | `gitlab_get_branch {"project_id":"group/project","branch":"main"}` | protected-branch info depends on permissions |
| `gitlab_list_branches` | List branches | `project_id`, `search`, pagination | list of branches | repo read access | `GET /projects/:id/repository/branches` | read-only | `gitlab_list_branches {"project_id":"group/project"}` | pagination needed on large repos |
| `gitlab_list_tags` | List tags | `project_id`, `search`, pagination | list of tags | repo read access | `GET /projects/:id/repository/tags` | read-only | `gitlab_list_tags {"project_id":"group/project"}` | keyset not assumed |

## D. Issues

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_list_issues` | List project issues | `project_id`, filters, pagination | list of issues | project read access | `GET /projects/:id/issues` | read-only | `gitlab_list_issues {"project_id":"group/project","state":"opened"}` | GitLab supports many filters; wrapper exposes core ones |
| `gitlab_get_issue` | Get issue by IID | `project_id`, `issue_iid` | issue object | project read access | `GET /projects/:id/issues/:iid` | read-only | `gitlab_get_issue {"project_id":"group/project","issue_iid":42}` | private issues return 404 to unauthorized callers |
| `gitlab_search_issues` | Search project issues | `project_id`, `search`, `in` | list of issues | project read access | `GET /projects/:id/issues?search=` | read-only | `gitlab_search_issues {"project_id":"group/project","search":"flaky test"}` | search is substring/engine dependent |
| `gitlab_create_issue` | Create issue | `project_id`, `title`, optional metadata | created issue | Developer+ and write enabled | `POST /projects/:id/issues` | safe-write | `gitlab_create_issue {"project_id":"group/project","title":"Investigate flaky test"}` | dry-run supported |
| `gitlab_update_issue` | Update issue fields | `project_id`, `issue_iid`, fields | updated issue | Developer+ and write enabled | `PUT /projects/:id/issues/:iid` | safe-write | `gitlab_update_issue {"project_id":"group/project","issue_iid":42,"labels":["bug"]}` | validation errors normalize to 422 |
| `gitlab_add_issue_comment` | Add issue note | `project_id`, `issue_iid`, `body` | created note | Developer+ and write enabled | `POST /projects/:id/issues/:iid/notes` | safe-write | `gitlab_add_issue_comment {"project_id":"group/project","issue_iid":42,"body":"Needs reproduction details"}` | note rate limits apply |
| `gitlab_close_issue` | Close issue | `project_id`, `issue_iid` | updated issue | Developer+ and write enabled | `PUT /projects/:id/issues/:iid` with `state_event=close` | safe-write | `gitlab_close_issue {"project_id":"group/project","issue_iid":42}` | dry-run supported |

## E. Merge Requests

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_list_merge_requests` | List project MRs | `project_id`, filters, pagination | list of MRs | project read access | `GET /projects/:id/merge_requests` | read-only | `gitlab_list_merge_requests {"project_id":"group/project","state":"opened"}` | blocked status comes from `detailed_merge_status` |
| `gitlab_get_merge_request` | Get MR by IID | `project_id`, `merge_request_iid` | MR object | project read access | `GET /projects/:id/merge_requests/:iid` | read-only | `gitlab_get_merge_request {"project_id":"group/project","merge_request_iid":7}` | mergeability can be async |
| `gitlab_get_merge_request_changes` | Get MR changes | `project_id`, `merge_request_iid` | MR + `changes[]` | project read access | `GET /projects/:id/merge_requests/:iid/changes` | read-only | `gitlab_get_merge_request_changes {"project_id":"group/project","merge_request_iid":7}` | endpoint is deprecated by GitLab; kept for overflow metadata |
| `gitlab_get_merge_request_diff` | Get MR diffs | `project_id`, `merge_request_iid`, pagination | list of diff entries | project read access | `GET /projects/:id/merge_requests/:iid/diffs` | read-only | `gitlab_get_merge_request_diff {"project_id":"group/project","merge_request_iid":7}` | diff-size cap enforced |
| `gitlab_get_merge_request_discussions` | Get MR discussions | `project_id`, `merge_request_iid` | list of discussions | project read access | `GET /projects/:id/merge_requests/:iid/discussions` | read-only | `gitlab_get_merge_request_discussions {"project_id":"group/project","merge_request_iid":7}` | discussion notes are untrusted text |
| `gitlab_get_merge_request_review_state` | Aggregate MR review readiness, approvals, reviewers, discussions, and head pipeline state | `project_id`, `merge_request_iid`, sample limits | review-state summary | project read access | GitLab GraphQL `project { mergeRequest { ... } }` | read-only | `gitlab_get_merge_request_review_state {"project_id":"group/project","merge_request_iid":7}` | GraphQL aggregate query uses sampled discussions/reviewers for bounded output |
| `gitlab_create_merge_request_thread` | Create MR overview or diff thread | `project_id`, `merge_request_iid`, `body`, optional diff position | created discussion | Developer+ and write enabled | `POST /projects/:id/merge_requests/:iid/discussions` | safe-write | `gitlab_create_merge_request_thread {"project_id":"group/project","merge_request_iid":7,"body":"Please split this function","discussion_type":"overview"}` | diff threads require diff refs and valid line inputs |
| `gitlab_reply_to_discussion` | Reply to an MR discussion thread | `project_id`, `merge_request_iid`, `discussion_id`, `body` | created note | Developer+ and write enabled | `POST /projects/:id/merge_requests/:iid/discussions/:discussion_id/notes` | safe-write | `gitlab_reply_to_discussion {"project_id":"group/project","merge_request_iid":7,"discussion_id":"abc","body":"Addressed in the latest push"}` | discussion notes remain untrusted text |
| `gitlab_resolve_discussion` | Resolve an MR discussion | `project_id`, `merge_request_iid`, `discussion_id`, optional `note_id` | updated note | Developer+ and write enabled | `PUT /projects/:id/merge_requests/:iid/discussions/:discussion_id/notes/:note_id` | safe-write | `gitlab_resolve_discussion {"project_id":"group/project","merge_request_iid":7,"discussion_id":"abc"}` | auto-detects latest resolvable note when possible |
| `gitlab_unresolve_discussion` | Reopen a resolved MR discussion | `project_id`, `merge_request_iid`, `discussion_id`, optional `note_id` | updated note | Developer+ and write enabled | `PUT /projects/:id/merge_requests/:iid/discussions/:discussion_id/notes/:note_id` | safe-write | `gitlab_unresolve_discussion {"project_id":"group/project","merge_request_iid":7,"discussion_id":"abc"}` | errors when no resolvable note exists |
| `gitlab_create_merge_request` | Create MR | `project_id`, branches, title | created MR | Developer+ and write enabled | `POST /projects/:id/merge_requests` | safe-write | `gitlab_create_merge_request {"project_id":"group/project","title":"Fix auth bug","source_branch":"fix/auth","target_branch":"main"}` | dry-run supported |
| `gitlab_update_merge_request` | Update MR metadata | `project_id`, `merge_request_iid`, fields | updated MR | Developer+ and write enabled | `PUT /projects/:id/merge_requests/:iid` | safe-write | `gitlab_update_merge_request {"project_id":"group/project","merge_request_iid":7,"labels":["backend"]}` | state transitions use `state_event` |
| `gitlab_add_merge_request_comment` | Add MR note | `project_id`, `merge_request_iid`, `body` | created note | Developer+ and write enabled | `POST /projects/:id/merge_requests/:iid/notes` | safe-write | `gitlab_add_merge_request_comment {"project_id":"group/project","merge_request_iid":7,"body":"Please add a test"}` | overview note, not diff thread |
| `gitlab_request_merge_request_review` | Assign or extend MR reviewers | `project_id`, `merge_request_iid`, `reviewer_ids`, `replace_existing_reviewers` | updated MR | Developer+ and write enabled | `PUT /projects/:id/merge_requests/:iid` | safe-write | `gitlab_request_merge_request_review {"project_id":"group/project","merge_request_iid":7,"reviewer_ids":[12,18]}` | can preserve or replace current reviewers |
| `gitlab_approve_merge_request` | Approve MR | `project_id`, `merge_request_iid`, optional `sha` | approval state | eligible approver + write enabled | `POST /projects/:id/merge_requests/:iid/approve` | safe-write | `gitlab_approve_merge_request {"project_id":"group/project","merge_request_iid":7}` | SHA mismatch returns 409 |
| `gitlab_rebase_merge_request` | Queue an MR rebase | `project_id`, `merge_request_iid`, optional `skip_ci`, `confirm_destructive` | rebase enqueue result | Developer+ and write and destructive enabled | `PUT /projects/:id/merge_requests/:iid/rebase` | destructive | `gitlab_rebase_merge_request {"project_id":"group/project","merge_request_iid":7,"confirm_destructive":true}` | only valid for opened MRs and requires explicit confirmation |
| `gitlab_merge_merge_request` | Merge MR | `project_id`, `merge_request_iid`, `confirm_destructive` | merge result | merge permission + write and destructive enabled | `PUT /projects/:id/merge_requests/:iid/merge` | destructive | `gitlab_merge_merge_request {"project_id":"group/project","merge_request_iid":7,"confirm_destructive":true}` | blocked by merge checks, conflicts, approvals, or source SHA mismatch |

## F. CI/CD

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_list_pipelines` | List pipelines | `project_id`, filters, pagination | list of pipelines | project read access | `GET /projects/:id/pipelines` | read-only | `gitlab_list_pipelines {"project_id":"group/project","status":"failed"}` | GitLab may omit total headers |
| `gitlab_get_pipeline` | Get pipeline | `project_id`, `pipeline_id` | pipeline object | project read access | `GET /projects/:id/pipelines/:pipeline_id` | read-only | `gitlab_get_pipeline {"project_id":"group/project","pipeline_id":123}` | pipeline may be gone if retention expired |
| `gitlab_list_pipeline_jobs` | List pipeline jobs | `project_id`, `pipeline_id`, filters | list of jobs | project read access | `GET /projects/:id/pipelines/:pipeline_id/jobs` | read-only | `gitlab_list_pipeline_jobs {"project_id":"group/project","pipeline_id":123}` | retried jobs optional |
| `gitlab_get_job` | Get job | `project_id`, `job_id` | job object | project read access | `GET /projects/:id/jobs/:job_id` | read-only | `gitlab_get_job {"project_id":"group/project","job_id":999}` | job logs/artifacts may expire separately |
| `gitlab_get_job_trace` | Tail job trace | `project_id`, `job_id`, `tail_lines` | trace tail + metadata | project read access | `GET /projects/:id/jobs/:job_id/trace` | read-only | `gitlab_get_job_trace {"project_id":"group/project","job_id":999}` | trace is untrusted and trimmed |
| `gitlab_retry_job` | Retry job | `project_id`, `job_id` | retried job | Developer+ and write enabled | `POST /projects/:id/jobs/:job_id/retry` | safe-write | `gitlab_retry_job {"project_id":"group/project","job_id":999}` | retry not valid for all job states |
| `gitlab_cancel_pipeline` | Cancel pipeline | `project_id`, `pipeline_id`, `confirm_destructive` | canceled pipeline | Developer+ and destructive enabled | `POST /projects/:id/pipelines/:pipeline_id/cancel` | destructive | `gitlab_cancel_pipeline {"project_id":"group/project","pipeline_id":123,"confirm_destructive":true}` | no-op if already finished |
| `gitlab_trigger_pipeline` | Trigger pipeline | `project_id`, `ref`, optional vars | created pipeline | Developer+ and write enabled | `POST /projects/:id/pipeline` | safe-write | `gitlab_trigger_pipeline {"project_id":"group/project","ref":"main"}` | pipeline creation rate limits apply |
| `gitlab_list_project_variables` | List CI/CD variables | `project_id`, pagination | list of variables, values redacted by default | Maintainer+ | `GET /projects/:id/variables` | read-only | `gitlab_list_project_variables {"project_id":"group/project"}` | secret values hidden unless explicit server config enables them |
| `gitlab_get_pipeline_failed_jobs_summary` | Summarize failed jobs in a pipeline | `project_id`, `pipeline_id` | pipeline + failed-job summary | project read access | pipeline + jobs endpoints | read-only | `gitlab_get_pipeline_failed_jobs_summary {"project_id":"group/project","pipeline_id":123}` | job metadata is safe; traces are not fetched |
| `gitlab_find_flaky_jobs` | Detect likely flaky jobs across recent pipelines | `project_id`, `ref`, history limits | flaky-job list with transitions | project read access | recent pipelines + jobs | read-only | `gitlab_find_flaky_jobs {"project_id":"group/project","ref":"main"}` | heuristic based on outcome transitions, not a certainty |
| `gitlab_compare_pipeline_runs` | Compare jobs between two pipelines | `project_id`, `from_pipeline_id`, `to_pipeline_id` | added/removed/status/duration changes | project read access | pipeline + jobs endpoints | read-only | `gitlab_compare_pipeline_runs {"project_id":"group/project","from_pipeline_id":120,"to_pipeline_id":123}` | useful for regression spotting between runs |
| `gitlab_get_pipeline_artifacts` | List artifact metadata for pipeline jobs | `project_id`, `pipeline_id` | jobs with artifact metadata | project read access | pipeline jobs endpoint | read-only | `gitlab_get_pipeline_artifacts {"project_id":"group/project","pipeline_id":123}` | metadata-only, does not download large artifacts |
| `gitlab_trace_job_to_commit_and_merge_request` | Trace a job back to its commit and related MRs | `project_id`, `job_id` | job + commit + related MRs | project read access | jobs + commit-related MR endpoints | read-only | `gitlab_trace_job_to_commit_and_merge_request {"project_id":"group/project","job_id":999}` | related MR list may be empty on detached or branchless jobs |

## G. Releases / Packages

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_list_releases` | List releases | `project_id`, pagination | list of releases | project read access | `GET /projects/:id/releases` | read-only | `gitlab_list_releases {"project_id":"group/project"}` | release evidence/milestones not expanded by default |
| `gitlab_get_release` | Get release by tag | `project_id`, `tag_name` | release object | project read access | `GET /projects/:id/releases/:tag_name` | read-only | `gitlab_get_release {"project_id":"group/project","tag_name":"v1.2.0"}` | missing tag returns 404 |
| `gitlab_create_release` | Create release | `project_id`, `name`, `tag_name` | created release | Developer+ and write enabled | `POST /projects/:id/releases` | safe-write | `gitlab_create_release {"project_id":"group/project","name":"v1.2.0","tag_name":"v1.2.0"}` | dry-run supported |
| `gitlab_list_packages` | List project packages | `project_id`, filters, pagination | list of packages | project read access | `GET /projects/:id/packages` | read-only | `gitlab_list_packages {"project_id":"group/project","package_type":"npm"}` | package metadata varies by type |
| `gitlab_get_package` | Get package | `project_id`, `package_id` | package object | project read access | `GET /projects/:id/packages/:package_id` | read-only | `gitlab_get_package {"project_id":"group/project","package_id":321}` | package files not expanded by default |

## H. Groups

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_search_groups` | Search groups | `search`, pagination | list of groups | group read access | `GET /groups?search=` | read-only | `gitlab_search_groups {"search":"platform"}` | allowlist may still filter later operations |
| `gitlab_get_group` | Get group | `group_id` | group object | group read access | `GET /groups/:id` | read-only | `gitlab_get_group {"group_id":"my-group"}` | group allowlist enforced |
| `gitlab_list_group_projects` | List group projects | `group_id`, pagination | list of projects | group/project read access | `GET /groups/:id/projects` | read-only | `gitlab_list_group_projects {"group_id":"my-group"}` | include_subgroups optional |
| `gitlab_list_group_members` | List group members | `group_id`, pagination | list of members | group membership visibility | `GET /groups/:id/members/all` | read-only | `gitlab_list_group_members {"group_id":"my-group"}` | inherited/private invite behavior follows GitLab rules |
| `gitlab_list_group_issues` | List group issues | `group_id`, filters | list of issues | group/project read access | `GET /groups/:id/issues` | read-only | `gitlab_list_group_issues {"group_id":"my-group","state":"opened"}` | results span descendant projects |
| `gitlab_list_group_merge_requests` | List group MRs | `group_id`, filters | list of MRs | group/project read access | `GET /groups/:id/merge_requests` | read-only | `gitlab_list_group_merge_requests {"group_id":"my-group","state":"opened"}` | results span descendant projects |

## I. Governance

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_list_protected_branches` | List protected branch rules for a project | `project_id` | list of protected branches | Maintainer+ or branch-policy visibility | `GET /projects/:id/protected_branches` | read-only | `gitlab_list_protected_branches {"project_id":"group/project"}` | branch visibility can vary by role and instance settings |
| `gitlab_get_branch_protection` | Get one protected branch rule | `project_id`, `branch` | protected branch object | Maintainer+ or branch-policy visibility | `GET /projects/:id/protected_branches/:branch` | read-only | `gitlab_get_branch_protection {"project_id":"group/project","branch":"main"}` | 404 when branch is unprotected or hidden |
| `gitlab_get_project_approval_configuration` | Inspect project-level MR approval settings | `project_id` | approval settings object | Maintainer+ or approval visibility | `GET /projects/:id/approvals` | read-only | `gitlab_get_project_approval_configuration {"project_id":"group/project"}` | fields vary by GitLab version and plan |
| `gitlab_get_project_approval_rules` | List project approval rules | `project_id` | approval rules list | Maintainer+ or approval visibility | `GET /projects/:id/approval_rules` | read-only | `gitlab_get_project_approval_rules {"project_id":"group/project"}` | hidden groups/users may be partially redacted by GitLab |
| `gitlab_get_merge_request_approval_rules` | List approval rules applied to one MR | `project_id`, `merge_request_iid` | MR approval rules list | project read access | `GET /projects/:id/merge_requests/:iid/approval_rules` | read-only | `gitlab_get_merge_request_approval_rules {"project_id":"group/project","merge_request_iid":7}` | MR-specific overrides may differ from project defaults |
| `gitlab_check_project_write_risk` | Assess whether project protections make AI writes low/medium/high risk | `project_id` | risk summary with protections and concerns | project read access; best with Maintainer visibility | protected branches + approvals APIs | read-only | `gitlab_check_project_write_risk {"project_id":"group/project"}` | heuristic assessment, not a policy guarantee |

## J. DevOps Intelligence / Higher-level tools

| Tool | Purpose | Key inputs | `data` shape | Permissions | Endpoint(s) | Safety | Example call | Edge/error notes |
|---|---|---|---|---|---|---|---|---|
| `gitlab_summarize_project_status` | Summarize current health | `project_id` | project summary, pipeline counts, issue/MR highlights | project read access | projects + pipelines + issues + MRs | read-only | `gitlab_summarize_project_status {"project_id":"group/project"}` | sampled counts, not full inventory |
| `gitlab_find_stale_merge_requests` | Find stale open MRs | `project_id`, `stale_after_days` | stale MR list | project read access | `GET /projects/:id/merge_requests` | read-only | `gitlab_find_stale_merge_requests {"project_id":"group/project","stale_after_days":21}` | freshness based on `updated_at` |
| `gitlab_find_blocked_merge_requests` | Find blocked MRs | `project_id` | blocked MR list | project read access | `GET /projects/:id/merge_requests` | read-only | `gitlab_find_blocked_merge_requests {"project_id":"group/project"}` | heuristic uses `detailed_merge_status` set |
| `gitlab_find_failed_pipelines` | Find failed pipelines | `project_id`, optional `ref` | failed pipeline list | project read access | `GET /projects/:id/pipelines?status=failed` | read-only | `gitlab_find_failed_pipelines {"project_id":"group/project"}` | pagination recommended for large histories |
| `gitlab_explain_failed_pipeline` | Explain failed pipeline | `project_id`, `pipeline_id` | pipeline + failed jobs + trace tails | project read access | pipeline + jobs + traces | read-only | `gitlab_explain_failed_pipeline {"project_id":"group/project","pipeline_id":123}` | trace tails are untrusted and trimmed |
| `gitlab_review_merge_request_risks` | Risk review for an MR | `project_id`, `merge_request_iid` | MR, counts, risk list, risk level | project read access | MR + diffs + discussions + pipelines | read-only | `gitlab_review_merge_request_risks {"project_id":"group/project","merge_request_iid":7}` | heuristic, not policy oracle |
| `gitlab_generate_release_notes` | Draft release notes | `project_id`, optional refs | compare summary and categorized commits | project read access | releases + compare | read-only | `gitlab_generate_release_notes {"project_id":"group/project","to_ref":"main"}` | falls back to latest release tag or default branch |
| `gitlab_summarize_recent_activity` | Summarize recent activity window | `project_id`, `days` | counts + highlights across events/issues/MRs/pipelines | project read access | events + issues + MRs + pipelines | read-only | `gitlab_summarize_recent_activity {"project_id":"group/project","days":7}` | depends on event availability |
| `gitlab_find_unassigned_issues` | Find unassigned issues | `project_id` | issue list | project read access | `GET /projects/:id/issues?assignee_id=None` | read-only | `gitlab_find_unassigned_issues {"project_id":"group/project"}` | sampled by requested page size |
| `gitlab_find_security_related_issues` | Find security-related issues | `project_id`, optional keywords | deduped issue list | project read access | repeated issue search queries | read-only | `gitlab_find_security_related_issues {"project_id":"group/project"}` | heuristic keyword search, may under/over-match |
| `gitlab_trace_issue_to_merge_requests` | Trace issue to closing MRs | `project_id`, `issue_iid` | MR list | project read access | `GET /projects/:id/issues/:iid/closed_by` | read-only | `gitlab_trace_issue_to_merge_requests {"project_id":"group/project","issue_iid":42}` | only closing relationships, not all references |
| `gitlab_trace_merge_request_to_pipeline_failures` | Trace MR to failed pipelines/jobs | `project_id`, `merge_request_iid` | pipelines with failed jobs and trace tails | project read access | MR pipelines + pipeline jobs + traces | read-only | `gitlab_trace_merge_request_to_pipeline_failures {"project_id":"group/project","merge_request_iid":7}` | trace tails are untrusted and bounded |

## REST vs GraphQL decisions in this design

- Current implementation uses REST for most tools because the endpoint mapping is explicit, stable, and easier to secure with per-tool guardrails.
- GraphQL is now used for `gitlab_get_merge_request_review_state`, where a single bounded aggregate query is materially better than REST fan-out.
- Additional GraphQL use should stay focused on aggregate/intelligence tools where it clearly reduces request count and latency.
