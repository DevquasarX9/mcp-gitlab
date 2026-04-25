import type { JsonMap } from "../gitlab/types.js";
import { isBlockedMergeStatus } from "./intelligence.js";

export interface GraphQLCountConnection<TNode> {
  readonly count?: number | null;
  readonly nodes?: readonly TNode[] | null;
}

export interface GraphQLUser {
  readonly username?: string | null;
  readonly name?: string | null;
  readonly webUrl?: string | null;
}

export interface GraphQLPipelineDetailedStatus {
  readonly text?: string | null;
  readonly label?: string | null;
  readonly group?: string | null;
  readonly icon?: string | null;
}

export interface GraphQLDashboardPipeline {
  readonly iid?: string | null;
  readonly path?: string | null;
  readonly status?: string | null;
  readonly ref?: string | null;
  readonly sha?: string | null;
  readonly updatedAt?: string | null;
  readonly detailedStatus?: GraphQLPipelineDetailedStatus | null;
}

export interface GraphQLDashboardIssue {
  readonly iid?: string | null;
  readonly title?: string | null;
  readonly webUrl?: string | null;
  readonly dueDate?: string | null;
  readonly updatedAt?: string | null;
  readonly assignees?: GraphQLCountConnection<GraphQLUser> | null;
}

export interface GraphQLDashboardMergeRequest {
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

const runningPipelineStatuses = new Set([
  "created",
  "pending",
  "preparing",
  "running",
  "scheduled",
  "waiting_for_resource"
]);

export function takeNodes<TNode>(connection?: GraphQLCountConnection<TNode> | null): readonly TNode[] {
  return Array.isArray(connection?.nodes) ? connection.nodes : [];
}

export function normalizeStatus(status: string | null | undefined): string {
  return typeof status === "string" ? status.toLowerCase() : "";
}

export function isPipelineFailure(pipeline: GraphQLDashboardPipeline): boolean {
  const status = normalizeStatus(pipeline.status);
  const group = normalizeStatus(pipeline.detailedStatus?.group);

  return status === "failed" || status === "canceled" || group === "failed";
}

export function isPipelineRunning(pipeline: GraphQLDashboardPipeline): boolean {
  const status = normalizeStatus(pipeline.status);
  const group = normalizeStatus(pipeline.detailedStatus?.group);

  return runningPipelineStatuses.has(status) || runningPipelineStatuses.has(group);
}

export function isOverdue(date: string | null | undefined): boolean {
  if (typeof date !== "string" || date.length === 0) {
    return false;
  }

  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

export function toUserSummary(user: GraphQLUser): JsonMap {
  return {
    username: user.username ?? null,
    name: user.name ?? null,
    web_url: user.webUrl ?? null
  };
}

export function summarizeIssue(issue: GraphQLDashboardIssue): JsonMap {
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

export function summarizePipeline(pipeline: GraphQLDashboardPipeline): JsonMap {
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

export function summarizeMergeRequest(mergeRequest: GraphQLDashboardMergeRequest): JsonMap {
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
