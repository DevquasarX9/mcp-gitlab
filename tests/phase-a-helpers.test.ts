import { describe, expect, it } from "vitest";

import { summarizeProjectWriteRisk } from "../src/tools/governance.js";
import {
  buildJobTraceContextResult,
  buildPipelineComparisonResult,
  comparePipelineJobSets,
  detectFlakyJobs
} from "../src/tools/pipelines.js";
import { findResolvableDiscussionNoteId } from "../src/tools/mergeRequests.js";

describe("Phase A helper logic", () => {
  it("finds the latest resolvable discussion note", () => {
    const noteId = findResolvableDiscussionNoteId({
      notes: [
        { id: 10, resolvable: false },
        { id: 11, resolvable: true },
        { id: 12, resolvable: true }
      ]
    });

    expect(noteId).toBe(12);
  });

  it("detects flaky jobs from alternating outcomes", () => {
    const flakyJobs = detectFlakyJobs(
      [
        { name: "unit", status: "success", pipeline_id: 1 },
        { name: "unit", status: "failed", pipeline_id: 2 },
        { name: "unit", status: "success", pipeline_id: 3 },
        { name: "lint", status: "success", pipeline_id: 1 },
        { name: "lint", status: "success", pipeline_id: 2 },
        { name: "lint", status: "success", pipeline_id: 3 }
      ],
      3
    );

    expect(flakyJobs).toHaveLength(1);
    expect(flakyJobs[0]?.name).toBe("unit");
    expect(flakyJobs[0]?.transition_count).toBe(2);
  });

  it("compares pipeline job sets by added, removed, and status changes", () => {
    const comparison = comparePipelineJobSets(
      [
        { stage: "test", name: "unit", status: "success", duration: 10 },
        { stage: "test", name: "lint", status: "success", duration: 5 }
      ],
      [
        { stage: "test", name: "unit", status: "failed", duration: 12 },
        { stage: "deploy", name: "release", status: "success", duration: 20 }
      ]
    );

    expect(comparison.status_changes).toHaveLength(1);
    expect(comparison.added_jobs).toHaveLength(1);
    expect(comparison.removed_jobs).toHaveLength(1);
    expect(comparison.duration_changes).toHaveLength(1);
  });

  it("summarizes pipeline comparison metadata and pagination warnings", () => {
    const result = buildPipelineComparisonResult({
      leftPipeline: { id: 120, web_url: "https://gitlab.example/pipelines/120" },
      rightPipeline: { id: 123, web_url: "https://gitlab.example/pipelines/123" },
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
        duration_changes: []
      },
      leftJobSampleCount: 100,
      rightJobSampleCount: 100,
      leftHasMoreJobs: true,
      rightHasMoreJobs: false
    });

    expect(result.comparison_status).toBe("changed");
    expect(result.confidence).toBe("medium");
    expect(result.summary).toContain("1 added, 0 removed, 1 status changes");
    expect(result.warnings).toContain("Only the first 100 non-retried jobs from each pipeline were compared.");
    expect(result.signals).toMatchObject({
      left_job_sample_count: 100,
      added_job_count: 1,
      status_change_count: 1
    });
  });

  it("summarizes job trace context with related merge request signals", () => {
    const result = buildJobTraceContextResult({
      job: {
        id: 999,
        name: "unit",
        status: "failed",
        web_url: "https://gitlab.example/jobs/999"
      },
      pipeline: {
        id: 123,
        status: "failed",
        web_url: "https://gitlab.example/pipelines/123"
      },
      commit: {
        id: "abcdef123456",
        short_id: "abcdef12",
        web_url: "https://gitlab.example/commit/abcdef123456"
      },
      mergeRequests: [
        {
          iid: 42,
          title: "Fix auth",
          web_url: "https://gitlab.example/merge_requests/42"
        }
      ]
    });

    expect(result.trace_status).toBe("linked_to_merge_request");
    expect(result.summary).toContain("unit traced to pipeline 123");
    expect(result.signals).toMatchObject({
      job_id: 999,
      job_status: "failed",
      pipeline_status: "failed",
      related_merge_request_count: 1
    });
    expect(result.next_actions).toContain("Inspect the related merge request before changing the pipeline or commit.");
  });

  it("assesses write risk using branch protection and approvals", () => {
    const assessment = summarizeProjectWriteRisk({
      project: {
        default_branch: "main",
        archived: false
      },
      protectedBranches: [
        {
          name: "main",
          allow_force_push: false,
          code_owner_approval_required: true
        }
      ],
      approvalConfig: {
        reset_approvals_on_push: true,
        require_reauthentication_to_approve: true,
        merge_requests_author_approval: false
      },
      approvalRules: [
        { approvals_required: 2 }
      ]
    });

    expect(assessment.risk_level).toBe("low");
    expect(assessment.concerns).toEqual([]);
    expect(assessment.protections).toContain(
      "Target branch is protected by rule main."
    );
  });

  it("raises risk when target branch is unprotected and author approvals are allowed", () => {
    const assessment = summarizeProjectWriteRisk({
      project: {
        default_branch: "main",
        archived: false
      },
      protectedBranches: [],
      approvalConfig: {
        merge_requests_author_approval: true
      },
      approvalRules: []
    });

    expect(assessment.risk_level).toBe("high");
    expect(assessment.concerns).toContain("Target branch is not protected.");
    expect(assessment.concerns).toContain(
      "Authors can approve their own merge requests."
    );
  });
});
