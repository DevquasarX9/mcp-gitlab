import { describe, expect, it } from "vitest";

import { summarizeTeamDeliveryDigestAssessment } from "../src/tools/intelligence.js";
import { formatTeamDeliveryDigestMarkdown } from "../src/tools/output.js";

describe("summarizeTeamDeliveryDigestAssessment", () => {
  it("marks a project digest as needs_attention when pipelines, merge requests, and issues need follow-up", () => {
    const result = summarizeTeamDeliveryDigestAssessment({
      scopeType: "project",
      scope: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      reportingWindowDays: 7,
      recentEventCount: 12,
      openMergeRequests: [
        {
          iid: 42,
          title: "Draft: rollout prep",
          draft: true
        }
      ],
      openIssues: [
        {
          iid: 7,
          title: "Triage alert",
          assignees: []
        }
      ],
      pipelineSignals: [
        {
          id: 101,
          ref: "main",
          status: "failed"
        },
        {
          id: 102,
          ref: "main",
          status: "running"
        }
      ]
    });

    expect(result).toMatchObject({
      digest_status: "needs_attention"
    });
    expect(result.chat_ready_summary).toContain("12 recent events in 7 days");
    expect(result.warnings).toContain("1 recent pipelines failed in the reporting window.");
    expect(result.next_actions).toContain(
      "Restore the failing project pipelines before broad delivery communication."
    );
  });

  it("marks a group digest as needs_attention when sampled projects and group work queues need follow-up", () => {
    const result = summarizeTeamDeliveryDigestAssessment({
      scopeType: "group",
      scope: {
        id: 2,
        name: "Platform",
        full_path: "group/platform"
      },
      reportingWindowDays: 7,
      openMergeRequests: [
        {
          iid: 99,
          title: "Blocked rollout",
          detailed_merge_status: "not_approved"
        }
      ],
      openIssues: [
        {
          iid: 8,
          title: "Ownership gap",
          assignees: []
        }
      ],
      sampledProjects: [
        {
          id: 11,
          path_with_namespace: "group/platform/api",
          latest_pipeline_status: "failed",
          attention_reason: "Latest sampled project pipeline is failing."
        }
      ]
    });

    expect(result).toMatchObject({
      digest_status: "needs_attention"
    });
    expect(result.chat_ready_summary).toContain("1 sampled projects needing attention");
    expect(result.warnings).toContain("1 sampled projects have a latest pipeline in failed state.");
    expect(result.next_actions).toContain("Start with the sampled projects whose latest pipelines are failing.");
  });

  it("marks a project digest as healthy when sampled signals are clean", () => {
    const result = summarizeTeamDeliveryDigestAssessment({
      scopeType: "project",
      scope: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      reportingWindowDays: 7,
      recentEventCount: 5,
      openMergeRequests: [],
      openIssues: [],
      pipelineSignals: [
        {
          id: 101,
          ref: "main",
          status: "success"
        }
      ]
    });

    expect(result).toMatchObject({
      digest_status: "healthy"
    });
    expect(result.next_actions).toContain("Share the digest and continue the current delivery cadence.");
  });
});

describe("formatTeamDeliveryDigestMarkdown", () => {
  it("renders a shareable digest summary", () => {
    const markdown = formatTeamDeliveryDigestMarkdown({
      scope_type: "project",
      scope: {
        path_with_namespace: "group/api"
      },
      reporting_window_days: 7,
      digest_status: "needs_attention",
      summary: "Delivery is active, but the current signals show concrete items that need follow-up before this is a clean status update.",
      chat_ready_summary: "group/api: 12 recent events in 7 days, 3 open MRs, 4 open issues, 1 failed pipelines, 1 MRs needing attention, 1 unassigned issues.",
      next_actions: [
        "Restore the failing project pipelines before broad delivery communication."
      ],
      signals: {
        open_merge_request_count: 3,
        merge_requests_needing_attention_count: 1,
        open_issue_count: 4,
        unassigned_issue_count: 1,
        failed_pipeline_signal_count: 1,
        running_pipeline_signal_count: 0
      },
      highlights: {
        merge_requests: [
          {
            iid: 42,
            title: "Draft: rollout prep"
          }
        ],
        issues: [
          {
            reference: "#7",
            title: "Triage alert"
          }
        ],
        failed_pipelines: [
          {
            ref: "main",
            status: "failed"
          }
        ],
        projects_needing_attention: []
      }
    });

    expect(markdown).toContain("# Team Delivery Digest: project group/api");
    expect(markdown).toContain("Digest status: needs_attention");
    expect(markdown).toContain("Chat-ready summary: group/api: 12 recent events in 7 days");
    expect(markdown).toContain("!42: Draft: rollout prep");
    expect(markdown).toContain("#7: Triage alert");
    expect(markdown).toContain("main (failed)");
  });
});
