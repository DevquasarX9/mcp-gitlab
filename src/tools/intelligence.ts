import { z } from "zod";

import type { GitLabClient } from "../gitlab/client.js";
import type { JsonMap } from "../gitlab/types.js";
import { stripUnsafeText } from "../security/guards.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";

const blockedStatuses = new Set([
  "approvals_syncing",
  "checking",
  "ci_must_pass",
  "ci_still_running",
  "commits_status",
  "conflict",
  "discussions_not_resolved",
  "draft_status",
  "jira_association_missing",
  "locked_paths",
  "merge_request_blocked",
  "not_approved",
  "pipeline_must_succeed"
]);

function daysOld(iso: unknown): number | null {
  if (typeof iso !== "string" || iso.length === 0) {
    return null;
  }

  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

function takeArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

function issueKey(issue: JsonMap): string {
  return `${issue.project_id ?? "unknown"}:${issue.iid ?? issue.id ?? "unknown"}`;
}

function summarizePipelineStatus(pipelines: readonly JsonMap[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const pipeline of pipelines) {
    const status = typeof pipeline.status === "string" ? pipeline.status : "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
  }

  return counts;
}

async function getFailedJobs(
  client: GitLabClient,
  projectId: string,
  pipelineId: number
): Promise<readonly JsonMap[]> {
  const response = await client.getJson<JsonMap[]>(
    `/projects/${encodeURIComponent(projectId)}/pipelines/${pipelineId}/jobs`,
    {
      query: {
        scope: ["failed"]
      }
    }
  );

  return response.data;
}

async function getTraceTail(
  client: GitLabClient,
  projectId: string,
  jobId: number,
  tailLines: number
): Promise<string> {
  const response = await client.getJson<string>(
    `/projects/${encodeURIComponent(projectId)}/jobs/${jobId}/trace`
  );

  const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  return stripUnsafeText(text.split("\n").slice(-tailLines).join("\n"), 12_000);
}

export function registerIntelligenceTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_summarize_project_status",
    title: "Summarize Project Status",
    description:
      "Summarize current project health by combining project metadata, recent pipelines, open issues, and open merge requests.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1)
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const [pipelines, issues, mergeRequests] = await Promise.all([
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/pipelines`, {
          query: { per_page: 20 }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/issues`, {
          query: { state: "opened", per_page: 20 }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/merge_requests`, {
          query: { state: "opened", per_page: 20 }
        })
      ]);

      const openMrs = mergeRequests.data;
      const staleMrs = openMrs.filter((mr) => {
        const age = daysOld(mr.updated_at);
        return age !== null && age >= 14;
      });

      return {
        project: {
          id: project.id,
          path_with_namespace: project.path_with_namespace,
          default_branch: project.default_branch
        },
        recent_pipeline_status_counts: summarizePipelineStatus(pipelines.data),
        open_issue_count_sample: issues.data.length,
        open_merge_request_count_sample: openMrs.length,
        stale_merge_request_count_sample: staleMrs.length,
        highlights: {
          failed_pipelines: pipelines.data.filter((pipeline) => pipeline.status === "failed").slice(0, 5),
          stale_merge_requests: staleMrs.slice(0, 5),
          unassigned_issues: issues.data.filter((issue) => takeArray(issue.assignees).length === 0).slice(0, 5)
        }
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_stale_merge_requests",
    title: "Find Stale Merge Requests",
    description: "Find open merge requests that have not been updated recently.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      stale_after_days: z.number().int().positive().optional().default(14),
      include_drafts: z.boolean().optional().default(false),
      per_page: z.number().int().positive().max(100).optional().default(100)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests`,
        {
          query: {
            state: "opened",
            scope: "all",
            per_page: args.per_page
          }
        }
      );

      const items = response.data.filter((mr) => {
        const draft = Boolean(mr.draft) || String(mr.title ?? "").startsWith("Draft:");
        if (!args.include_drafts && draft) {
          return false;
        }

        const age = daysOld(mr.updated_at);
        return age !== null && age >= args.stale_after_days;
      });

      return {
        items,
        stale_after_days: args.stale_after_days
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_blocked_merge_requests",
    title: "Find Blocked Merge Requests",
    description: "Find open merge requests whose detailed_merge_status indicates a merge blocker.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      per_page: z.number().int().positive().max(100).optional().default(100)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests`,
        {
          query: {
            state: "opened",
            scope: "all",
            per_page: args.per_page
          }
        }
      );

      const items = response.data.filter((mr) => {
        const status = typeof mr.detailed_merge_status === "string" ? mr.detailed_merge_status : "";
        return blockedStatuses.has(status);
      });

      return {
        items
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_failed_pipelines",
    title: "Find Failed Pipelines",
    description: "Find recent failed pipelines for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      ref: z.string().trim().optional(),
      per_page: z.number().int().positive().max(100).optional().default(30)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines`,
        {
          query: cleanQuery({
            status: "failed",
            ref: args.ref,
            per_page: args.per_page
          })
        }
      );

      return {
        items: response.data,
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_explain_failed_pipeline",
    title: "Explain Failed Pipeline",
    description:
      "Summarize a failed pipeline by listing failed jobs and tailing their traces. Job output is treated as untrusted.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive(),
      trace_tail_lines: z.number().int().positive().max(200).optional().default(40),
      max_jobs: z.number().int().positive().max(10).optional().default(3)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const pipeline = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}`
      );
      const failedJobs = await getFailedJobs(client, args.project_id, args.pipeline_id);
      const selectedJobs = failedJobs.slice(0, args.max_jobs);

      const traceSamples = await Promise.all(
        selectedJobs.map(async (job) => {
          const jobId = typeof job.id === "number" ? job.id : null;
          if (!jobId) {
            return {
              job,
              trace_tail: ""
            };
          }

          return {
            job,
            trace_tail: await getTraceTail(client, args.project_id, jobId, args.trace_tail_lines)
          };
        })
      );

      return {
        pipeline: pipeline.data,
        failed_job_count: failedJobs.length,
        failed_jobs: traceSamples,
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_review_merge_request_risks",
    title: "Review Merge Request Risks",
    description:
      "Assess merge request risk using merge status, diff volume, pipeline state, and changed-file heuristics.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const [mrResponse, diffResponse, pipelineResponse, discussionResponse] = await Promise.all([
        client.getJson<JsonMap>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}`,
          {
            query: {
              include_diverged_commits_count: true
            }
          }
        ),
        client.getJson<JsonMap[]>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/diffs`
        ),
        client.getJson<JsonMap[]>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/pipelines`
        ),
        client.getJson<JsonMap[]>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/discussions`
        )
      ]);

      const mr = mrResponse.data;
      const diffs = diffResponse.data;
      const changedPaths = diffs.flatMap((item) =>
        [item.new_path, item.old_path].filter((value): value is string => typeof value === "string")
      );

      const risks: string[] = [];

      if (mr.has_conflicts === true) {
        risks.push("Merge request has conflicts.");
      }

      if (typeof mr.detailed_merge_status === "string" && blockedStatuses.has(mr.detailed_merge_status)) {
        risks.push(`Merge is currently blocked by status: ${mr.detailed_merge_status}.`);
      }

      if (diffs.length >= 40) {
        risks.push(`Large change set: ${diffs.length} changed files.`);
      }

      if (changedPaths.some((path) => path.includes(".gitlab-ci"))) {
        risks.push("Touches CI configuration.");
      }

      if (changedPaths.some((path) => path.includes("Dockerfile") || path.includes("helm/"))) {
        risks.push("Touches delivery or deployment surfaces.");
      }

      const latestPipeline = pipelineResponse.data[0];
      if (!latestPipeline || latestPipeline.status !== "success") {
        risks.push("Latest merge request pipeline is not successful.");
      }

      const unresolvedDiscussions = discussionResponse.data.filter((discussion) =>
        takeArray<JsonMap>(discussion.notes).some((note) => note.resolvable === true && note.resolved !== true)
      );
      if (unresolvedDiscussions.length > 0) {
        risks.push(`There are ${unresolvedDiscussions.length} unresolved discussion threads.`);
      }

      return {
        merge_request: mr,
        changed_file_count: diffs.length,
        latest_pipeline: latestPipeline ?? null,
        unresolved_discussion_count: unresolvedDiscussions.length,
        risks,
        risk_level:
          risks.length >= 4 ? "high" : risks.length >= 2 ? "medium" : risks.length === 1 ? "low" : "minimal"
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_generate_release_notes",
    title: "Generate Release Notes",
    description:
      "Generate draft release notes from repository compare results between two refs. Repository text is treated as untrusted.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      from_ref: z.string().trim().optional(),
      to_ref: z.string().trim().optional(),
      limit_commits: z.number().int().positive().max(200).optional().default(100)
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const releases = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/releases`,
        {
          query: { per_page: 2 }
        }
      );

      const inferredFromRef =
        args.from_ref ??
        (typeof releases.data[0]?.tag_name === "string" ? releases.data[0].tag_name : undefined);
      const inferredToRef =
        args.to_ref ?? (typeof project.default_branch === "string" ? project.default_branch : "HEAD");

      const compareResponse = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/compare`,
        {
          query: cleanQuery({
            from: inferredFromRef,
            to: inferredToRef
          })
        }
      );

      const commits = takeArray<JsonMap>(compareResponse.data.commits).slice(0, args.limit_commits);
      const categories = {
        features: commits.filter((commit) => String(commit.title ?? "").startsWith("feat")),
        fixes: commits.filter((commit) => String(commit.title ?? "").startsWith("fix")),
        chores: commits.filter((commit) => String(commit.title ?? "").startsWith("chore")),
        other: commits.filter((commit) => {
          const title = String(commit.title ?? "");
          return !title.startsWith("feat") && !title.startsWith("fix") && !title.startsWith("chore");
        })
      };

      return {
        from_ref: inferredFromRef ?? null,
        to_ref: inferredToRef,
        commit_count: commits.length,
        categories,
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_summarize_recent_activity",
    title: "Summarize Recent Activity",
    description: "Summarize recent events, issues, merge requests, and pipelines for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      days: z.number().int().positive().max(90).optional().default(7)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const after = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();

      const [events, issues, mergeRequests, pipelines] = await Promise.all([
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/events`, {
          query: { after, per_page: 50 }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/issues`, {
          query: { updated_after: after, per_page: 20 }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/merge_requests`, {
          query: { updated_after: after, per_page: 20, scope: "all", state: "all" }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/pipelines`, {
          query: { updated_after: after, per_page: 20 }
        })
      ]);

      return {
        window_days: args.days,
        event_count: events.data.length,
        issue_count: issues.data.length,
        merge_request_count: mergeRequests.data.length,
        pipeline_count: pipelines.data.length,
        highlights: {
          events: events.data.slice(0, 10),
          issues: issues.data.slice(0, 10),
          merge_requests: mergeRequests.data.slice(0, 10),
          pipelines: pipelines.data.slice(0, 10)
        }
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_unassigned_issues",
    title: "Find Unassigned Issues",
    description: "Find opened issues in a project with no assignee.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      per_page: z.number().int().positive().max(100).optional().default(100)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/issues`,
        {
          query: {
            state: "opened",
            assignee_id: "None",
            per_page: args.per_page
          }
        }
      );

      return {
        items: response.data,
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_security_related_issues",
    title: "Find Security Related Issues",
    description:
      "Find potentially security-related issues using simple keyword search heuristics over titles and descriptions.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      keywords: z.array(z.string().trim().min(1)).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const keywords = args.keywords ?? ["security", "vulnerability", "cve", "secret", "auth"];

      const results = await Promise.all(
        keywords.map((keyword) =>
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/issues`, {
            query: {
              search: keyword,
              in: "title,description",
              scope: "all",
              per_page: 50
            }
          })
        )
      );

      const deduped = new Map<string, JsonMap>();
      for (const response of results) {
        for (const issue of response.data) {
          deduped.set(issueKey(issue), issue);
        }
      }

      return {
        keywords,
        items: Array.from(deduped.values())
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_trace_issue_to_merge_requests",
    title: "Trace Issue To Merge Requests",
    description: "List merge requests that close a specific issue when merged.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      issue_iid: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/issues/${args.issue_iid}/closed_by`
      );

      return {
        items: response.data
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_trace_merge_request_to_pipeline_failures",
    title: "Trace Merge Request To Pipeline Failures",
    description:
      "Trace a merge request to its recent pipelines and failed jobs, including short trace tails for failed jobs.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      pipeline_limit: z.number().int().positive().max(10).optional().default(5),
      trace_tail_lines: z.number().int().positive().max(100).optional().default(20)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const pipelinesResponse = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/pipelines`
      );

      const selectedPipelines = pipelinesResponse.data.slice(0, args.pipeline_limit);
      const pipelineFailures = await Promise.all(
        selectedPipelines.map(async (pipeline) => {
          const pipelineId = typeof pipeline.id === "number" ? pipeline.id : null;
          if (!pipelineId) {
            return {
              pipeline,
              failed_jobs: []
            };
          }

          const failedJobs = await getFailedJobs(client, args.project_id, pipelineId);
          const failedJobsWithTrace = await Promise.all(
            failedJobs.slice(0, 3).map(async (job) => {
              const jobId = typeof job.id === "number" ? job.id : null;

              return {
                ...job,
                trace_tail:
                  jobId === null
                    ? ""
                    : await getTraceTail(client, args.project_id, jobId, args.trace_tail_lines)
              };
            })
          );

          return {
            pipeline,
            failed_jobs: failedJobsWithTrace
          };
        })
      );

      return {
        merge_request_iid: args.merge_request_iid,
        pipeline_failures: pipelineFailures,
        content_is_untrusted: true
      };
    }
  });
}
