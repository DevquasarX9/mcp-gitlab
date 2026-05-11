import { z } from "zod";

import type { GitLabClient } from "../gitlab/client.js";
import type { JsonMap } from "../gitlab/types.js";
import { stripUnsafeText } from "../security/guards.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";
import {
  formatFailedPipelineMarkdown,
  formatFlakyCiTriageMarkdown,
  formatMergeRequestRiskMarkdown,
  formatReleaseReadinessMarkdown,
  formatProjectStatusMarkdown,
  formatReleaseNotesMarkdown,
  formatStaleMergeRequestCleanupMarkdown,
  outputFormatSchema,
  presentOutput
} from "./output.js";
import { comparePipelineJobSets, detectFlakyJobs } from "./pipelines.js";

export const blockedStatuses = new Set([
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

export function isBlockedMergeStatus(status: unknown): boolean {
  return typeof status === "string" && blockedStatuses.has(status.toLowerCase());
}

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

function normalizeStatus(status: unknown): string {
  return typeof status === "string" ? status.toLowerCase() : "";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const activePipelineStatuses = new Set([
  "created",
  "manual",
  "pending",
  "preparing",
  "running",
  "scheduled",
  "waiting_for_resource"
]);

export function categorizeReleaseCommits(commits: readonly JsonMap[]): {
  readonly features: readonly JsonMap[];
  readonly fixes: readonly JsonMap[];
  readonly chores: readonly JsonMap[];
  readonly other: readonly JsonMap[];
} {
  return {
    features: commits.filter((commit) => String(commit.title ?? "").startsWith("feat")),
    fixes: commits.filter((commit) => String(commit.title ?? "").startsWith("fix")),
    chores: commits.filter((commit) => String(commit.title ?? "").startsWith("chore")),
    other: commits.filter((commit) => {
      const title = String(commit.title ?? "");
      return !title.startsWith("feat") && !title.startsWith("fix") && !title.startsWith("chore");
    })
  };
}

export function summarizeReleaseReadinessAssessment(input: {
  readonly project: JsonMap;
  readonly targetRef: string;
  readonly latestPipeline: JsonMap | null;
  readonly failedPipelines: readonly JsonMap[];
  readonly openMergeRequests: readonly JsonMap[];
  readonly staleMergeRequests: readonly JsonMap[];
  readonly blockedMergeRequests: readonly JsonMap[];
  readonly unassignedIssues: readonly JsonMap[];
  readonly compareFromRef: string | null;
  readonly compareCommitCount: number;
  readonly releaseCategories: {
    readonly features: readonly JsonMap[];
    readonly fixes: readonly JsonMap[];
    readonly chores: readonly JsonMap[];
    readonly other: readonly JsonMap[];
  };
}): JsonMap {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];
  const latestPipelineStatus = normalizeStatus(input.latestPipeline?.status);

  if (input.failedPipelines.length > 0) {
    blockers.push(`Recent failed pipelines detected on ${input.targetRef}.`);
    nextActions.push("Investigate the recent failed pipelines on the target ref before releasing.");
  }

  if (input.blockedMergeRequests.length > 0) {
    blockers.push(`There are ${input.blockedMergeRequests.length} blocked open merge requests targeting the release path.`);
    nextActions.push("Resolve or remove blocked merge requests that would affect the release path.");
  }

  if (latestPipelineStatus.length === 0) {
    warnings.push("No recent pipeline was found for the target ref.");
    nextActions.push("Confirm that the release ref has a recent validated pipeline.");
  } else if (activePipelineStatuses.has(latestPipelineStatus)) {
    warnings.push(`Latest pipeline on ${input.targetRef} is still ${latestPipelineStatus}.`);
    nextActions.push("Wait for the latest pipeline to finish before making the final release decision.");
  } else if (latestPipelineStatus !== "success") {
    blockers.push(`Latest pipeline on ${input.targetRef} is ${latestPipelineStatus}.`);
    nextActions.push("Restore the latest pipeline on the target ref to a successful state.");
  }

  if (input.staleMergeRequests.length > 0) {
    warnings.push(`There are ${input.staleMergeRequests.length} stale open merge requests.`);
    nextActions.push("Triage stale merge requests so release scope and ownership are clear.");
  }

  if (input.unassignedIssues.length > 0) {
    warnings.push(`There are ${input.unassignedIssues.length} unassigned open issues.`);
    nextActions.push("Assign or explicitly defer unassigned open issues that may affect the release.");
  }

  if (input.compareFromRef === null) {
    warnings.push("No previous release tag or explicit from_ref was available for release-note comparison.");
    nextActions.push("Confirm the intended release baseline before announcing or tagging the release.");
  }

  if (input.compareCommitCount >= 50) {
    warnings.push(`The release compare includes ${input.compareCommitCount} commits, which is a relatively large batch.`);
    nextActions.push("Review the release scope carefully because the change batch is large.");
  }

  if (input.openMergeRequests.length >= 10) {
    warnings.push(`There are ${input.openMergeRequests.length} open merge requests in scope, which may indicate active churn.`);
    nextActions.push("Confirm that active merge requests are intentionally excluded or included in the release plan.");
  }

  const readinessStatus =
    blockers.length > 0 ? "hold" : warnings.length > 0 ? "caution" : "go";
  const summary =
    readinessStatus === "hold"
      ? "Release readiness is blocked by pipeline or merge-state issues that should be resolved first."
      : readinessStatus === "caution"
        ? "Release readiness looks plausible, but there are unresolved warnings that should be reviewed before proceeding."
        : "Release readiness looks good based on the current sampled project, pipeline, and issue signals.";

  if (nextActions.length === 0) {
    nextActions.push("Proceed with final release validation and stakeholder communication.");
  }

  return {
    project: {
      id: input.project.id ?? null,
      path_with_namespace: input.project.path_with_namespace ?? null,
      default_branch: input.project.default_branch ?? null
    },
    target_ref: input.targetRef,
    readiness_status: readinessStatus,
    summary,
    blockers,
    warnings,
    next_actions: nextActions,
    signals: {
      latest_pipeline_status: latestPipelineStatus.length > 0 ? latestPipelineStatus : null,
      failed_pipeline_sample_count: input.failedPipelines.length,
      blocked_merge_request_sample_count: input.blockedMergeRequests.length,
      stale_merge_request_sample_count: input.staleMergeRequests.length,
      unassigned_issue_sample_count: input.unassignedIssues.length,
      open_merge_request_sample_count: input.openMergeRequests.length,
      release_note_commit_count: input.compareCommitCount,
      compare_from_ref: input.compareFromRef,
      release_note_category_counts: {
        features: input.releaseCategories.features.length,
        fixes: input.releaseCategories.fixes.length,
        chores: input.releaseCategories.chores.length,
        other: input.releaseCategories.other.length
      }
    },
    highlights: {
      failed_pipelines: input.failedPipelines.slice(0, 5),
      blocked_merge_requests: input.blockedMergeRequests.slice(0, 5),
      stale_merge_requests: input.staleMergeRequests.slice(0, 5),
      unassigned_issues: input.unassignedIssues.slice(0, 5)
    },
    content_is_untrusted: true
  };
}

interface FlakyJobContext {
  readonly job: JsonMap;
  readonly trace_job_result: JsonMap | null;
}

export function summarizeFlakyCiTriageAssessment(input: {
  readonly project: JsonMap;
  readonly ref: string | null;
  readonly lookbackPipelineCount: number;
  readonly failedPipelines: readonly JsonMap[];
  readonly flakyJobs: readonly JsonMap[];
  readonly representativePipelineComparison: JsonMap | null;
  readonly flakyJobContexts: readonly FlakyJobContext[];
}): JsonMap {
  const nextActions: string[] = [];
  const warnings: string[] = [];

  const triageStatus =
    input.flakyJobs.length > 0
      ? "flaky_detected"
      : input.failedPipelines.length > 0
        ? "deterministic_failures_only"
        : input.lookbackPipelineCount < 3
          ? "insufficient_data"
          : "stable_or_no_signal";

  const summary =
    triageStatus === "flaky_detected"
      ? "Recent pipeline history shows jobs that oscillate between success and failure, which is a strong flaky CI signal."
      : triageStatus === "deterministic_failures_only"
        ? "There are failed pipelines, but the sampled job history does not show strong flaky-job oscillation yet."
        : triageStatus === "insufficient_data"
          ? "There is not enough recent pipeline history to make a strong flaky CI judgment."
          : "The sampled recent pipeline history does not show a strong flaky CI signal.";

  if (input.lookbackPipelineCount < 3) {
    warnings.push("Recent pipeline history is shallow, so the flaky-job signal is weak.");
    nextActions.push("Collect more pipeline history before making a strong flaky-versus-deterministic call.");
  }

  if (input.flakyJobs.length > 0) {
    nextActions.push("Triage the top oscillating jobs first and compare their last successful and failed runs.");
  }

  if (input.failedPipelines.length > 0) {
    nextActions.push("Review the most recent failed pipelines to confirm whether the failures cluster around the same jobs.");
  }

  if (input.representativePipelineComparison !== null) {
    nextActions.push("Use the representative pipeline comparison to isolate which jobs changed behavior between a passing and failing run.");
  }

  if (input.flakyJobContexts.length > 0) {
    nextActions.push("Check the commit and merge request context for the strongest flaky candidates before escalating to owners.");
  }

  if (nextActions.length === 0) {
    nextActions.push("Continue monitoring CI history and rerun this triage when more pipeline samples exist.");
  }

  return {
    project: {
      id: input.project.id ?? null,
      path_with_namespace: input.project.path_with_namespace ?? null,
      default_branch: input.project.default_branch ?? null
    },
    ref: input.ref,
    triage_status: triageStatus,
    summary,
    warnings,
    next_actions: nextActions,
    signals: {
      lookback_pipeline_count: input.lookbackPipelineCount,
      failed_pipeline_sample_count: input.failedPipelines.length,
      likely_flaky_job_count: input.flakyJobs.length,
      jobs_with_context_count: input.flakyJobContexts.length
    },
    highlights: {
      likely_flaky_jobs: input.flakyJobs.slice(0, 5),
      failed_pipelines: input.failedPipelines.slice(0, 5),
      flaky_job_contexts: input.flakyJobContexts.slice(0, 3)
    },
    representative_pipeline_comparison:
      input.representativePipelineComparison ?? {
        left_pipeline: null,
        right_pipeline: null,
        comparison: {
          added_job_count: 0,
          removed_job_count: 0,
          status_change_count: 0,
          duration_change_count: 0
        }
      },
    content_is_untrusted: true
  };
}

interface StaleMergeRequestCleanupItemInput {
  readonly mergeRequest: JsonMap;
  readonly unresolvedDiscussionCount: number;
  readonly latestPipelineStatus: string | null;
}

function recommendStaleMergeRequestAction(input: StaleMergeRequestCleanupItemInput): {
  readonly recommendedAction: string;
  readonly reason: string;
} {
  const detailedMergeStatus = normalizeStatus(input.mergeRequest.detailed_merge_status);

  if (Boolean(input.mergeRequest.draft) || String(input.mergeRequest.title ?? "").startsWith("Draft:")) {
    return {
      recommendedAction: "close_or_reassign",
      reason: "The merge request is still a draft and appears to have stalled without recent progress."
    };
  }

  if (Boolean(input.mergeRequest.has_conflicts) || detailedMergeStatus === "conflict") {
    return {
      recommendedAction: "rebase_or_resolve_conflicts",
      reason: "The merge request cannot move forward until conflicts are resolved."
    };
  }

  if (input.latestPipelineStatus === "failed") {
    return {
      recommendedAction: "fix_pipeline",
      reason: "The latest merge request pipeline failed, so CI should be restored before review continues."
    };
  }

  if (input.unresolvedDiscussionCount > 0 || detailedMergeStatus === "discussions_not_resolved") {
    return {
      recommendedAction: "resolve_discussions",
      reason: "There are unresolved review discussions blocking the merge request from progressing."
    };
  }

  if (isBlockedMergeStatus(detailedMergeStatus)) {
    return {
      recommendedAction: "unblock_review_state",
      reason: `The merge request is currently blocked by merge status "${detailedMergeStatus}".`
    };
  }

  return {
    recommendedAction: "comment_for_owner_decision",
    reason: "The merge request looks inactive without a single obvious blocker, so ownership and intent should be clarified."
  };
}

export function summarizeStaleMergeRequestCleanupAssessment(input: {
  readonly project: JsonMap;
  readonly staleAfterDays: number;
  readonly staleMergeRequests: readonly JsonMap[];
  readonly blockedStaleMergeRequests: readonly JsonMap[];
  readonly cleanupItems: readonly JsonMap[];
}): JsonMap {
  const draftStaleMergeRequests = input.staleMergeRequests.filter(
    (mergeRequest) =>
      Boolean(mergeRequest.draft) || String(mergeRequest.title ?? "").startsWith("Draft:")
  );
  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (input.blockedStaleMergeRequests.length > 0) {
    warnings.push(
      `${input.blockedStaleMergeRequests.length} stale merge requests are explicitly blocked by merge state.`
    );
    nextActions.push(
      "Start with the blocked stale merge requests because they have a clear unblock path and release-risk implications."
    );
  }

  if (draftStaleMergeRequests.length > 0) {
    warnings.push(`${draftStaleMergeRequests.length} stale merge requests are still drafts.`);
    nextActions.push("Confirm whether stale draft merge requests should be revived, reassigned, or closed.");
  }

  if (input.cleanupItems.some((item) => item.recommended_action === "fix_pipeline")) {
    nextActions.push("Repair failed merge request pipelines before asking reviewers to re-engage.");
  }

  if (input.cleanupItems.some((item) => item.recommended_action === "resolve_discussions")) {
    nextActions.push("Resolve or explicitly defer open review discussions on the oldest stale merge requests.");
  }

  if (nextActions.length === 0) {
    nextActions.push("No stale merge request cleanup is needed right now.");
  }

  const cleanupStatus =
    input.blockedStaleMergeRequests.length > 0
      ? "needs_unblock"
      : input.staleMergeRequests.length > 0
        ? "needs_triage"
        : "clean";

  const summary =
    cleanupStatus === "needs_unblock"
      ? "Several stale merge requests have explicit blockers and should be unblocked or closed before they continue to age."
      : cleanupStatus === "needs_triage"
        ? "There are stale merge requests that need ownership and disposition decisions, even if they are not formally blocked."
        : "No stale merge requests were found in the sampled open merge request set.";

  return {
    project: {
      id: input.project.id ?? null,
      path_with_namespace: input.project.path_with_namespace ?? null,
      default_branch: input.project.default_branch ?? null
    },
    stale_after_days: input.staleAfterDays,
    cleanup_status: cleanupStatus,
    summary,
    warnings,
    next_actions: nextActions,
    signals: {
      stale_merge_request_count: input.staleMergeRequests.length,
      blocked_stale_merge_request_count: input.blockedStaleMergeRequests.length,
      draft_stale_merge_request_count: draftStaleMergeRequests.length
    },
    cleanup_items: input.cleanupItems,
    highlights: {
      stale_merge_requests: input.staleMergeRequests.slice(0, 5),
      blocked_stale_merge_requests: input.blockedStaleMergeRequests.slice(0, 5)
    },
    content_is_untrusted: true
  };
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
      project_id: z.string().trim().min(1),
      output_format: outputFormatSchema
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

      const result = {
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

      return presentOutput(args.output_format, result, formatProjectStatusMarkdown);
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
        return isBlockedMergeStatus(mr.detailed_merge_status);
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
      max_jobs: z.number().int().positive().max(10).optional().default(3),
      output_format: outputFormatSchema
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

      const result = {
        pipeline: pipeline.data,
        failed_job_count: failedJobs.length,
        failed_jobs: traceSamples,
        content_is_untrusted: true
      };

      return presentOutput(args.output_format, result, formatFailedPipelineMarkdown);
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
      merge_request_iid: z.number().int().positive(),
      output_format: outputFormatSchema
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

      const result = {
        merge_request: mr,
        changed_file_count: diffs.length,
        latest_pipeline: latestPipeline ?? null,
        unresolved_discussion_count: unresolvedDiscussions.length,
        risks,
        risk_level:
          risks.length >= 4 ? "high" : risks.length >= 2 ? "medium" : risks.length === 1 ? "low" : "minimal"
      };

      return presentOutput(args.output_format, result, formatMergeRequestRiskMarkdown);
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
      limit_commits: z.number().int().positive().max(200).optional().default(100),
      output_format: outputFormatSchema
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
      const categories = categorizeReleaseCommits(commits);

      const result = {
        from_ref: inferredFromRef ?? null,
        to_ref: inferredToRef,
        commit_count: commits.length,
        categories,
        content_is_untrusted: true
      };

      return presentOutput(args.output_format, result, formatReleaseNotesMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_release_readiness_check",
    title: "Release Readiness Check",
    description:
      "Assess whether a project looks ready for release by combining pipeline, merge request, issue, and release comparison signals.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      target_ref: z.string().trim().optional(),
      stale_after_days: z.number().int().positive().max(90).optional().default(14),
      limit_commits: z.number().int().positive().max(200).optional().default(100),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const targetRef = typeof args.target_ref === "string" && args.target_ref.length > 0
        ? args.target_ref
        : typeof project.default_branch === "string" && project.default_branch.length > 0
          ? project.default_branch
          : "HEAD";

      const [recentPipelinesResponse, failedPipelinesResponse, mergeRequestsResponse, unassignedIssuesResponse, releasesResponse] =
        await Promise.all([
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/pipelines`, {
            query: { ref: targetRef, per_page: 10 }
          }),
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/pipelines`, {
            query: { ref: targetRef, status: "failed", per_page: 10 }
          }),
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/merge_requests`, {
            query: {
              state: "opened",
              scope: "all",
              target_branch: targetRef,
              per_page: 50
            }
          }),
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/issues`, {
            query: {
              state: "opened",
              assignee_id: "None",
              per_page: 20
            }
          }),
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/releases`, {
            query: { per_page: 2 }
          })
        ]);

      const openMergeRequests = mergeRequestsResponse.data;
      const staleMergeRequests = openMergeRequests.filter((mr) => {
        const age = daysOld(mr.updated_at);
        return age !== null && age >= args.stale_after_days;
      });
      const blockedMergeRequests = openMergeRequests.filter((mr) =>
        isBlockedMergeStatus(mr.detailed_merge_status)
      );

      const compareFromRef =
        typeof releasesResponse.data[0]?.tag_name === "string" ? releasesResponse.data[0].tag_name : null;

      let compareCommitCount = 0;
      let releaseCategories = categorizeReleaseCommits([]);

      if (compareFromRef !== null) {
        const compareResponse = await client.getJson<JsonMap>(
          `/projects/${encodeURIComponent(args.project_id)}/repository/compare`,
          {
            query: cleanQuery({
              from: compareFromRef,
              to: targetRef
            })
          }
        );

        const commits = takeArray<JsonMap>(compareResponse.data.commits).slice(0, args.limit_commits);
        compareCommitCount = commits.length;
        releaseCategories = categorizeReleaseCommits(commits);
      }

      const result = summarizeReleaseReadinessAssessment({
        project,
        targetRef,
        latestPipeline: recentPipelinesResponse.data[0] ?? null,
        failedPipelines: failedPipelinesResponse.data,
        openMergeRequests,
        staleMergeRequests,
        blockedMergeRequests,
        unassignedIssues: unassignedIssuesResponse.data,
        compareFromRef,
        compareCommitCount,
        releaseCategories
      });

      return presentOutput(args.output_format, result, formatReleaseReadinessMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_flaky_ci_triage",
    title: "Flaky CI Triage",
    description:
      "Assess whether recent CI failures look flaky by combining pipeline history, job oscillation, representative comparisons, and commit/MR context.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      ref: z.string().trim().optional(),
      lookback_pipelines: z.number().int().positive().max(25).optional().default(12),
      min_samples: z.number().int().positive().max(20).optional().default(3),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);

      const pipelinesResponse = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines`,
        {
          query: cleanQuery({
            ref: args.ref,
            per_page: args.lookback_pipelines
          })
        }
      );

      const pipelines = pipelinesResponse.data;
      const jobsByPipeline = await Promise.all(
        pipelines.map(async (pipeline) => {
          const pipelineId = asNumber(pipeline.id);
          if (pipelineId === null) {
            return {
              pipeline,
              jobs: [] as readonly JsonMap[]
            };
          }

          const response = await client.getJson<JsonMap[]>(
            `/projects/${encodeURIComponent(args.project_id)}/pipelines/${pipelineId}/jobs`,
            {
              query: {
                include_retried: false,
                per_page: 100
              }
            }
          );

          return {
            pipeline,
            jobs: response.data.map((job) => ({
              ...job,
              pipeline_id: pipelineId,
              pipeline_status: pipeline.status,
              pipeline_ref: pipeline.ref
            }))
          };
        })
      );

      const allJobRuns = jobsByPipeline.flatMap((entry) => entry.jobs);
      const flakyJobs = detectFlakyJobs(allJobRuns, args.min_samples);
      const failedPipelines = pipelines.filter((pipeline) => normalizeStatus(pipeline.status) === "failed");
      const latestFailedPipeline = failedPipelines[0] ?? null;
      const latestSuccessfulPipeline =
        pipelines.find((pipeline) => normalizeStatus(pipeline.status) === "success") ?? null;

      let representativePipelineComparison: JsonMap | null = null;

      if (latestFailedPipeline && latestSuccessfulPipeline) {
        const leftPipelineId = asNumber(latestSuccessfulPipeline.id);
        const rightPipelineId = asNumber(latestFailedPipeline.id);

        if (leftPipelineId !== null && rightPipelineId !== null) {
          const leftJobs = jobsByPipeline.find((entry) => asNumber(entry.pipeline.id) === leftPipelineId)?.jobs ?? [];
          const rightJobs = jobsByPipeline.find((entry) => asNumber(entry.pipeline.id) === rightPipelineId)?.jobs ?? [];
          const comparison = comparePipelineJobSets(leftJobs, rightJobs);

          representativePipelineComparison = {
            left_pipeline: latestSuccessfulPipeline,
            right_pipeline: latestFailedPipeline,
            comparison: {
              ...comparison,
              added_job_count: takeArray(comparison.added_jobs).length,
              removed_job_count: takeArray(comparison.removed_jobs).length,
              status_change_count: takeArray(comparison.status_changes).length,
              duration_change_count: takeArray(comparison.duration_changes).length
            }
          };
        }
      }

      const flakyJobContexts = await Promise.all(
        flakyJobs.slice(0, 3).map(async (job) => {
          const recentRuns = takeArray<JsonMap>(job.recent_runs);
          const representativeRun =
            [...recentRuns].reverse().find((run) => normalizeStatus(run.status) === "failed") ??
            recentRuns[recentRuns.length - 1] ??
            null;
          const jobId = representativeRun ? asNumber(representativeRun.id) : null;

          if (jobId === null) {
            return {
              job,
              trace_job_result: null
            };
          }

          const jobResponse = await client.getJson<JsonMap>(
            `/projects/${encodeURIComponent(args.project_id)}/jobs/${jobId}`
          );
          const tracedJob = jobResponse.data;
          const commit = (tracedJob.commit as JsonMap | undefined) ?? null;
          const commitSha = commit ? asString(commit.id) : null;

          const mergeRequests = commitSha === null
            ? []
            : await client
                .getJson<JsonMap[]>(
                  `/projects/${encodeURIComponent(args.project_id)}/repository/commits/${encodeURIComponent(commitSha)}/merge_requests`,
                  {
                    query: { state: "all" }
                  }
                )
                .then((response) => response.data);

          return {
            job,
            trace_job_result: {
              job: tracedJob,
              commit,
              merge_requests: mergeRequests
            }
          };
        })
      );

      const result = summarizeFlakyCiTriageAssessment({
        project,
        ref: args.ref ?? (typeof project.default_branch === "string" ? project.default_branch : null),
        lookbackPipelineCount: pipelines.length,
        failedPipelines,
        flakyJobs,
        representativePipelineComparison,
        flakyJobContexts
      });

      return presentOutput(args.output_format, result, formatFlakyCiTriageMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_stale_merge_request_cleanup",
    title: "Stale Merge Request Cleanup",
    description:
      "Triage stale merge requests and recommend whether they should be merged, rebased, reassigned, commented on, or closed.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      stale_after_days: z.number().int().positive().max(90).optional().default(14),
      include_drafts: z.boolean().optional().default(false),
      per_page: z.number().int().positive().max(100).optional().default(50),
      max_detailed_items: z.number().int().positive().max(10).optional().default(5),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const mergeRequestsResponse = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests`,
        {
          query: {
            state: "opened",
            scope: "all",
            per_page: args.per_page
          }
        }
      );

      const staleMergeRequests = mergeRequestsResponse.data.filter((mergeRequest) => {
        const draft =
          Boolean(mergeRequest.draft) || String(mergeRequest.title ?? "").startsWith("Draft:");
        if (!args.include_drafts && draft) {
          return false;
        }

        const age = daysOld(mergeRequest.updated_at);
        return age !== null && age >= args.stale_after_days;
      });
      const blockedStaleMergeRequests = staleMergeRequests.filter((mergeRequest) =>
        isBlockedMergeStatus(mergeRequest.detailed_merge_status)
      );

      const cleanupItems = await Promise.all(
        staleMergeRequests.slice(0, args.max_detailed_items).map(async (mergeRequest) => {
          const mergeRequestIid = asNumber(mergeRequest.iid);
          if (mergeRequestIid === null) {
            return {
              merge_request: mergeRequest,
              unresolved_discussion_count: 0,
              latest_pipeline_status: null,
              recommended_action: "comment_for_owner_decision",
              reason: "The merge request IID was missing, so detailed triage could not be completed."
            };
          }

          const [detailsResponse, pipelinesResponse, discussionsResponse] = await Promise.all([
            client.getJson<JsonMap>(
              `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${mergeRequestIid}`,
              {
                query: {
                  include_diverged_commits_count: true,
                  include_rebase_in_progress: true
                }
              }
            ),
            client.getJson<JsonMap[]>(
              `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${mergeRequestIid}/pipelines`
            ),
            client.getJson<JsonMap[]>(
              `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${mergeRequestIid}/discussions`
            )
          ]);

          const detailedMergeRequest = detailsResponse.data;
          const unresolvedDiscussionCount = discussionsResponse.data.filter((discussion) =>
            takeArray<JsonMap>(discussion.notes).some(
              (note) => note.resolvable === true && note.resolved !== true
            )
          ).length;
          const latestPipelineStatus = asString(pipelinesResponse.data[0]?.status);
          const recommendation = recommendStaleMergeRequestAction({
            mergeRequest: detailedMergeRequest,
            unresolvedDiscussionCount,
            latestPipelineStatus
          });

          return {
            merge_request: {
              iid: detailedMergeRequest.iid ?? mergeRequestIid,
              title: detailedMergeRequest.title ?? mergeRequest.title ?? null,
              web_url: detailedMergeRequest.web_url ?? mergeRequest.web_url ?? null,
              updated_at: detailedMergeRequest.updated_at ?? mergeRequest.updated_at ?? null,
              detailed_merge_status:
                detailedMergeRequest.detailed_merge_status ?? mergeRequest.detailed_merge_status ?? null,
              draft:
                detailedMergeRequest.draft ??
                mergeRequest.draft ??
                String(detailedMergeRequest.title ?? mergeRequest.title ?? "").startsWith("Draft:")
            },
            unresolved_discussion_count: unresolvedDiscussionCount,
            latest_pipeline_status: latestPipelineStatus,
            recommended_action: recommendation.recommendedAction,
            reason: recommendation.reason
          };
        })
      );

      const result = summarizeStaleMergeRequestCleanupAssessment({
        project,
        staleAfterDays: args.stale_after_days,
        staleMergeRequests,
        blockedStaleMergeRequests,
        cleanupItems
      });

      return presentOutput(args.output_format, result, formatStaleMergeRequestCleanupMarkdown);
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
