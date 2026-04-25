import { describe, expect, it } from "vitest";

import { summarizeProjectWriteRisk } from "../src/tools/governance.js";
import {
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
