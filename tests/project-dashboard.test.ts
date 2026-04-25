import { describe, expect, it } from "vitest";

import { isBlockedMergeStatus } from "../src/tools/intelligence.js";
import { summarizeProjectDashboard } from "../src/tools/projectDashboard.js";

describe("isBlockedMergeStatus", () => {
  it("treats GraphQL-style uppercase merge statuses as blocked statuses", () => {
    expect(isBlockedMergeStatus("DISCUSSIONS_NOT_RESOLVED")).toBe(true);
    expect(isBlockedMergeStatus("not_approved")).toBe(true);
    expect(isBlockedMergeStatus("MERGEABLE")).toBe(false);
  });
});

describe("summarizeProjectDashboard", () => {
  it("marks a clean active project as healthy", () => {
    const summary = summarizeProjectDashboard({
      id: "gid://gitlab/Project/1",
      name: "api",
      fullPath: "group/api",
      webUrl: "https://gitlab.example.com/group/api",
      description: "API service",
      archived: false,
      visibility: "private",
      lastActivityAt: "2026-04-25T09:00:00Z",
      repository: {
        rootRef: "main",
        empty: false
      },
      mergeRequests: {
        count: 1,
        nodes: [
          {
            iid: "11",
            title: "Refactor auth",
            webUrl: "https://gitlab.example.com/group/api/-/merge_requests/11",
            draft: false,
            updatedAt: "2026-04-25T08:00:00Z",
            detailedMergeStatus: "MERGEABLE",
            approvalsLeft: 0,
            headPipeline: {
              status: "SUCCESS",
              detailedStatus: {
                text: "Passed",
                label: "passed",
                group: "success",
                icon: "status_success"
              }
            }
          }
        ]
      },
      issues: {
        count: 1,
        nodes: [
          {
            iid: "21",
            title: "Document rollout",
            reference: "#21",
            webUrl: "https://gitlab.example.com/group/api/-/issues/21",
            dueDate: "2099-12-01",
            updatedAt: "2026-04-25T07:00:00Z",
            assignees: {
              nodes: [
                {
                  username: "alice",
                  name: "Alice",
                  webUrl: "https://gitlab.example.com/alice"
                }
              ]
            }
          }
        ]
      },
      pipelines: {
        count: 3,
        nodes: [
          {
            iid: "31",
            path: "/group/api/-/pipelines/31",
            status: "SUCCESS",
            ref: "main",
            sha: "abc123",
            updatedAt: "2026-04-25T09:10:00Z",
            detailedStatus: {
              text: "Passed",
              label: "passed",
              group: "success",
              icon: "status_success"
            }
          }
        ]
      }
    });

    expect(summary.dashboard_status).toBe("healthy");
    expect(summary.health_reasons).toEqual([]);
    expect(summary.sample_insights).toMatchObject({
      merge_requests_needing_attention: 0,
      failed_pipelines: 0,
      unassigned_issues: 0
    });
    expect((summary.samples as Record<string, unknown>).issues).toEqual([
      expect.objectContaining({
        reference: "#21",
        project_path: "group/api"
      })
    ]);
  });

  it("marks a project as needing attention when the samples include review, issue, and pipeline problems", () => {
    const summary = summarizeProjectDashboard({
      id: "gid://gitlab/Project/2",
      name: "web",
      fullPath: "group/web",
      webUrl: "https://gitlab.example.com/group/web",
      archived: false,
      visibility: "private",
      lastActivityAt: "2026-04-25T09:00:00Z",
      repository: {
        rootRef: "main",
        empty: false
      },
      mergeRequests: {
        count: 2,
        nodes: [
          {
            iid: "41",
            title: "Feature rollout",
            webUrl: "https://gitlab.example.com/group/web/-/merge_requests/41",
            draft: true,
            updatedAt: "2026-04-25T08:00:00Z",
            detailedMergeStatus: "DISCUSSIONS_NOT_RESOLVED",
            approvalsLeft: 1,
            headPipeline: {
              status: "FAILED",
              detailedStatus: {
                text: "Failed",
                label: "failed",
                group: "failed",
                icon: "status_failed"
              }
            }
          }
        ]
      },
      issues: {
        count: 3,
        nodes: [
          {
            iid: "51",
            title: "Triage production alert",
            webUrl: "https://gitlab.example.com/group/web/-/issues/51",
            dueDate: "2024-01-01",
            updatedAt: "2026-04-25T07:00:00Z",
            assignees: {
              nodes: []
            }
          }
        ]
      },
      pipelines: {
        count: 4,
        nodes: [
          {
            iid: "61",
            path: "/group/web/-/pipelines/61",
            status: "FAILED",
            ref: "main",
            sha: "def456",
            updatedAt: "2026-04-25T09:10:00Z",
            detailedStatus: {
              text: "Failed",
              label: "failed",
              group: "failed",
              icon: "status_failed"
            }
          },
          {
            iid: "62",
            path: "/group/web/-/pipelines/62",
            status: "RUNNING",
            ref: "feature",
            sha: "ghi789",
            updatedAt: "2026-04-25T09:11:00Z",
            detailedStatus: {
              text: "Running",
              label: "running",
              group: "running",
              icon: "status_running"
            }
          }
        ]
      }
    });

    expect(summary.dashboard_status).toBe("needs_attention");
    expect(summary.health_reasons).toContain("Recent pipeline sample includes failures.");
    expect(summary.health_reasons).toContain(
      "Open merge request sample includes items needing review attention."
    );
    expect(summary.health_reasons).toContain("Open issue sample includes unassigned issues.");
    expect(summary.health_reasons).toContain("Open issue sample includes overdue issues.");
    expect(summary.sample_insights).toMatchObject({
      merge_requests_needing_attention: 1,
      unassigned_issues: 1,
      overdue_issues: 1,
      failed_pipelines: 1,
      running_pipelines: 1
    });
  });

  it("marks archived projects separately from active health state", () => {
    const summary = summarizeProjectDashboard({
      id: "gid://gitlab/Project/3",
      name: "legacy",
      fullPath: "group/legacy",
      webUrl: "https://gitlab.example.com/group/legacy",
      archived: true,
      repository: {
        rootRef: "main",
        empty: false
      }
    });

    expect(summary.dashboard_status).toBe("archived");
    expect(summary.health_reasons).toContain("Project is archived.");
  });
});
