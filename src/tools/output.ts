import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";

export const outputFormatSchema = z.enum(["structured", "markdown"]).optional().default("structured");

export type OutputFormat = z.infer<typeof outputFormatSchema>;

export interface ToolPresentation<T> {
  readonly __toolPresentation: true;
  readonly data: T;
  readonly contentText: string;
}

export function withPresentation<T>(data: T, contentText: string): ToolPresentation<T> {
  return {
    __toolPresentation: true,
    data,
    contentText
  };
}

export function isToolPresentation(value: unknown): value is ToolPresentation<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (value as { __toolPresentation?: unknown }).__toolPresentation === true;
}

export function presentOutput<T>(
  outputFormat: OutputFormat,
  data: T,
  renderMarkdown: (data: T) => string
): T | ToolPresentation<T> {
  if (outputFormat === "markdown") {
    return withPresentation(data, renderMarkdown(data));
  }

  return data;
}

function asMap(value: unknown): JsonMap {
  return typeof value === "object" && value !== null ? (value as JsonMap) : {};
}

function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = "n/a"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bulletList(items: readonly string[]): readonly string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

function renderPipelineCounts(counts: JsonMap): readonly string[] {
  const entries = Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `- ${status}: ${numberValue(count)}`);

  return entries.length > 0 ? entries : ["- none"];
}

function summarizePipeline(pipeline: JsonMap): string {
  const label = stringValue(pipeline.ref ?? pipeline.iid ?? pipeline.id, "pipeline");
  const status = stringValue(pipeline.status, "unknown");

  return `${label} (${status})`;
}

function summarizeIssue(issue: JsonMap): string {
  const reference = stringValue(issue.reference ?? issue.iid ?? issue.id, "issue");
  const title = stringValue(issue.title, "Untitled issue");

  return `${reference}: ${title}`;
}

function summarizeMergeRequest(mergeRequest: JsonMap): string {
  const iid = stringValue(mergeRequest.iid ?? mergeRequest.id, "mr");
  const title = stringValue(mergeRequest.title, "Untitled merge request");

  return `!${iid}: ${title}`;
}

function summarizeCommit(commit: JsonMap): string {
  const shortId = typeof commit.short_id === "string" && commit.short_id.length > 0
    ? `${commit.short_id} `
    : "";
  const title = stringValue(commit.title, "Untitled commit");

  return `${shortId}${title}`.trim();
}

function limitedList(items: readonly unknown[], render: (item: JsonMap) => string, limit = 10): readonly string[] {
  const mapped = items.slice(0, limit).map((item) => render(asMap(item)));

  if (items.length > limit) {
    return [...mapped, `...and ${items.length - limit} more`];
  }

  return mapped;
}

export function formatProjectStatusMarkdown(data: JsonMap): string {
  const project = asMap(data.project);
  const highlights = asMap(data.highlights);

  return [
    `# Project Status: ${stringValue(project.path_with_namespace ?? project.id, "unknown project")}`,
    "",
    `- Default branch: ${stringValue(project.default_branch)}`,
    `- Open issue sample: ${numberValue(data.open_issue_count_sample)}`,
    `- Open merge request sample: ${numberValue(data.open_merge_request_count_sample)}`,
    `- Stale merge request sample: ${numberValue(data.stale_merge_request_count_sample)}`,
    "",
    "## Recent Pipeline Status Counts",
    ...renderPipelineCounts(asMap(data.recent_pipeline_status_counts)),
    "",
    "## Failed Pipelines",
    ...bulletList(limitedList(asList(highlights.failed_pipelines), summarizePipeline, 5)),
    "",
    "## Stale Merge Requests",
    ...bulletList(limitedList(asList(highlights.stale_merge_requests), summarizeMergeRequest, 5)),
    "",
    "## Unassigned Issues",
    ...bulletList(limitedList(asList(highlights.unassigned_issues), summarizeIssue, 5))
  ].join("\n");
}

export function formatFailedPipelineMarkdown(data: JsonMap): string {
  const pipeline = asMap(data.pipeline);
  const failedJobs = asList(data.failed_jobs);

  const jobSections = failedJobs.length === 0
    ? ["- none"]
    : failedJobs.map((entry) => {
        const item = asMap(entry);
        const job = asMap(item.job);
        const traceTail = typeof item.trace_tail === "string" ? item.trace_tail.trim() : "";
        const lines = [
          `- ${stringValue(job.name, "unnamed job")} (${stringValue(job.status, "unknown")})`
        ];

        if (traceTail.length > 0) {
          lines.push("```text");
          lines.push(traceTail);
          lines.push("```");
        }

        return lines.join("\n");
      });

  return [
    `# Failed Pipeline: ${stringValue(pipeline.id ?? pipeline.iid, "unknown pipeline")}`,
    "",
    `- Ref: ${stringValue(pipeline.ref)}`,
    `- Status: ${stringValue(pipeline.status, "unknown")}`,
    `- SHA: ${stringValue(pipeline.sha)}`,
    `- Failed jobs: ${numberValue(data.failed_job_count)}`,
    `- Log content untrusted: ${data.content_is_untrusted === true ? "yes" : "no"}`,
    "",
    "## Failed Job Samples",
    ...jobSections
  ].join("\n");
}

export function formatMergeRequestRiskMarkdown(data: JsonMap): string {
  const mergeRequest = asMap(data.merge_request);
  const risks = asList(data.risks)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  const latestPipeline = asMap(data.latest_pipeline);

  return [
    `# Merge Request Risk Review: !${stringValue(mergeRequest.iid, "unknown")}`,
    "",
    `- Title: ${stringValue(mergeRequest.title, "Untitled merge request")}`,
    `- Risk level: ${stringValue(data.risk_level, "unknown")}`,
    `- Changed files: ${numberValue(data.changed_file_count)}`,
    `- Unresolved discussions: ${numberValue(data.unresolved_discussion_count)}`,
    `- Latest pipeline status: ${stringValue(latestPipeline.status, "unknown")}`,
    "",
    "## Risks",
    ...bulletList(risks.length > 0 ? risks : ["No major risks detected in the current heuristic review."])
  ].join("\n");
}

export function formatReleaseNotesMarkdown(data: JsonMap): string {
  const categories = asMap(data.categories);
  const features = asList(categories.features);
  const fixes = asList(categories.fixes);
  const chores = asList(categories.chores);
  const other = asList(categories.other);

  return [
    `# Draft Release Notes: ${stringValue(data.from_ref, "previous state")} -> ${stringValue(data.to_ref)}`,
    "",
    `- Commit sample count: ${numberValue(data.commit_count)}`,
    `- Content untrusted: ${data.content_is_untrusted === true ? "yes" : "no"}`,
    "",
    "## Features",
    ...bulletList(limitedList(features, summarizeCommit, 15)),
    "",
    "## Fixes",
    ...bulletList(limitedList(fixes, summarizeCommit, 15)),
    "",
    "## Chores",
    ...bulletList(limitedList(chores, summarizeCommit, 15)),
    "",
    "## Other",
    ...bulletList(limitedList(other, summarizeCommit, 15))
  ].join("\n");
}

export function formatReleaseReadinessMarkdown(data: JsonMap): string {
  const project = asMap(data.project);
  const signals = asMap(data.signals);
  const blockers = asList(data.blockers)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  const warnings = asList(data.warnings)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  const nextActions = asList(data.next_actions)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  const highlights = asMap(data.highlights);

  return [
    `# Release Readiness: ${stringValue(project.path_with_namespace ?? project.full_path ?? project.id, "unknown project")}`,
    "",
    `- Target ref: ${stringValue(data.target_ref)}`,
    `- Readiness status: ${stringValue(data.readiness_status, "unknown")}`,
    `- Summary: ${stringValue(data.summary, "n/a")}`,
    `- Latest pipeline status: ${stringValue(signals.latest_pipeline_status, "unknown")}`,
    `- Failed pipeline sample count: ${numberValue(signals.failed_pipeline_sample_count)}`,
    `- Blocked merge request sample count: ${numberValue(signals.blocked_merge_request_sample_count)}`,
    `- Unassigned issue sample count: ${numberValue(signals.unassigned_issue_sample_count)}`,
    `- Release compare commit count: ${numberValue(signals.release_note_commit_count)}`,
    "",
    "## Blockers",
    ...bulletList(blockers),
    "",
    "## Warnings",
    ...bulletList(warnings),
    "",
    "## Next Actions",
    ...bulletList(nextActions),
    "",
    "## Highlighted Blocked Merge Requests",
    ...bulletList(limitedList(asList(highlights.blocked_merge_requests), summarizeMergeRequest, 5)),
    "",
    "## Highlighted Failed Pipelines",
    ...bulletList(limitedList(asList(highlights.failed_pipelines), summarizePipeline, 5)),
    "",
    "## Highlighted Unassigned Issues",
    ...bulletList(limitedList(asList(highlights.unassigned_issues), summarizeIssue, 5))
  ].join("\n");
}

export function formatProjectDashboardMarkdown(data: JsonMap): string {
  const project = asMap(data.project);
  const counts = asMap(data.counts);
  const sampleInsights = asMap(data.sample_insights);
  const healthReasons = asList(data.health_reasons)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  const highlights = asMap(data.highlights);

  return [
    `# Project Dashboard: ${stringValue(project.full_path ?? project.name, "unknown project")}`,
    "",
    `- Dashboard status: ${stringValue(data.dashboard_status, "unknown")}`,
    `- Open merge requests: ${numberValue(counts.open_merge_requests)}`,
    `- Open issues: ${numberValue(counts.open_issues)}`,
    `- Recent pipelines sampled: ${numberValue(counts.recent_pipelines_total)}`,
    "",
    "## Health Reasons",
    ...bulletList(healthReasons.length > 0 ? healthReasons : ["No major health concerns in the sampled dashboard data."]),
    "",
    "## Attention Counts",
    ...bulletList([
      `merge requests needing attention: ${numberValue(sampleInsights.merge_requests_needing_attention)}`,
      `unassigned issues: ${numberValue(sampleInsights.unassigned_issues)}`,
      `overdue issues: ${numberValue(sampleInsights.overdue_issues)}`,
      `failed pipelines: ${numberValue(sampleInsights.failed_pipelines)}`
    ]),
    "",
    "## Highlighted Merge Requests",
    ...bulletList(limitedList(asList(highlights.merge_requests_needing_attention), summarizeMergeRequest, 5)),
    "",
    "## Highlighted Failed Pipelines",
    ...bulletList(limitedList(asList(highlights.failed_pipelines), summarizePipeline, 5)),
    "",
    "## Highlighted Unassigned Issues",
    ...bulletList(limitedList(asList(highlights.unassigned_issues), summarizeIssue, 5))
  ].join("\n");
}
