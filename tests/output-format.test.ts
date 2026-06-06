import { describe, expect, it } from "vitest";

import {
  formatJobTraceMarkdown,
  formatMergeRequestRiskMarkdown,
  formatPipelineComparisonMarkdown,
  formatProjectDashboardMarkdown,
  outputFormatSchema,
  presentOutput
} from "../src/tools/output.js";
import { toolSuccess } from "../src/utils/result.js";

describe("output formatting", () => {
  it("keeps structured output as the default format", () => {
    expect(outputFormatSchema.parse(undefined)).toBe("structured");
    expect(outputFormatSchema.parse("markdown")).toBe("markdown");
  });

  it("uses markdown text content when a tool returns a presentation wrapper", () => {
    const result = toolSuccess(
      presentOutput("markdown", { key: "value" }, () => "# Shareable Summary")
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: "# Shareable Summary"
      }
    ]);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        key: "value"
      }
    });
  });

  it("renders a concise markdown dashboard summary", () => {
    const markdown = formatProjectDashboardMarkdown({
      dashboard_status: "needs_attention",
      project: {
        full_path: "group/api"
      },
      counts: {
        open_merge_requests: 3,
        open_issues: 7,
        recent_pipelines_total: 5
      },
      sample_insights: {
        merge_requests_needing_attention: 2,
        unassigned_issues: 1,
        overdue_issues: 1,
        failed_pipelines: 2
      },
      health_reasons: ["Recent pipeline sample includes failures."],
      highlights: {
        merge_requests_needing_attention: [{ iid: "12", title: "Refactor auth" }],
        failed_pipelines: [{ iid: "77", ref: "main", status: "failed" }],
        unassigned_issues: [{ reference: "#51", title: "Triage alert" }]
      }
    });

    expect(markdown).toContain("# Project Dashboard: group/api");
    expect(markdown).toContain("Dashboard status: needs_attention");
    expect(markdown).toContain("Recent pipeline sample includes failures.");
    expect(markdown).toContain("!12: Refactor auth");
    expect(markdown).toContain("main (failed)");
    expect(markdown).toContain("#51: Triage alert");
  });

  it("renders merge request risk summaries in markdown", () => {
    const markdown = formatMergeRequestRiskMarkdown({
      merge_request: {
        iid: "42",
        title: "Roll out new auth flow"
      },
      risk_level: "high",
      changed_file_count: 58,
      unresolved_discussion_count: 3,
      latest_pipeline: {
        status: "failed"
      },
      risks: ["Merge request has conflicts.", "Latest merge request pipeline is not successful."]
    });

    expect(markdown).toContain("# Merge Request Risk Review: !42");
    expect(markdown).toContain("Risk level: high");
    expect(markdown).toContain("Changed files: 58");
    expect(markdown).toContain("Merge request has conflicts.");
    expect(markdown).toContain("Latest merge request pipeline is not successful.");
  });

  it("renders pipeline comparison summaries in markdown", () => {
    const markdown = formatPipelineComparisonMarkdown({
      comparison_status: "changed",
      summary: "Compared pipelines 120 and 123: 1 added, 0 removed, 1 status changes, 1 duration changes.",
      left_pipeline: { id: 120 },
      right_pipeline: { id: 123 },
      signals: {
        added_job_count: 1,
        removed_job_count: 0,
        status_change_count: 1,
        duration_change_count: 1
      },
      comparison: {
        added_jobs: [{ stage: "deploy", name: "release", status: "success" }],
        removed_jobs: [],
        status_changes: [
          {
            stage: "test",
            name: "unit",
            left_status: "success",
            right_status: "failed"
          }
        ],
        duration_changes: [
          {
            stage: "test",
            name: "unit",
            left_duration_seconds: 10,
            right_duration_seconds: 12,
            delta_seconds: 2
          }
        ]
      },
      warnings: ["Only the first 100 non-retried jobs from each pipeline were compared."],
      next_actions: ["Review jobs with status changes before treating the newer pipeline as equivalent."]
    });

    expect(markdown).toContain("# Pipeline Comparison: 120 -> 123");
    expect(markdown).toContain("Comparison status: changed");
    expect(markdown).toContain("test/unit: success -> failed");
    expect(markdown).toContain("deploy/release (success)");
    expect(markdown).toContain("test/unit: 10s -> 12s (+2s)");
    expect(markdown).toContain("Only the first 100 non-retried jobs");
  });

  it("renders job trace context in markdown", () => {
    const markdown = formatJobTraceMarkdown({
      trace_status: "linked_to_merge_request",
      summary: "unit traced to pipeline 123 and commit abcdef12 with 1 related merge requests.",
      job: {
        id: 999,
        name: "unit"
      },
      pipeline: {
        id: 123
      },
      commit: {
        id: "abcdef123456",
        short_id: "abcdef12"
      },
      signals: {
        job_status: "failed",
        pipeline_status: "failed",
        related_merge_request_count: 1
      },
      merge_requests: [{ iid: 42, title: "Fix auth" }],
      warnings: [],
      next_actions: ["Inspect the related merge request before changing the pipeline or commit."]
    });

    expect(markdown).toContain("# Job Trace Context: unit");
    expect(markdown).toContain("Trace status: linked_to_merge_request");
    expect(markdown).toContain("Commit: abcdef12");
    expect(markdown).toContain("!42: Fix auth");
    expect(markdown).toContain("Inspect the related merge request");
  });
});
