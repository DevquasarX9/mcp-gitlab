import { z } from "zod";

import { GitLabGraphQLClient } from "../gitlab/graphqlClient.js";
import type { JsonMap } from "../gitlab/types.js";
import { isBlockedMergeStatus } from "./intelligence.js";
import { registerTool, type ToolDeps } from "./shared.js";

interface GraphQLCountConnection<TNode> {
  readonly count?: number | null;
  readonly nodes?: readonly TNode[] | null;
}

interface GraphQLUser {
  readonly username?: string | null;
  readonly name?: string | null;
  readonly webUrl?: string | null;
}

interface GraphQLPipelineDetailedStatus {
  readonly text?: string | null;
  readonly label?: string | null;
  readonly group?: string | null;
  readonly icon?: string | null;
}

interface GraphQLDashboardPipeline {
  readonly iid?: string | null;
  readonly path?: string | null;
  readonly status?: string | null;
  readonly ref?: string | null;
  readonly sha?: string | null;
  readonly updatedAt?: string | null;
  readonly detailedStatus?: GraphQLPipelineDetailedStatus | null;
}

interface GraphQLDashboardIssue {
  readonly iid?: string | null;
  readonly title?: string | null;
  readonly webUrl?: string | null;
  readonly dueDate?: string | null;
  readonly updatedAt?: string | null;
  readonly assignees?: GraphQLCountConnection<GraphQLUser> | null;
}

interface GraphQLDashboardMergeRequest {
  readonly iid?: string | null;
  readonly title?: string | null;
  readonly webUrl?: string | null;
  readonly draft?: boolean | null;
  readonly updatedAt?: string | null;
  readonly detailedMergeStatus?: string | null;
  readonly approvalsLeft?: number | null;
  readonly headPipeline?: {
    readonly status?: string | null;
    readonly detailedStatus?: GraphQLPipelineDetailedStatus | null;
  } | null;
}

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

const PROJECT_DASHBOARD_QUERY = `
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

const runningPipelineStatuses = new Set([
  "created",
  "pending",
  "preparing",
  "running",
  "scheduled",
  "waiting_for_resource"
]);

function takeNodes<TNode>(connection?: GraphQLCountConnection<TNode> | null): readonly TNode[] {
  return Array.isArray(connection?.nodes) ? connection.nodes : [];
}

function normalizeStatus(status: string | null | undefined): string {
  return typeof status === "string" ? status.toLowerCase() : "";
}

function isPipelineFailure(pipeline: GraphQLDashboardPipeline): boolean {
  const status = normalizeStatus(pipeline.status);
  const group = normalizeStatus(pipeline.detailedStatus?.group);

  return status === "failed" || status === "canceled" || group === "failed";
}

function isPipelineRunning(pipeline: GraphQLDashboardPipeline): boolean {
  const status = normalizeStatus(pipeline.status);
  const group = normalizeStatus(pipeline.detailedStatus?.group);

  return runningPipelineStatuses.has(status) || runningPipelineStatuses.has(group);
}

function isOverdue(date: string | null | undefined): boolean {
  if (typeof date !== "string" || date.length === 0) {
    return false;
  }

  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

function toUserSummary(user: GraphQLUser): JsonMap {
  return {
    username: user.username ?? null,
    name: user.name ?? null,
    web_url: user.webUrl ?? null
  };
}

function summarizeIssue(issue: GraphQLDashboardIssue): JsonMap {
  const assignees = takeNodes(issue.assignees).map(toUserSummary);
  const attentionReasons: string[] = [];

  if (assignees.length === 0) {
    attentionReasons.push("Issue is unassigned.");
  }

  if (isOverdue(issue.dueDate)) {
    attentionReasons.push("Issue due date is overdue.");
  }

  return {
    iid: issue.iid ?? null,
    title: issue.title ?? null,
    web_url: issue.webUrl ?? null,
    due_date: issue.dueDate ?? null,
    updated_at: issue.updatedAt ?? null,
    assignees,
    attention_reasons: attentionReasons
  };
}

function summarizePipeline(pipeline: GraphQLDashboardPipeline): JsonMap {
  const attentionReasons: string[] = [];

  if (isPipelineFailure(pipeline)) {
    attentionReasons.push("Pipeline is failing.");
  } else if (isPipelineRunning(pipeline)) {
    attentionReasons.push("Pipeline is still running.");
  }

  return {
    iid: pipeline.iid ?? null,
    path: pipeline.path ?? null,
    status: pipeline.status ?? null,
    ref: pipeline.ref ?? null,
    sha: pipeline.sha ?? null,
    updated_at: pipeline.updatedAt ?? null,
    detailed_status: {
      text: pipeline.detailedStatus?.text ?? null,
      label: pipeline.detailedStatus?.label ?? null,
      group: pipeline.detailedStatus?.group ?? null,
      icon: pipeline.detailedStatus?.icon ?? null
    },
    attention_reasons: attentionReasons
  };
}

function summarizeMergeRequest(mergeRequest: GraphQLDashboardMergeRequest): JsonMap {
  const attentionReasons: string[] = [];
  const approvalsLeft = typeof mergeRequest.approvalsLeft === "number" ? mergeRequest.approvalsLeft : 0;
  const mergeStatus = mergeRequest.detailedMergeStatus ?? null;

  if (mergeRequest.draft === true) {
    attentionReasons.push("Merge request is a draft.");
  }

  if (approvalsLeft > 0) {
    attentionReasons.push(`${approvalsLeft} approval(s) are still required.`);
  }

  if (isBlockedMergeStatus(mergeStatus)) {
    attentionReasons.push(`GitLab merge status is ${mergeStatus}.`);
  }

  if (mergeRequest.headPipeline && isPipelineFailure(mergeRequest.headPipeline)) {
    attentionReasons.push("Head pipeline is failing.");
  } else if (mergeRequest.headPipeline && isPipelineRunning(mergeRequest.headPipeline)) {
    attentionReasons.push("Head pipeline is still running.");
  }

  return {
    iid: mergeRequest.iid ?? null,
    title: mergeRequest.title ?? null,
    web_url: mergeRequest.webUrl ?? null,
    draft: mergeRequest.draft ?? false,
    updated_at: mergeRequest.updatedAt ?? null,
    detailed_merge_status: mergeStatus,
    approvals_left: approvalsLeft,
    head_pipeline: mergeRequest.headPipeline
      ? {
          status: mergeRequest.headPipeline.status ?? null,
          detailed_status: {
            text: mergeRequest.headPipeline.detailedStatus?.text ?? null,
            label: mergeRequest.headPipeline.detailedStatus?.label ?? null,
            group: mergeRequest.headPipeline.detailedStatus?.group ?? null,
            icon: mergeRequest.headPipeline.detailedStatus?.icon ?? null
          }
        }
      : null,
    attention_reasons: attentionReasons
  };
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

      const response = await graphqlClient.query<ProjectDashboardQueryResult>(
        PROJECT_DASHBOARD_QUERY,
        {
          projectPath,
          mergeRequestLimit: args.merge_request_limit,
          issueLimit: args.issue_limit,
          pipelineLimit: args.pipeline_limit,
          assigneeLimit: args.assignee_limit
        }
      );

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
