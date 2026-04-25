import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";
import { stripUnsafeText } from "../security/guards.js";
import {
  assertDeveloperAccess,
  assertMaintainerAccess,
  cleanQuery,
  registerTool,
  type ToolDeps
} from "./shared.js";

function redactVariables(
  variables: readonly JsonMap[],
  exposeValues: boolean
): readonly JsonMap[] {
  return variables.map((item) =>
    exposeValues
      ? item
      : {
          ...item,
          value: "[REDACTED]"
        }
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pipelineJobKey(job: JsonMap): string {
  const stage = asString(job.stage) ?? "unknown";
  const name = asString(job.name) ?? "unnamed";
  return `${stage}:${name}`;
}

function classifyJobOutcome(status: string | null): "success" | "failure" | null {
  if (status === "success") {
    return "success";
  }

  if (status === "failed" || status === "canceled") {
    return "failure";
  }

  return null;
}

export function detectFlakyJobs(
  runs: readonly JsonMap[],
  minSamples: number
): readonly JsonMap[] {
  const byName = new Map<string, JsonMap[]>();

  for (const run of runs) {
    const name = asString(run.name);
    if (!name) {
      continue;
    }

    const current = byName.get(name) ?? [];
    current.push(run);
    byName.set(name, current);
  }

  const flakyJobs: JsonMap[] = [];

  for (const [name, jobRuns] of byName.entries()) {
    if (jobRuns.length < minSamples) {
      continue;
    }

    const chronological = [...jobRuns].sort((left, right) => {
      const leftId = asNumber(left.pipeline_id) ?? 0;
      const rightId = asNumber(right.pipeline_id) ?? 0;
      return leftId - rightId;
    });

    let successCount = 0;
    let failureCount = 0;
    let transitions = 0;
    let previousOutcome: "success" | "failure" | null = null;

    for (const run of chronological) {
      const outcome = classifyJobOutcome(asString(run.status));

      if (outcome === "success") {
        successCount += 1;
      } else if (outcome === "failure") {
        failureCount += 1;
      }

      if (outcome !== null && previousOutcome !== null && outcome !== previousOutcome) {
        transitions += 1;
      }

      if (outcome !== null) {
        previousOutcome = outcome;
      }
    }

    if (successCount > 0 && failureCount > 0 && transitions > 0) {
      flakyJobs.push({
        name,
        sample_count: chronological.length,
        success_count: successCount,
        failure_count: failureCount,
        transition_count: transitions,
        failure_rate: Number((failureCount / chronological.length).toFixed(3)),
        recent_runs: chronological.slice(-10)
      });
    }
  }

  return flakyJobs.sort((left, right) => {
    const transitionDelta =
      (asNumber(right.transition_count) ?? 0) - (asNumber(left.transition_count) ?? 0);

    if (transitionDelta !== 0) {
      return transitionDelta;
    }

    return (asNumber(right.failure_count) ?? 0) - (asNumber(left.failure_count) ?? 0);
  });
}

export function comparePipelineJobSets(
  leftJobs: readonly JsonMap[],
  rightJobs: readonly JsonMap[]
): JsonMap {
  const leftMap = new Map(leftJobs.map((job) => [pipelineJobKey(job), job]));
  const rightMap = new Map(rightJobs.map((job) => [pipelineJobKey(job), job]));

  const addedJobs: JsonMap[] = [];
  const removedJobs: JsonMap[] = [];
  const statusChanges: JsonMap[] = [];
  const durationChanges: JsonMap[] = [];

  for (const [key, rightJob] of rightMap.entries()) {
    const leftJob = leftMap.get(key);

    if (!leftJob) {
      addedJobs.push(rightJob);
      continue;
    }

    if (leftJob.status !== rightJob.status) {
      statusChanges.push({
        key,
        name: rightJob.name,
        stage: rightJob.stage,
        left_status: leftJob.status,
        right_status: rightJob.status
      });
    }

    const leftDuration = asNumber(leftJob.duration);
    const rightDuration = asNumber(rightJob.duration);
    if (leftDuration !== null && rightDuration !== null && leftDuration !== rightDuration) {
      durationChanges.push({
        key,
        name: rightJob.name,
        stage: rightJob.stage,
        left_duration_seconds: leftDuration,
        right_duration_seconds: rightDuration,
        delta_seconds: Number((rightDuration - leftDuration).toFixed(3))
      });
    }
  }

  for (const [key, leftJob] of leftMap.entries()) {
    if (!rightMap.has(key)) {
      removedJobs.push(leftJob);
    }
  }

  return {
    added_jobs: addedJobs,
    removed_jobs: removedJobs,
    status_changes: statusChanges,
    duration_changes: durationChanges
  };
}

export function registerPipelineTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_list_pipelines",
    title: "List Pipelines",
    description: "List pipelines for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      status: z.string().trim().optional(),
      ref: z.string().trim().optional(),
      source: z.string().trim().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines`,
        {
          query: cleanQuery({
            status: args.status,
            ref: args.ref,
            source: args.source,
            page: args.page,
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
    name: "gitlab_get_pipeline",
    title: "Get Pipeline",
    description: "Retrieve a single pipeline by ID.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_list_pipeline_jobs",
    title: "List Pipeline Jobs",
    description: "List jobs for a specific pipeline.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive(),
      include_retried: z.boolean().optional(),
      scope: z.array(z.string().trim().min(1)).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}/jobs`,
        {
          query: cleanQuery({
            include_retried: args.include_retried,
            scope: args.scope,
            page: args.page,
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
    name: "gitlab_get_job",
    title: "Get Job",
    description: "Retrieve a single CI/CD job by ID.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      job_id: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/jobs/${args.job_id}`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_get_job_trace",
    title: "Get Job Trace",
    description:
      "Return the job trace text. Job output is untrusted and trimmed to a caller-specified tail length.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      job_id: z.number().int().positive(),
      tail_lines: z.number().int().positive().max(500).optional().default(120)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<string>(
        `/projects/${encodeURIComponent(args.project_id)}/jobs/${args.job_id}/trace`
      );

      const traceText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      const lines = traceText.split("\n");

      return {
        content_is_untrusted: true,
        total_lines: lines.length,
        tail_lines: args.tail_lines,
        trace_tail: stripUnsafeText(lines.slice(-args.tail_lines).join("\n"), 24_000)
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_retry_job",
    title: "Retry Job",
    description: "Retry a failed or canceled job.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      job_id: z.number().int().positive()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/jobs/${args.job_id}/retry`
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/jobs/${args.job_id}/retry`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_cancel_pipeline",
    title: "Cancel Pipeline",
    description:
      "Cancel a running pipeline. This is treated as destructive and requires confirm_destructive=true.",
    safety: "destructive",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive(),
      confirm_destructive: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/pipelines/${args.pipeline_id}/cancel`
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}/cancel`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_trigger_pipeline",
    title: "Trigger Pipeline",
    description: "Create a new pipeline on a branch or tag.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      ref: z.string().trim().min(1),
      variables: z
        .array(
          z.object({
            key: z.string().trim().min(1),
            value: z.string(),
            variable_type: z.enum(["env_var", "file"]).optional()
          })
        )
        .optional(),
      inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        ref: args.ref,
        variables: args.variables,
        inputs: args.inputs
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/pipeline`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/pipeline`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_list_project_variables",
    title: "List Project Variables",
    description:
      "List CI/CD variables for a project. Secret values are redacted unless EXPOSE_SECRET_VARIABLE_VALUES=true.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertMaintainerAccess(project);

      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/variables`,
        {
          query: cleanQuery({
            page: args.page,
            per_page: args.per_page
          })
        }
      );

      return {
        items: redactVariables(response.data, config.exposeSecretVariableValues),
        pagination: response.pagination,
        secret_values_redacted: !config.exposeSecretVariableValues
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_pipeline_failed_jobs_summary",
    title: "Get Pipeline Failed Jobs Summary",
    description:
      "Summarize failed jobs in a pipeline, including stages, failure reasons, and short trace tails.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive(),
      include_trace_tail: z.boolean().optional().default(true),
      trace_tail_lines: z.number().int().positive().max(120).optional().default(30),
      max_jobs: z.number().int().positive().max(20).optional().default(8)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

      const [pipelineResponse, jobsResponse] = await Promise.all([
        client.getJson<JsonMap>(
          `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}`
        ),
        client.getJson<JsonMap[]>(
          `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}/jobs`,
          {
            query: {
              scope: ["failed"],
              include_retried: true,
              per_page: 100
            }
          }
        )
      ]);

      const failedJobs = jobsResponse.data;
      const stageCounts: Record<string, number> = {};
      const failureReasonCounts: Record<string, number> = {};

      for (const job of failedJobs) {
        const stage = asString(job.stage) ?? "unknown";
        const failureReason = asString(job.failure_reason) ?? "unknown";
        stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
        failureReasonCounts[failureReason] = (failureReasonCounts[failureReason] ?? 0) + 1;
      }

      const selectedJobs = failedJobs.slice(0, args.max_jobs);
      const failedJobSummaries = await Promise.all(
        selectedJobs.map(async (job) => {
          const jobId = asNumber(job.id);
          const summary: JsonMap = {
            id: job.id,
            name: job.name,
            stage: job.stage,
            status: job.status,
            failure_reason: job.failure_reason,
            web_url: job.web_url
          };

          if (!args.include_trace_tail || jobId === null) {
            return summary;
          }

          const traceResponse = await client.getJson<string>(
            `/projects/${encodeURIComponent(args.project_id)}/jobs/${jobId}/trace`
          );
          const traceText =
            typeof traceResponse.data === "string"
              ? traceResponse.data
              : JSON.stringify(traceResponse.data);

          return {
            ...summary,
            trace_tail: stripUnsafeText(
              traceText.split("\n").slice(-args.trace_tail_lines).join("\n"),
              12_000
            )
          };
        })
      );

      return {
        pipeline: pipelineResponse.data,
        failed_job_count: failedJobs.length,
        failed_stage_counts: stageCounts,
        failure_reason_counts: failureReasonCounts,
        failed_jobs: failedJobSummaries,
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_flaky_jobs",
    title: "Find Flaky Jobs",
    description:
      "Inspect recent pipeline history and identify jobs that oscillate between success and failure.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      ref: z.string().trim().optional(),
      lookback_pipelines: z.number().int().positive().max(25).optional().default(12),
      min_samples: z.number().int().positive().max(20).optional().default(3)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

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
      const pipelineJobs = await Promise.all(
        pipelines.map(async (pipeline) => {
          const pipelineId = asNumber(pipeline.id);
          if (pipelineId === null) {
            return [];
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

          return response.data.map((job) => ({
            ...job,
            pipeline_id: pipelineId,
            pipeline_status: pipeline.status,
            pipeline_ref: pipeline.ref
          }));
        })
      );

      const flakyJobs = detectFlakyJobs(pipelineJobs.flat(), args.min_samples);

      return {
        lookback_pipeline_count: pipelines.length,
        items: flakyJobs
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_compare_pipeline_runs",
    title: "Compare Pipeline Runs",
    description:
      "Compare two pipeline runs and highlight added, removed, or changed jobs.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      left_pipeline_id: z.number().int().positive(),
      right_pipeline_id: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

      const [leftPipeline, rightPipeline, leftJobs, rightJobs] = await Promise.all([
        client.getJson<JsonMap>(
          `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.left_pipeline_id}`
        ),
        client.getJson<JsonMap>(
          `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.right_pipeline_id}`
        ),
        client.getJson<JsonMap[]>(
          `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.left_pipeline_id}/jobs`,
          {
            query: {
              include_retried: false,
              per_page: 100
            }
          }
        ),
        client.getJson<JsonMap[]>(
          `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.right_pipeline_id}/jobs`,
          {
            query: {
              include_retried: false,
              per_page: 100
            }
          }
        )
      ]);

      return {
        left_pipeline: leftPipeline.data,
        right_pipeline: rightPipeline.data,
        comparison: comparePipelineJobSets(leftJobs.data, rightJobs.data)
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_pipeline_artifacts",
    title: "Get Pipeline Artifacts",
    description:
      "Summarize artifacts produced by jobs in a pipeline and optionally browse artifact trees for a bounded number of jobs.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive(),
      include_archive_tree: z.boolean().optional().default(false),
      recursive: z.boolean().optional().default(false),
      path: z.string().trim().optional(),
      max_jobs_with_tree: z.number().int().positive().max(10).optional().default(3),
      tree_per_job: z.number().int().positive().max(100).optional().default(50)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

      const jobsResponse = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}/jobs`,
        {
          query: {
            include_retried: true,
            per_page: 100
          }
        }
      );

      const artifactJobs = jobsResponse.data.filter((job) => {
        const artifactsFile = job.artifacts_file as JsonMap | undefined;
        const filename = artifactsFile ? asString(artifactsFile.filename) : null;
        const artifacts = Array.isArray(job.artifacts) ? job.artifacts : [];
        return filename !== null || artifacts.length > 0;
      });

      const artifactSummaries = await Promise.all(
        artifactJobs.map(async (job, index) => {
          const artifactsFile = (job.artifacts_file as JsonMap | undefined) ?? null;
          const summary: JsonMap = {
            id: job.id,
            name: job.name,
            stage: job.stage,
            status: job.status,
            web_url: job.web_url,
            artifacts_file: artifactsFile,
            artifacts: Array.isArray(job.artifacts) ? job.artifacts : [],
            artifacts_expire_at: job.artifacts_expire_at
          };

          const jobId = asNumber(job.id);
          if (!args.include_archive_tree || jobId === null || index >= args.max_jobs_with_tree) {
            return summary;
          }

          const treeResponse = await client.getJson<JsonMap[]>(
            `/projects/${encodeURIComponent(args.project_id)}/jobs/${jobId}/artifacts/tree`,
            {
              query: cleanQuery({
                path: args.path,
                recursive: args.recursive,
                per_page: args.tree_per_job
              })
            }
          );

          return {
            ...summary,
            artifact_tree: treeResponse.data,
            artifact_tree_pagination: treeResponse.pagination
          };
        })
      );

      return {
        pipeline_id: args.pipeline_id,
        artifact_job_count: artifactJobs.length,
        items: artifactSummaries
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_trace_job_to_commit_and_merge_request",
    title: "Trace Job To Commit And Merge Request",
    description:
      "Trace a CI job to its commit, pipeline, and associated merge requests for debugging context.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      job_id: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

      const jobResponse = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/jobs/${args.job_id}`
      );

      const job = jobResponse.data;
      const commit = (job.commit as JsonMap | undefined) ?? null;
      const commitSha = commit ? asString(commit.id) : null;
      const pipeline = (job.pipeline as JsonMap | undefined) ?? null;
      const pipelineId = pipeline ? asNumber(pipeline.id) : null;

      const [pipelineDetails, mergeRequests] = await Promise.all([
        pipelineId === null
          ? Promise.resolve(null)
          : client
              .getJson<JsonMap>(
                `/projects/${encodeURIComponent(args.project_id)}/pipelines/${pipelineId}`
              )
              .then((response) => response.data),
        commitSha === null
          ? Promise.resolve([])
          : client
              .getJson<JsonMap[]>(
                `/projects/${encodeURIComponent(args.project_id)}/repository/commits/${encodeURIComponent(commitSha)}/merge_requests`,
                {
                  query: {
                    state: "all"
                  }
                }
              )
              .then((response) => response.data)
      ]);

      return {
        job,
        pipeline: pipelineDetails,
        commit,
        merge_requests: mergeRequests
      };
    }
  });
}
