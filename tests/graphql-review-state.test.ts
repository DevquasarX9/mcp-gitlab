import { describe, expect, it } from "vitest";

import { deriveGitLabGraphqlUrl } from "../src/gitlab/graphqlClient.js";
import {
  GitLabGraphQLError,
  buildUserFacingError,
  normalizeGitLabGraphQLError
} from "../src/gitlab/errors.js";
import { formatMergeRequestReviewStateMarkdown } from "../src/tools/output.js";
import { summarizeMergeRequestReviewState } from "../src/tools/reviewState.js";

describe("GitLab GraphQL helpers", () => {
  it("derives the GraphQL endpoint from the REST base URL", () => {
    expect(deriveGitLabGraphqlUrl("https://gitlab.com/api/v4"))
      .toBe("https://gitlab.com/api/graphql");
    expect(deriveGitLabGraphqlUrl("https://gitlab.example.com/gitlab/api/v4"))
      .toBe("https://gitlab.example.com/gitlab/api/graphql");
  });

  it("normalizes GraphQL query errors into a user-facing message", () => {
    const error = normalizeGitLabGraphQLError({
      endpoint: "https://gitlab.example.com/api/graphql",
      requestId: "graphql-123",
      errors: [
        { message: "Field 'foo' doesn't exist on type 'MergeRequest'" },
        { message: "Variable $iid is invalid" }
      ]
    });

    expect(error).toBeInstanceOf(GitLabGraphQLError);
    expect(buildUserFacingError(error))
      .toContain("Field 'foo' doesn't exist on type 'MergeRequest'");
    expect(buildUserFacingError(error)).toContain("Request ID: graphql-123.");
  });
});

describe("summarizeMergeRequestReviewState", () => {
  it("marks an open and cleared merge request as ready", () => {
    const summary = summarizeMergeRequestReviewState({
      iid: "12",
      title: "Ship feature",
      state: "opened",
      draft: false,
      webUrl: "https://gitlab.example.com/group/project/-/merge_requests/12",
      updatedAt: "2026-04-25T10:00:00Z",
      sourceBranch: "feature",
      targetBranch: "main",
      mergeable: true,
      mergeableDiscussionsState: true,
      detailedMergeStatus: "MERGEABLE",
      approvalsRequired: 2,
      approvalsLeft: 0,
      approved: true,
      resolvableDiscussionsCount: 3,
      resolvedDiscussionsCount: 3,
      reviewers: {
        nodes: [
          { username: "alice", name: "Alice", webUrl: "https://gitlab.example.com/alice" }
        ]
      },
      approvedBy: {
        nodes: [
          { username: "bob", name: "Bob", webUrl: "https://gitlab.example.com/bob" }
        ]
      },
      labels: {
        nodes: [
          { title: "backend" },
          { title: "release-blocker" }
        ]
      },
      diffStatsSummary: {
        additions: 20,
        deletions: 4,
        changes: 24,
        fileCount: 3
      },
      headPipeline: {
        id: "gid://gitlab/Ci::Pipeline/1",
        iid: "44",
        path: "/group/project/-/pipelines/44",
        status: "success",
        failedJobsCount: 0,
        ref: "feature",
        sha: "abc123",
        updatedAt: "2026-04-25T10:02:00Z",
        detailedStatus: {
          text: "passed",
          label: "passed",
          group: "success",
          icon: "status_success"
        }
      },
      discussions: {
        nodes: [
          { id: "d1", resolvable: true, resolved: true, resolvedAt: "2026-04-25T09:00:00Z" }
        ]
      }
    });

    expect(summary.review_status).toBe("ready");
    expect(summary.summary).toBe(
      "The merge request is ready based on sampled approvals, discussions, mergeability, and head pipeline signals."
    );
    expect(summary.confidence).toBe("medium");
    expect(summary.is_ready_for_merge).toBe(true);
    expect(summary.content_is_untrusted).toBe(true);
    expect(summary.blockers).toEqual([]);
    expect(summary.next_actions).toContain(
      "Proceed with the normal merge review process and confirm branch protection checks before merging."
    );
    expect(summary.reviewers).toHaveLength(1);
    expect((summary.approvals as Record<string, unknown>).approved_by).toHaveLength(1);
  });

  it("surfaces approval, pipeline, and discussion blockers", () => {
    const summary = summarizeMergeRequestReviewState({
      iid: "13",
      title: "Needs more work",
      state: "opened",
      draft: false,
      mergeable: false,
      mergeableDiscussionsState: false,
      detailedMergeStatus: "NOT_APPROVED",
      approvalsRequired: 2,
      approvalsLeft: 1,
      approved: false,
      resolvableDiscussionsCount: 4,
      resolvedDiscussionsCount: 1,
      headPipeline: {
        status: "failed",
        failedJobsCount: 2,
        detailedStatus: {
          text: "failed",
          label: "failed",
          group: "failed",
          icon: "status_failed"
        }
      },
      discussions: {
        nodes: [
          { id: "d1", resolvable: true, resolved: false },
          { id: "d2", resolvable: true, resolved: false }
        ]
      }
    });

    expect(summary.review_status).toBe("awaiting_approvals");
    expect(summary.summary).toBe(
      "The merge request is not ready yet based on sampled review, discussion, mergeability, or pipeline signals."
    );
    expect(summary.is_ready_for_merge).toBe(false);
    expect(summary.blockers).toContain("1 required approval(s) are still missing.");
    expect(summary.blockers).toContain("Head pipeline is failing.");
    expect(summary.blockers).toContain("3 resolvable discussion(s) remain unresolved.");
    expect(summary.blockers).toContain("GitLab merge status is NOT_APPROVED.");
    expect(summary.next_actions).toContain("Address the listed blockers before treating the merge request as ready.");
    expect(summary.next_actions).toContain("Request the remaining required approvals from eligible reviewers.");
    expect(summary.next_actions).toContain("Resolve or respond to the unresolved discussions that still block merge readiness.");
    expect(summary.next_actions).toContain("Restore the failing head pipeline before approval or merge decisions.");
  });

  it("renders review-state markdown", () => {
    const markdown = formatMergeRequestReviewStateMarkdown({
      project: {
        full_path: "group/project"
      },
      merge_request: {
        iid: "13",
        title: "Needs more work"
      },
      review_status: "awaiting_approvals",
      is_ready_for_merge: false,
      confidence: "medium",
      summary: "The merge request is not ready yet.",
      approvals: {
        approvals_left: 1
      },
      discussion_status: {
        unresolved_discussions_count: 3
      },
      diff_stats: {
        file_count: 4
      },
      head_pipeline: {
        status: "failed"
      },
      blockers: [
        "1 required approval(s) are still missing.",
        "Head pipeline is failing."
      ],
      warnings: [],
      next_actions: [
        "Request the remaining required approvals from eligible reviewers."
      ]
    });

    expect(markdown).toContain("# Merge Request Review State: !13");
    expect(markdown).toContain("Review status: awaiting_approvals");
    expect(markdown).toContain("Ready for merge: no");
    expect(markdown).toContain("Head pipeline is failing.");
    expect(markdown).toContain("Request the remaining required approvals from eligible reviewers.");
  });
});
