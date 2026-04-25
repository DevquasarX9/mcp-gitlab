import { z } from "zod";

import { GitLabGraphQLClient } from "../gitlab/graphqlClient.js";
import type { JsonMap } from "../gitlab/types.js";
import {
  summarizeIssue,
  summarizeMergeRequest,
  summarizePipeline,
  takeNodes,
  type GraphQLCountConnection,
  type GraphQLDashboardIssue,
  type GraphQLDashboardMergeRequest,
  type GraphQLDashboardPipeline
} from "./deliveryShared.js";
import { requireAllowedGroup } from "./groups.js";
import { registerTool, type ToolDeps } from "./shared.js";

interface GraphQLGroupProject {
  readonly name?: string | null;
  readonly fullPath?: string | null;
  readonly webUrl?: string | null;
  readonly archived?: boolean | null;
  readonly lastActivityAt?: string | null;
  readonly repository?: {
    readonly rootRef?: string | null;
    readonly empty?: boolean | null;
  } | null;
  readonly pipelines?: GraphQLCountConnection<GraphQLDashboardPipeline> | null;
  readonly mergeRequests?: GraphQLCountConnection<GraphQLDashboardMergeRequest> | null;
  readonly issues?: GraphQLCountConnection<GraphQLDashboardIssue> | null;
}

interface GraphQLGroupMergeRequest extends GraphQLDashboardMergeRequest {
  readonly project?: {
    readonly name?: string | null;
    readonly fullPath?: string | null;
    readonly webUrl?: string | null;
  } | null;
}

interface GraphQLGroupOverview {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly fullPath?: string | null;
  readonly webUrl?: string | null;
  readonly description?: string | null;
  readonly projects?: GraphQLCountConnection<GraphQLGroupProject> | null;
  readonly mergeRequests?: GraphQLCountConnection<GraphQLGroupMergeRequest> | null;
  readonly issues?: GraphQLCountConnection<GraphQLDashboardIssue> | null;
}

interface GroupDeliveryOverviewQueryResult {
  readonly group?: GraphQLGroupOverview | null;
}

const GROUP_DELIVERY_OVERVIEW_QUERY = `
  query GetGroupDeliveryOverview(
    $groupPath: ID!
    $projectLimit: Int!
    $mergeRequestLimit: Int!
    $issueLimit: Int!
    $projectNestedLimit: Int!
    $assigneeLimit: Int!
  ) {
    group(fullPath: $groupPath) {
      id
      name
      fullPath
      webUrl
      description
      projects(includeSubgroups: true, first: $projectLimit) {
        count
        nodes {
          name
          fullPath
          webUrl
          archived
          lastActivityAt
          repository {
            rootRef
            empty
          }
          pipelines(first: $projectNestedLimit) {
            count
            nodes {
              iid
              path
              status
              updatedAt
              detailedStatus {
                text
                label
                group
                icon
              }
            }
          }
          mergeRequests(state: opened, first: $projectNestedLimit) {
            count
            nodes {
              iid
              title
              webUrl
              draft
              updatedAt
              detailedMergeStatus
              approvalsLeft
              headPipeline {
                status
                detailedStatus {
                  text
                  label
                  group
                  icon
                }
              }
            }
          }
          issues(state: opened, first: $projectNestedLimit) {
            count
            nodes {
              iid
              title
              webUrl
              dueDate
              updatedAt
              assignees(first: $assigneeLimit) {
                nodes {
                  username
                  name
                  webUrl
                }
              }
            }
          }
        }
      }
      mergeRequests(state: opened, first: $mergeRequestLimit) {
        count
        nodes {
          iid
          title
          webUrl
          draft
          updatedAt
          detailedMergeStatus
          approvalsLeft
          project {
            name
            fullPath
            webUrl
          }
          headPipeline {
            status
            detailedStatus {
              text
              label
              group
              icon
            }
          }
        }
      }
      issues(state: opened, first: $issueLimit) {
        count
        nodes {
          iid
          title
          webUrl
          dueDate
          updatedAt
          assignees(first: $assigneeLimit) {
            nodes {
              username
              name
              webUrl
            }
          }
        }
      }
    }
  }
`;

function summarizeGroupProject(project: GraphQLGroupProject): JsonMap {
  const mergeRequests = takeNodes(project.mergeRequests).map(summarizeMergeRequest);
  const issues = takeNodes(project.issues).map(summarizeIssue);
  const pipelines = takeNodes(project.pipelines).map(summarizePipeline);

  const mergeRequestsNeedingAttention = mergeRequests
    .filter((item) => Array.isArray(item.attention_reasons) && item.attention_reasons.length > 0);
  const unassignedIssues = issues
    .filter((item) => Array.isArray(item.assignees) && item.assignees.length === 0);
  const overdueIssues = issues
    .filter((item) => Array.isArray(item.attention_reasons) && item.attention_reasons.includes("Issue due date is overdue."));
  const failedPipelines = pipelines
    .filter((item) => Array.isArray(item.attention_reasons) && item.attention_reasons.includes("Pipeline is failing."));
  const runningPipelines = pipelines
    .filter((item) => Array.isArray(item.attention_reasons) && item.attention_reasons.includes("Pipeline is still running."));

  const attentionReasons: string[] = [];

  if (project.archived === true) {
    attentionReasons.push("Project is archived.");
  }

  if (project.repository?.empty === true) {
    attentionReasons.push("Repository is empty.");
  }

  if (failedPipelines.length > 0) {
    attentionReasons.push("Latest project pipeline sample includes failures.");
  }

  if (mergeRequestsNeedingAttention.length > 0) {
    attentionReasons.push("Open project merge request sample includes items needing attention.");
  }

  if (unassignedIssues.length > 0) {
    attentionReasons.push("Open project issue sample includes unassigned issues.");
  }

  if (overdueIssues.length > 0) {
    attentionReasons.push("Open project issue sample includes overdue issues.");
  }

  return {
    name: project.name ?? null,
    full_path: project.fullPath ?? null,
    web_url: project.webUrl ?? null,
    archived: project.archived ?? false,
    last_activity_at: project.lastActivityAt ?? null,
    default_branch: project.repository?.rootRef ?? null,
    repository_empty: project.repository?.empty ?? false,
    counts: {
      open_merge_requests: project.mergeRequests?.count ?? 0,
      open_issues: project.issues?.count ?? 0,
      recent_pipelines_total: project.pipelines?.count ?? 0
    },
    sample_insights: {
      merge_requests_needing_attention: mergeRequestsNeedingAttention.length,
      unassigned_issues: unassignedIssues.length,
      overdue_issues: overdueIssues.length,
      failed_pipelines: failedPipelines.length,
      running_pipelines: runningPipelines.length
    },
    attention_reasons: attentionReasons,
    samples: {
      merge_requests: mergeRequests,
      issues,
      pipelines
    }
  };
}

function summarizeGroupMergeRequest(mergeRequest: GraphQLGroupMergeRequest): JsonMap {
  const summary = summarizeMergeRequest(mergeRequest);

  return {
    ...summary,
    project: mergeRequest.project
      ? {
          name: mergeRequest.project.name ?? null,
          full_path: mergeRequest.project.fullPath ?? null,
          web_url: mergeRequest.project.webUrl ?? null
        }
      : null
  };
}

export function summarizeGroupDeliveryOverview(group: GraphQLGroupOverview): JsonMap {
  const projects = takeNodes(group.projects).map(summarizeGroupProject);
  const mergeRequests = takeNodes(group.mergeRequests).map(summarizeGroupMergeRequest);
  const issues = takeNodes(group.issues).map(summarizeIssue);

  const projectsNeedingAttention = projects
    .filter((item) => Array.isArray(item.attention_reasons) && item.attention_reasons.length > 0);
  const mergeRequestsNeedingAttention = mergeRequests
    .filter((item) => Array.isArray(item.attention_reasons) && item.attention_reasons.length > 0);
  const unassignedIssues = issues
    .filter((item) => Array.isArray(item.assignees) && item.assignees.length === 0);
  const overdueIssues = issues
    .filter((item) => Array.isArray(item.attention_reasons) && item.attention_reasons.includes("Issue due date is overdue."));

  const healthReasons: string[] = [];

  if (projectsNeedingAttention.length > 0) {
    healthReasons.push("Sampled group projects include delivery risks.");
  }

  if (mergeRequestsNeedingAttention.length > 0) {
    healthReasons.push("Open group merge request sample includes items needing attention.");
  }

  if (unassignedIssues.length > 0) {
    healthReasons.push("Open group issue sample includes unassigned issues.");
  }

  if (overdueIssues.length > 0) {
    healthReasons.push("Open group issue sample includes overdue issues.");
  }

  return {
    delivery_status: healthReasons.length > 0 ? "needs_attention" : "healthy",
    group: {
      id: group.id ?? null,
      name: group.name ?? null,
      full_path: group.fullPath ?? null,
      web_url: group.webUrl ?? null,
      description: group.description ?? null
    },
    counts: {
      projects: group.projects?.count ?? 0,
      open_merge_requests: group.mergeRequests?.count ?? 0,
      open_issues: group.issues?.count ?? 0
    },
    sample_window: {
      projects: projects.length,
      merge_requests: mergeRequests.length,
      issues: issues.length
    },
    sample_insights: {
      projects_needing_attention: projectsNeedingAttention.length,
      merge_requests_needing_attention: mergeRequestsNeedingAttention.length,
      unassigned_issues: unassignedIssues.length,
      overdue_issues: overdueIssues.length
    },
    health_reasons: healthReasons,
    highlights: {
      projects_needing_attention: projectsNeedingAttention,
      merge_requests_needing_attention: mergeRequestsNeedingAttention,
      unassigned_issues: unassignedIssues,
      overdue_issues: overdueIssues
    },
    samples: {
      projects,
      merge_requests: mergeRequests,
      issues
    }
  };
}

export function registerGroupDeliveryOverviewTools(deps: ToolDeps): void {
  const graphqlClient = new GitLabGraphQLClient(deps.config);

  registerTool(deps, {
    name: "gitlab_get_group_delivery_overview",
    title: "Get Group Delivery Overview",
    description:
      "Aggregate a group-level delivery overview with sampled projects, open merge requests, and open issues through a single GraphQL query.",
    safety: "read-only",
    inputSchema: {
      group_id: z.string().trim().min(1),
      project_limit: z.number().int().positive().max(10).optional().default(5),
      merge_request_limit: z.number().int().positive().max(20).optional().default(5),
      issue_limit: z.number().int().positive().max(20).optional().default(5),
      project_nested_limit: z.number().int().positive().max(3).optional().default(1),
      assignee_limit: z.number().int().positive().max(10).optional().default(3)
    },
    handler: async (args) => {
      const group = await requireAllowedGroup(args.group_id, deps);
      const groupPath = typeof group.full_path === "string" ? group.full_path : null;

      if (!groupPath) {
        throw new Error("GitLab did not return a group path that can be used for GraphQL queries.");
      }

      const response = await graphqlClient.query<GroupDeliveryOverviewQueryResult>(
        GROUP_DELIVERY_OVERVIEW_QUERY,
        {
          groupPath,
          projectLimit: args.project_limit,
          mergeRequestLimit: args.merge_request_limit,
          issueLimit: args.issue_limit,
          projectNestedLimit: args.project_nested_limit,
          assigneeLimit: args.assignee_limit
        }
      );

      const resultGroup = response.group ?? null;

      if (!resultGroup) {
        throw new Error("GitLab could not find the requested group.");
      }

      return {
        source: "graphql",
        ...summarizeGroupDeliveryOverview(resultGroup)
      };
    }
  });
}
