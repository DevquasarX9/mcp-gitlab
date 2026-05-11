import { describe, expect, it } from "vitest";

import {
  categorizeReleaseCommits,
  summarizeReleaseReadinessAssessment
} from "../src/tools/intelligence.js";
import { formatReleaseReadinessMarkdown } from "../src/tools/output.js";

describe("categorizeReleaseCommits", () => {
  it("splits commits into release-note buckets", () => {
    const categories = categorizeReleaseCommits([
      { title: "feat: add onboarding" },
      { title: "fix: patch retry loop" },
      { title: "chore: bump deps" },
      { title: "docs: refresh README" }
    ]);

    expect(categories.features).toHaveLength(1);
    expect(categories.fixes).toHaveLength(1);
    expect(categories.chores).toHaveLength(1);
    expect(categories.other).toHaveLength(1);
  });
});

describe("summarizeReleaseReadinessAssessment", () => {
  it("returns hold when pipelines fail or merge requests are blocked", () => {
    const result = summarizeReleaseReadinessAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      targetRef: "main",
      latestPipeline: {
        id: 101,
        status: "failed",
        ref: "main"
      },
      failedPipelines: [
        {
          id: 101,
          status: "failed",
          ref: "main"
        }
      ],
      openMergeRequests: [
        {
          iid: 42,
          title: "Release patch",
          detailed_merge_status: "not_approved",
          updated_at: "2026-05-01T10:00:00Z"
        }
      ],
      staleMergeRequests: [],
      blockedMergeRequests: [
        {
          iid: 42,
          title: "Release patch",
          detailed_merge_status: "not_approved"
        }
      ],
      unassignedIssues: [],
      compareFromRef: "v1.2.0",
      compareCommitCount: 12,
      releaseCategories: categorizeReleaseCommits([{ title: "fix: patch retry loop" }])
    });

    expect(result).toMatchObject({
      readiness_status: "hold"
    });
    expect(result.blockers).toContain("Recent failed pipelines detected on main.");
    expect(result.blockers).toContain(
      "There are 1 blocked open merge requests targeting the release path."
    );
    expect(result.next_actions).toContain(
      "Investigate the recent failed pipelines on the target ref before releasing."
    );
  });

  it("returns caution when there are warnings but no hard blockers", () => {
    const result = summarizeReleaseReadinessAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      targetRef: "main",
      latestPipeline: {
        id: 202,
        status: "running",
        ref: "main"
      },
      failedPipelines: [],
      openMergeRequests: [
        {
          iid: 12,
          title: "Prepare rollout",
          updated_at: "2026-04-01T10:00:00Z"
        }
      ],
      staleMergeRequests: [
        {
          iid: 12,
          title: "Prepare rollout",
          updated_at: "2026-04-01T10:00:00Z"
        }
      ],
      blockedMergeRequests: [],
      unassignedIssues: [
        {
          iid: 51,
          title: "Triage alert"
        }
      ],
      compareFromRef: null,
      compareCommitCount: 64,
      releaseCategories: categorizeReleaseCommits([
        { title: "feat: add onboarding" },
        { title: "fix: patch retry loop" }
      ])
    });

    expect(result).toMatchObject({
      readiness_status: "caution"
    });
    expect(result.warnings).toContain("Latest pipeline on main is still running.");
    expect(result.warnings).toContain("There are 1 stale open merge requests.");
    expect(result.warnings).toContain("There are 1 unassigned open issues.");
    expect(result.warnings).toContain(
      "No previous release tag or explicit from_ref was available for release-note comparison."
    );
    expect(result.warnings).toContain(
      "The release compare includes 64 commits, which is a relatively large batch."
    );
  });

  it("returns go when sampled signals are clean", () => {
    const result = summarizeReleaseReadinessAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      targetRef: "main",
      latestPipeline: {
        id: 303,
        status: "success",
        ref: "main"
      },
      failedPipelines: [],
      openMergeRequests: [],
      staleMergeRequests: [],
      blockedMergeRequests: [],
      unassignedIssues: [],
      compareFromRef: "v1.2.0",
      compareCommitCount: 8,
      releaseCategories: categorizeReleaseCommits([
        { title: "feat: add onboarding" },
        { title: "fix: patch retry loop" }
      ])
    });

    expect(result).toMatchObject({
      readiness_status: "go"
    });
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.next_actions).toContain(
      "Proceed with final release validation and stakeholder communication."
    );
  });
});

describe("formatReleaseReadinessMarkdown", () => {
  it("renders a shareable markdown summary", () => {
    const markdown = formatReleaseReadinessMarkdown({
      project: {
        path_with_namespace: "group/api"
      },
      target_ref: "main",
      readiness_status: "caution",
      summary: "Release readiness looks plausible, but there are unresolved warnings that should be reviewed before proceeding.",
      blockers: [],
      warnings: ["Latest pipeline on main is still running."],
      next_actions: ["Wait for the latest pipeline to finish before making the final release decision."],
      signals: {
        latest_pipeline_status: "running",
        failed_pipeline_sample_count: 0,
        blocked_merge_request_sample_count: 0,
        unassigned_issue_sample_count: 1,
        release_note_commit_count: 24
      },
      highlights: {
        blocked_merge_requests: [],
        failed_pipelines: [],
        unassigned_issues: [{ reference: "#51", title: "Triage alert" }]
      }
    });

    expect(markdown).toContain("# Release Readiness: group/api");
    expect(markdown).toContain("Readiness status: caution");
    expect(markdown).toContain("Latest pipeline on main is still running.");
    expect(markdown).toContain("Wait for the latest pipeline to finish before making the final release decision.");
    expect(markdown).toContain("#51: Triage alert");
  });
});
