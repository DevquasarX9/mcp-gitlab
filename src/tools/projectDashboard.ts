import { z } from "zod";

import { GitLabGraphQLClient } from "../gitlab/graphqlClient.js";
import type { JsonMap } from "../gitlab/types.js";
import {
  summarizeIssue,
  summarizeMergeRequest,
  summarizePipeline,
  type GraphQLCountConnection,
  type GraphQLDashboardIssue,
  type GraphQLDashboardMergeRequest,
  type GraphQLDashboardPipeline,
  takeNodes
} from "./deliveryShared.js";
import { registerTool, type ToolDeps } from "./shared.js";

interface GraphQLProjectDashboard {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly fullPath?: string | null;
  readonly webUrl?: string | null;
  readonly description?: string | null;
  readonly archived?: boolean | null;
  readonly visibility?: string | null;
  readonly lastActivityAt?: string | null;
  readonly repository?: {
    readonly rootRef?: string | null;
    readonly empty?: boolean | null;
  } | null;
  readonly mergeRequests?: GraphQLCountConnection<GraphQLDashboardMergeRequest> | null;
  readonly issues?: GraphQLCountConnection<GraphQLDashboardIssue> | null;
  readonly pipelines?: GraphQLCountConnection<GraphQLDashboardPipeline> | null;
}

interface ProjectDashboardQueryResult {
  readonly project?: GraphQLProjectDashboard | null;
}

const PROJECT_DASHBOARD_QUERY_WITH_APPROVALS = `
  query GetProjectDashboard(
    $projectPath: ID!
    $mergeRequestLimit: Int!
    $issueLimit: Int!
    $pipelineLimit: Int!
    $assigneeLimit: Int!
  ) {
    project(fullPath: $projectPath) {
      id
      name
      fullPath
      webUrl
      description
      archived
      visibility
      lastActivityAt
      repository {
        rootRef
        empty
      }
      mergeRequests(state: opened, first: $mergeRequestLimit, sort: UPDATED_DESC) {
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
      issues(state: opened, first: $issueLimit, sort: UPDATED_DESC) {
        count
        nodes {
          iid
          title
          reference
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
      pipelines(first: $pipelineLimit) {
        count
        nodes {
          iid
          path
          status
          ref
          sha
          updatedAt
          detailedStatus {
            text
            label
            group
            icon
          }
        }
      }
    }
  }
`;

const PROJECT_DASHBOARD_QUERY_BASE = `
  query GetProjectDashboard(
    $projectPath: ID!
    $mergeRequestLimit: Int!
    $issueLimit: Int!
    $pipelineLimit: Int!
    $assigneeLimit: Int!
  ) {
    project(fullPath: $projectPath) {
      id
      name
      fullPath
      webUrl
      description
      archived
      visibility
      lastActivityAt
      repository {
        rootRef
        empty
      }
      mergeRequests(state: opened, first: $mergeRequestLimit, sort: UPDATED_DESC) {
        count
        nodes {
          iid
          title
          webUrl
          draft
          updatedAt
          detailedMergeStatus
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
      issues(state: opened, first: $issueLimit, sort: UPDATED_DESC) {
        count
        nodes {
          iid
          title
          reference
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
      pipelines(first: $pipelineLimit) {
        count
        nodes {
          iid
          path
          status
          ref
          sha
          updatedAt
          detailedStatus {
            text
            label
            group
            icon
          }
        }
      }
    }
  }
`;

export function shouldRetryWithoutApprovalFields(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Field 'approvalsLeft' doesn't exist on type 'MergeRequest'/i.test(error.message);
}

export function summarizeProjectDashboard(project: GraphQLProjectDashboard): JsonMap {
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

  const healthReasons: string[] = [];

  if (project.archived === true) {
    healthReasons.push("Project is archived.");
  }

  if (project.repository?.empty === true) {
    healthReasons.push("Repository is empty.");
  }

  if (failedPipelines.length > 0) {
    healthReasons.push("Recent pipeline sample includes failures.");
  }

  if (mergeRequestsNeedingAttention.length > 0) {
    healthReasons.push("Open merge request sample includes items needing review attention.");
  }

  if (unassignedIssues.length > 0) {
    healthReasons.push("Open issue sample includes unassigned issues.");
  }

  if (overdueIssues.length > 0) {
    healthReasons.push("Open issue sample includes overdue issues.");
  }

  let dashboardStatus = "healthy";
  if (project.archived === true) {
    dashboardStatus = "archived";
  } else if (project.repository?.empty === true) {
    dashboardStatus = "empty";
  } else if (healthReasons.length > 0) {
    dashboardStatus = "needs_attention";
  }

  return {
    dashboard_status: dashboardStatus,
    project: {
      id: project.id ?? null,
      name: project.name ?? null,
      full_path: project.fullPath ?? null,
      web_url: project.webUrl ?? null,
      description: project.description ?? null,
      archived: project.archived ?? false,
      visibility: project.visibility ?? null,
      last_activity_at: project.lastActivityAt ?? null,
      default_branch: project.repository?.rootRef ?? null,
      repository_empty: project.repository?.empty ?? false
    },
    counts: {
      open_merge_requests: project.mergeRequests?.count ?? 0,
      open_issues: project.issues?.count ?? 0,
      recent_pipelines_total: project.pipelines?.count ?? 0
    },
    sample_window: {
      merge_requests: mergeRequests.length,
      issues: issues.length,
      pipelines: pipelines.length
    },
    sample_insights: {
      merge_requests_needing_attention: mergeRequestsNeedingAttention.length,
      unassigned_issues: unassignedIssues.length,
      overdue_issues: overdueIssues.length,
      failed_pipelines: failedPipelines.length,
      running_pipelines: runningPipelines.length
    },
    health_reasons: healthReasons,
    highlights: {
      merge_requests_needing_attention: mergeRequestsNeedingAttention,
      failed_pipelines: failedPipelines,
      unassigned_issues: unassignedIssues,
      overdue_issues: overdueIssues
    },
    samples: {
      merge_requests: mergeRequests,
      issues,
      pipelines
    }
  };
}

export function registerProjectDashboardTools(deps: ToolDeps): void {
  const graphqlClient = new GitLabGraphQLClient(deps.config);

  registerTool(deps, {
    name: "gitlab_get_project_dashboard",
    title: "Get Project Dashboard",
    description:
      "Aggregate a project dashboard with open merge requests, open issues, recent pipelines, and attention highlights through a single GraphQL query.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_limit: z.number().int().positive().max(20).optional().default(5),
      issue_limit: z.number().int().positive().max(20).optional().default(5),
      pipeline_limit: z.number().int().positive().max(20).optional().default(5),
      assignee_limit: z.number().int().positive().max(10).optional().default(3)
    },
    handler: async (args, { requireProject }) => {
      const project = await requireProject(args.project_id);
      const projectPath = typeof project.path_with_namespace === "string"
        ? project.path_with_namespace
        : null;

      if (!projectPath) {
        throw new Error("GitLab did not return a project path that can be used for GraphQL queries.");
      }

      const queryVariables = {
        projectPath,
        mergeRequestLimit: args.merge_request_limit,
        issueLimit: args.issue_limit,
        pipelineLimit: args.pipeline_limit,
        assigneeLimit: args.assignee_limit
      };

      let response: ProjectDashboardQueryResult;

      try {
        response = await graphqlClient.query<ProjectDashboardQueryResult>(
          PROJECT_DASHBOARD_QUERY_WITH_APPROVALS,
          queryVariables
        );
      } catch (error) {
        if (!shouldRetryWithoutApprovalFields(error)) {
          throw error;
        }

        response = await graphqlClient.query<ProjectDashboardQueryResult>(
          PROJECT_DASHBOARD_QUERY_BASE,
          queryVariables
        );
      }

      const resultProject = response.project ?? null;

      if (!resultProject) {
        throw new Error("GitLab could not find the requested project.");
      }

      return {
        source: "graphql",
        ...summarizeProjectDashboard(resultProject)
      };
    }
  });
}
