import { describe, expect, it } from "vitest";

import { summarizeFlakyCiTriageAssessment } from "../src/tools/intelligence.js";
import { formatFlakyCiTriageMarkdown } from "../src/tools/output.js";

describe("summarizeFlakyCiTriageAssessment", () => {
  it("marks the triage as flaky_detected when oscillating jobs are present", () => {
    const result = summarizeFlakyCiTriageAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      ref: "main",
      lookbackPipelineCount: 8,
      failedPipelines: [
        {
          id: 101,
          status: "failed",
          ref: "main"
        }
      ],
      flakyJobs: [
        {
          name: "unit-tests",
          sample_count: 6,
          failure_count: 3,
          failure_rate: 0.5,
          recent_runs: []
        }
      ],
      representativePipelineComparison: {
        left_pipeline: {
          id: 100,
          status: "success"
        },
        right_pipeline: {
          id: 101,
          status: "failed"
        },
        comparison: {
          added_job_count: 0,
          removed_job_count: 0,
          status_change_count: 2,
          duration_change_count: 1
        }
      },
      flakyJobContexts: [
        {
          job: {
            name: "unit-tests"
          },
          trace_job_result: {
            commit: {
              id: "abc123"
            },
            merge_requests: [{ iid: 42 }]
          }
        }
      ]
    });

    expect(result).toMatchObject({
      triage_status: "flaky_detected"
    });
    expect(result.next_actions).toContain(
      "Triage the top oscillating jobs first and compare their last successful and failed runs."
    );
    expect(result.next_actions).toContain(
      "Use the representative pipeline comparison to isolate which jobs changed behavior between a passing and failing run."
    );
  });

  it("marks the triage as deterministic_failures_only when failures exist but no flaky signal exists", () => {
    const result = summarizeFlakyCiTriageAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      ref: "main",
      lookbackPipelineCount: 10,
      failedPipelines: [
        {
          id: 101,
          status: "failed"
        }
      ],
      flakyJobs: [],
      representativePipelineComparison: null,
      flakyJobContexts: []
    });

    expect(result).toMatchObject({
      triage_status: "deterministic_failures_only"
    });
    expect(result.summary).toContain("failed pipelines");
  });

  it("marks the triage as insufficient_data when pipeline history is too shallow", () => {
    const result = summarizeFlakyCiTriageAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      ref: "main",
      lookbackPipelineCount: 2,
      failedPipelines: [],
      flakyJobs: [],
      representativePipelineComparison: null,
      flakyJobContexts: []
    });

    expect(result).toMatchObject({
      triage_status: "insufficient_data"
    });
    expect(result.warnings).toContain(
      "Recent pipeline history is shallow, so the flaky-job signal is weak."
    );
  });
});

describe("formatFlakyCiTriageMarkdown", () => {
  it("renders a shareable flaky-ci summary", () => {
    const markdown = formatFlakyCiTriageMarkdown({
      project: {
        path_with_namespace: "group/api"
      },
      ref: "main",
      triage_status: "flaky_detected",
      summary: "Recent pipeline history shows jobs that oscillate between success and failure, which is a strong flaky CI signal.",
      next_actions: [
        "Triage the top oscillating jobs first and compare their last successful and failed runs."
      ],
      signals: {
        lookback_pipeline_count: 8,
        failed_pipeline_sample_count: 2,
        likely_flaky_job_count: 1,
        jobs_with_context_count: 1
      },
      highlights: {
        likely_flaky_jobs: [
          {
            name: "unit-tests",
            sample_count: 6,
            failure_count: 3,
            failure_rate: 0.5
          }
        ],
        failed_pipelines: [
          {
            ref: "main",
            status: "failed"
          }
        ]
      },
      representative_pipeline_comparison: {
        comparison: {
          status_change_count: 2,
          added_job_count: 1,
          removed_job_count: 0,
          duration_change_count: 1
        }
      }
    });

    expect(markdown).toContain("# Flaky CI Triage: group/api");
    expect(markdown).toContain("Triage status: flaky_detected");
    expect(markdown).toContain("unit-tests");
    expect(markdown).toContain("main (failed)");
    expect(markdown).toContain("status changes: 2");
  });
});
