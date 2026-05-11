import { describe, expect, it } from "vitest";

import {
  formatMergeRequestRiskMarkdown,
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
});
