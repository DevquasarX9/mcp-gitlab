import { describe, expect, it } from "vitest";

import {
  summarizePortfolioDeliveryOverviewAssessment,
  summarizePortfolioProjectAssessment
} from "../src/tools/intelligence.js";
import { formatPortfolioDeliveryOverviewMarkdown } from "../src/tools/output.js";

describe("summarizePortfolioProjectAssessment", () => {
  it("marks a project as needs_attention when pipelines, stale merge requests, and unassigned issues exist", () => {
    const result = summarizePortfolioProjectAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      staleAfterDays: 14,
      openMergeRequests: [
        {
          iid: 42,
          title: "Blocked rollout",
          detailed_merge_status: "not_approved",
          updated_at: "2026-04-01T10:00:00Z"
        }
      ],
      openIssues: [
        {
          iid: 7,
          title: "Ownership gap",
          assignees: []
        }
      ],
      pipelineSignals: [
        {
          id: 101,
          ref: "main",
          status: "failed"
        }
      ]
    });

    expect(result).toMatchObject({
      delivery_status: "needs_attention"
    });
    expect(result.attention_reasons).toContain("Recent pipeline sample includes failures.");
    expect(result.attention_reasons).toContain("Open merge request sample includes blocked items.");
    expect(result.attention_reasons).toContain("Open merge request sample includes stale items.");
    expect(result.attention_reasons).toContain("Open issue sample includes unassigned issues.");
  });
});

describe("summarizePortfolioDeliveryOverviewAssessment", () => {
  it("marks the portfolio as needs_attention when hotspot projects are present", () => {
    const result = summarizePortfolioDeliveryOverviewAssessment({
      scopeType: "group",
      scope: {
        id: 2,
        name: "Platform",
        full_path: "group/platform"
      },
      staleAfterDays: 14,
      projectSummaries: [
        {
          project: {
            id: 1,
            path_with_namespace: "group/platform/api"
          },
          delivery_status: "needs_attention",
          latest_pipeline_status: "failed",
          attention_score: 7,
          counts: {
            blocked_merge_requests: 1,
            stale_merge_requests: 1,
            unassigned_issues: 1,
            failed_pipelines: 1
          },
          attention_reasons: ["Recent pipeline sample includes failures."]
        },
        {
          project: {
            id: 2,
            path_with_namespace: "group/platform/web"
          },
          delivery_status: "watch",
          latest_pipeline_status: "running",
          attention_score: 1,
          counts: {
            blocked_merge_requests: 0,
            stale_merge_requests: 0,
            unassigned_issues: 0,
            failed_pipelines: 0
          },
          attention_reasons: []
        }
      ]
    });

    expect(result).toMatchObject({
      portfolio_status: "needs_attention"
    });
    expect(result.chat_ready_summary).toContain("2 projects sampled");
    expect(result.next_actions).toContain(
      "Start with the highest-risk projects in the portfolio before broad status reporting."
    );
    expect(result.signals).toMatchObject({
      projects_needing_attention_count: 1,
      projects_on_watch_count: 1,
      failed_pipeline_signal_count: 1,
      blocked_merge_request_count: 1
    });
  });

  it("marks the portfolio as healthy when sampled projects are clean", () => {
    const result = summarizePortfolioDeliveryOverviewAssessment({
      scopeType: "projects",
      scope: {
        name: "selected projects",
        project_ids: ["group/api", "group/web"]
      },
      staleAfterDays: 14,
      projectSummaries: [
        {
          project: {
            id: 1,
            path_with_namespace: "group/api"
          },
          delivery_status: "healthy",
          latest_pipeline_status: "success",
          attention_score: 0,
          counts: {
            blocked_merge_requests: 0,
            stale_merge_requests: 0,
            unassigned_issues: 0,
            failed_pipelines: 0
          },
          attention_reasons: []
        }
      ]
    });

    expect(result).toMatchObject({
      portfolio_status: "healthy"
    });
    expect(result.next_actions).toContain("Share the portfolio summary and keep monitoring the sampled projects.");
  });
});

describe("formatPortfolioDeliveryOverviewMarkdown", () => {
  it("renders a shareable cross-project overview", () => {
    const markdown = formatPortfolioDeliveryOverviewMarkdown({
      scope_type: "group",
      scope: {
        full_path: "group/platform"
      },
      portfolio_status: "needs_attention",
      summary: "The sampled portfolio includes projects with concrete delivery risks that should be addressed before this is treated as a clean group status.",
      chat_ready_summary: "group/platform: 2 projects sampled, 1 needing attention, 1 on watch, 1 failed pipeline signals, 1 blocked MRs, 1 stale MRs, 1 unassigned issues.",
      next_actions: [
        "Start with the highest-risk projects in the portfolio before broad status reporting."
      ],
      signals: {
        project_count: 2,
        projects_needing_attention_count: 1,
        projects_on_watch_count: 1,
        failed_pipeline_signal_count: 1,
        blocked_merge_request_count: 1,
        stale_merge_request_count: 1,
        unassigned_issue_count: 1
      },
      project_summaries: [
        {
          project: {
            path_with_namespace: "group/platform/api"
          },
          delivery_status: "needs_attention",
          latest_pipeline_status: "failed",
          attention_reasons: ["Recent pipeline sample includes failures."]
        }
      ],
      highlights: {
        top_risk_projects: [
          {
            project: {
              path_with_namespace: "group/platform/api"
            },
            delivery_status: "needs_attention",
            latest_pipeline_status: "failed",
            attention_reasons: ["Recent pipeline sample includes failures."]
          }
        ]
      }
    });

    expect(markdown).toContain("# Portfolio Delivery Overview: group group/platform");
    expect(markdown).toContain("Portfolio status: needs_attention");
    expect(markdown).toContain("Chat-ready summary: group/platform: 2 projects sampled");
    expect(markdown).toContain("group/platform/api [needs_attention] (failed) - Recent pipeline sample includes failures.");
  });
});
