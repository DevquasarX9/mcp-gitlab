import { describe, expect, it } from "vitest";

import { formatGroupDeliveryOverviewMarkdown } from "../src/tools/output.js";
import { summarizeGroupDeliveryOverview } from "../src/tools/groupDeliveryOverview.js";

describe("summarizeGroupDeliveryOverview", () => {
  it("marks a clean group sample as healthy", () => {
    const summary = summarizeGroupDeliveryOverview({
      id: "gid://gitlab/Group/1",
      name: "Platform",
      fullPath: "group/platform",
      webUrl: "https://gitlab.example.com/groups/group/platform",
      description: "Platform group",
      projects: {
        count: 2,
        nodes: [
          {
            name: "api",
            fullPath: "group/platform/api",
            webUrl: "https://gitlab.example.com/group/platform/api",
            archived: false,
            lastActivityAt: "2026-04-25T09:00:00Z",
            repository: {
              rootRef: "main",
              empty: false
            },
            pipelines: {
              count: 2,
              nodes: [
                {
                  iid: "1",
                  path: "/group/platform/api/-/pipelines/1",
                  status: "SUCCESS",
                  updatedAt: "2026-04-25T09:01:00Z",
                  detailedStatus: {
                    text: "Passed",
                    label: "passed",
                    group: "success",
                    icon: "status_success"
                  }
                }
              ]
            },
            mergeRequests: {
              count: 1,
              nodes: [
                {
                  iid: "11",
                  title: "Refactor auth",
                  webUrl: "https://gitlab.example.com/group/platform/api/-/merge_requests/11",
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
                  title: "Document release",
                  reference: "#21",
                  webUrl: "https://gitlab.example.com/group/platform/api/-/issues/21",
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
            }
          }
        ]
      },
      mergeRequests: {
        count: 3,
        nodes: [
          {
            iid: "31",
            title: "Clean MR",
            webUrl: "https://gitlab.example.com/group/platform/api/-/merge_requests/31",
            draft: false,
            updatedAt: "2026-04-25T08:10:00Z",
            detailedMergeStatus: "MERGEABLE",
            approvalsLeft: 0,
            project: {
              name: "api",
              fullPath: "group/platform/api",
              webUrl: "https://gitlab.example.com/group/platform/api"
            },
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
        count: 4,
        nodes: [
          {
            iid: "41",
            title: "Assigned issue",
            reference: "#41",
            webUrl: "https://gitlab.example.com/group/platform/api/-/issues/41",
            dueDate: "2099-12-01",
            updatedAt: "2026-04-25T08:20:00Z",
            assignees: {
              nodes: [
                {
                  username: "bob",
                  name: "Bob",
                  webUrl: "https://gitlab.example.com/bob"
                }
              ]
            }
          }
        ]
      }
    });

    expect(summary.delivery_status).toBe("healthy");
    expect(summary.summary).toBe(
      "The sampled group delivery data looks healthy based on current project, merge request, and issue signals."
    );
    expect(summary.confidence).toBe("medium");
    expect(summary.next_actions).toContain(
      "Share the group delivery overview and keep monitoring sampled projects, merge requests, and issues."
    );
    expect(summary.content_is_untrusted).toBe(true);
    expect(summary.source_links).toEqual(["https://gitlab.example.com/groups/group/platform"]);
    expect(summary.health_reasons).toEqual([]);
    expect(summary.sample_insights).toMatchObject({
      projects_needing_attention: 0,
      merge_requests_needing_attention: 0,
      unassigned_issues: 0,
      overdue_issues: 0
    });
    expect((summary.samples as Record<string, unknown>).issues).toEqual([
      expect.objectContaining({
        reference: "#41",
        project_path: "group/platform/api"
      })
    ]);
  });

  it("marks a group as needing attention when projects, merge requests, and issues show delivery risk", () => {
    const summary = summarizeGroupDeliveryOverview({
      id: "gid://gitlab/Group/2",
      name: "Applications",
      fullPath: "group/apps",
      webUrl: "https://gitlab.example.com/groups/group/apps",
      projects: {
        count: 2,
        nodes: [
          {
            name: "web",
            fullPath: "group/apps/web",
            webUrl: "https://gitlab.example.com/group/apps/web",
            archived: false,
            lastActivityAt: "2026-04-25T09:00:00Z",
            repository: {
              rootRef: "main",
              empty: false
            },
            pipelines: {
              count: 1,
              nodes: [
                {
                  iid: "51",
                  path: "/group/apps/web/-/pipelines/51",
                  status: "FAILED",
                  updatedAt: "2026-04-25T09:01:00Z",
                  detailedStatus: {
                    text: "Failed",
                    label: "failed",
                    group: "failed",
                    icon: "status_failed"
                  }
                }
              ]
            },
            mergeRequests: {
              count: 1,
              nodes: [
                {
                  iid: "61",
                  title: "Draft rollout",
                  webUrl: "https://gitlab.example.com/group/apps/web/-/merge_requests/61",
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
              count: 1,
              nodes: [
                {
                  iid: "71",
                  title: "Triage incident",
                  reference: "#71",
                  webUrl: "https://gitlab.example.com/group/apps/web/-/issues/71",
                  dueDate: "2024-01-01",
                  updatedAt: "2026-04-25T07:00:00Z",
                  assignees: {
                    nodes: []
                  }
                }
              ]
            }
          }
        ]
      },
      mergeRequests: {
        count: 5,
        nodes: [
          {
            iid: "81",
            title: "Needs review",
            webUrl: "https://gitlab.example.com/group/apps/web/-/merge_requests/81",
            draft: false,
            updatedAt: "2026-04-25T08:10:00Z",
            detailedMergeStatus: "NOT_APPROVED",
            approvalsLeft: 1,
            project: {
              name: "web",
              fullPath: "group/apps/web",
              webUrl: "https://gitlab.example.com/group/apps/web"
            },
            headPipeline: {
              status: "RUNNING",
              detailedStatus: {
                text: "Running",
                label: "running",
                group: "running",
                icon: "status_running"
              }
            }
          }
        ]
      },
      issues: {
        count: 9,
        nodes: [
          {
            iid: "91",
            title: "Unassigned bug",
            reference: "#91",
            webUrl: "https://gitlab.example.com/group/apps/web/-/issues/91",
            dueDate: "2024-01-01",
            updatedAt: "2026-04-25T08:20:00Z",
            assignees: {
              nodes: []
            }
          }
        ]
      }
    });

    expect(summary.delivery_status).toBe("needs_attention");
    expect(summary.summary).toBe(
      "The sampled group delivery data shows concrete risks that should be addressed before treating this as a clean status."
    );
    expect(summary.health_reasons).toContain("Sampled group projects include delivery risks.");
    expect(summary.health_reasons).toContain(
      "Open group merge request sample includes items needing attention."
    );
    expect(summary.health_reasons).toContain("Open group issue sample includes unassigned issues.");
    expect(summary.health_reasons).toContain("Open group issue sample includes overdue issues.");
    expect(summary.sample_insights).toMatchObject({
      projects_needing_attention: 1,
      merge_requests_needing_attention: 1,
      unassigned_issues: 1,
      overdue_issues: 1
    });
    expect(summary.signals).toMatchObject({
      project_count: 2,
      open_merge_request_count: 5,
      open_issue_count: 9,
      projects_needing_attention_count: 1
    });
    expect(summary.next_actions).toContain(
      "Review the sampled projects with delivery risks before broad group status reporting."
    );
    expect(summary.next_actions).toContain(
      "Unblock highlighted merge requests that are blocked, missing approvals, or failing CI."
    );
    expect(summary.next_actions).toContain(
      "Assign or reprioritize highlighted open issues that are unassigned or overdue."
    );
  });

  it("does not treat archived sampled projects as active delivery risk", () => {
    const summary = summarizeGroupDeliveryOverview({
      id: "gid://gitlab/Group/3",
      name: "Archive",
      fullPath: "group/archive",
      webUrl: "https://gitlab.example.com/groups/group/archive",
      projects: {
        count: 1,
        nodes: [
          {
            name: "legacy",
            fullPath: "group/archive/legacy",
            webUrl: "https://gitlab.example.com/group/archive/legacy",
            archived: true,
            lastActivityAt: "2026-04-20T09:00:00Z",
            repository: {
              rootRef: "main",
              empty: false
            },
            pipelines: {
              count: 1,
              nodes: [
                {
                  iid: "1",
                  path: "/group/archive/legacy/-/pipelines/1",
                  status: "FAILED",
                  updatedAt: "2026-04-20T09:01:00Z",
                  detailedStatus: {
                    text: "Failed",
                    label: "failed",
                    group: "failed",
                    icon: "status_failed"
                  }
                }
              ]
            },
            mergeRequests: {
              count: 1,
              nodes: [
                {
                  iid: "1",
                  title: "Old MR",
                  webUrl: "https://gitlab.example.com/group/archive/legacy/-/merge_requests/1",
                  draft: true,
                  updatedAt: "2026-04-20T09:00:00Z",
                  detailedMergeStatus: "DRAFT_STATUS",
                  approvalsLeft: 1
                }
              ]
            },
            issues: {
              count: 1,
              nodes: [
                {
                  iid: "1",
                  title: "Old issue",
                  reference: "#1",
                  webUrl: "https://gitlab.example.com/group/archive/legacy/-/issues/1",
                  dueDate: "2024-01-01",
                  updatedAt: "2026-04-20T08:00:00Z",
                  assignees: {
                    nodes: []
                  }
                }
              ]
            }
          }
        ]
      },
      mergeRequests: {
        count: 0,
        nodes: []
      },
      issues: {
        count: 0,
        nodes: []
      }
    });

    expect(summary.delivery_status).toBe("healthy");
    expect(summary.health_reasons).toEqual([]);
    expect(summary.sample_insights).toMatchObject({
      projects_needing_attention: 0
    });
    expect((summary.samples as Record<string, unknown>).projects).toEqual([
      expect.objectContaining({
        delivery_status: "archived",
        excluded_from_group_attention: true,
        attention_reasons: []
      })
    ]);
  });

  it("renders a markdown group delivery overview", () => {
    const markdown = formatGroupDeliveryOverviewMarkdown({
      delivery_status: "needs_attention",
      confidence: "medium",
      summary: "The sampled group delivery data shows concrete risks.",
      group: {
        full_path: "group/apps"
      },
      counts: {
        projects: 2,
        open_merge_requests: 5,
        open_issues: 9
      },
      sample_window: {
        projects: 1,
        merge_requests: 1,
        issues: 1
      },
      sample_limits: {
        projects: 5,
        merge_requests: 5,
        issues: 5
      },
      sample_insights: {
        projects_needing_attention: 1,
        merge_requests_needing_attention: 1,
        unassigned_issues: 1,
        overdue_issues: 1
      },
      health_reasons: [
        "Sampled group projects include delivery risks."
      ],
      highlights: {
        projects_needing_attention: [
          {
            full_path: "group/apps/web",
            delivery_status: "needs_attention",
            attention_reasons: ["Latest project pipeline sample includes failures."]
          }
        ],
        merge_requests_needing_attention: [
          {
            iid: "81",
            title: "Needs review"
          }
        ],
        unassigned_issues: [
          {
            reference: "#91",
            title: "Unassigned bug"
          }
        ]
      },
      next_actions: [
        "Review the sampled projects with delivery risks before broad group status reporting."
      ]
    });

    expect(markdown).toContain("# Group Delivery Overview: group/apps");
    expect(markdown).toContain("Delivery status: needs_attention");
    expect(markdown).toContain("Sampled projects: 1 / limit 5");
    expect(markdown).toContain("group/apps/web [needs_attention] - Latest project pipeline sample includes failures.");
    expect(markdown).toContain("!81: Needs review");
    expect(markdown).toContain("#91: Unassigned bug");
  });
});
