import { describe, expect, it } from "vitest";

import { summarizeStaleMergeRequestCleanupAssessment } from "../src/tools/intelligence.js";
import { formatStaleMergeRequestCleanupMarkdown } from "../src/tools/output.js";

describe("summarizeStaleMergeRequestCleanupAssessment", () => {
  it("marks cleanup as needs_unblock when blocked stale merge requests exist", () => {
    const result = summarizeStaleMergeRequestCleanupAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      staleAfterDays: 14,
      staleMergeRequests: [
        {
          iid: 42,
          title: "Stalled rollout patch",
          detailed_merge_status: "not_approved",
          updated_at: "2026-04-01T10:00:00Z"
        }
      ],
      blockedStaleMergeRequests: [
        {
          iid: 42,
          title: "Stalled rollout patch",
          detailed_merge_status: "not_approved"
        }
      ],
      cleanupItems: [
        {
          merge_request: {
            iid: 42,
            title: "Stalled rollout patch"
          },
          unresolved_discussion_count: 0,
          latest_pipeline_status: "success",
          recommended_action: "unblock_review_state",
          reason: "The merge request is currently blocked by merge status \"not_approved\"."
        }
      ]
    });

    expect(result).toMatchObject({
      cleanup_status: "needs_unblock"
    });
    expect(result.next_actions).toContain(
      "Start with the blocked stale merge requests because they have a clear unblock path and release-risk implications."
    );
  });

  it("marks cleanup as needs_triage when stale drafts exist without hard blockers", () => {
    const result = summarizeStaleMergeRequestCleanupAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      staleAfterDays: 14,
      staleMergeRequests: [
        {
          iid: 11,
          title: "Draft: onboarding work",
          draft: true,
          updated_at: "2026-04-01T10:00:00Z"
        }
      ],
      blockedStaleMergeRequests: [],
      cleanupItems: [
        {
          merge_request: {
            iid: 11,
            title: "Draft: onboarding work"
          },
          unresolved_discussion_count: 0,
          latest_pipeline_status: null,
          recommended_action: "close_or_reassign",
          reason: "The merge request is still a draft and appears to have stalled without recent progress."
        }
      ]
    });

    expect(result).toMatchObject({
      cleanup_status: "needs_triage"
    });
    expect(result.warnings).toContain("1 stale merge requests are still drafts.");
  });

  it("marks cleanup as clean when no stale merge requests are present", () => {
    const result = summarizeStaleMergeRequestCleanupAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      staleAfterDays: 14,
      staleMergeRequests: [],
      blockedStaleMergeRequests: [],
      cleanupItems: []
    });

    expect(result).toMatchObject({
      cleanup_status: "clean"
    });
    expect(result.next_actions).toContain("No stale merge request cleanup is needed right now.");
  });
});

describe("formatStaleMergeRequestCleanupMarkdown", () => {
  it("renders a shareable stale merge request cleanup summary", () => {
    const markdown = formatStaleMergeRequestCleanupMarkdown({
      project: {
        path_with_namespace: "group/api"
      },
      cleanup_status: "needs_unblock",
      summary: "Several stale merge requests have explicit blockers and should be unblocked or closed before they continue to age.",
      stale_after_days: 14,
      next_actions: [
        "Start with the blocked stale merge requests because they have a clear unblock path and release-risk implications."
      ],
      signals: {
        stale_merge_request_count: 2,
        blocked_stale_merge_request_count: 1,
        draft_stale_merge_request_count: 1
      },
      cleanup_items: [
        {
          merge_request: {
            iid: 42,
            title: "Stalled rollout patch"
          },
          recommended_action: "unblock_review_state",
          reason: "The merge request is currently blocked by merge status \"not_approved\"."
        }
      ],
      highlights: {
        stale_merge_requests: [
          {
            iid: 42,
            title: "Stalled rollout patch"
          }
        ],
        blocked_stale_merge_requests: [
          {
            iid: 42,
            title: "Stalled rollout patch"
          }
        ]
      }
    });

    expect(markdown).toContain("# Stale Merge Request Cleanup: group/api");
    expect(markdown).toContain("Cleanup status: needs_unblock");
    expect(markdown).toContain("Stale merge request sample count: 2");
    expect(markdown).toContain("!42: Stalled rollout patch -> unblock_review_state");
  });
});
