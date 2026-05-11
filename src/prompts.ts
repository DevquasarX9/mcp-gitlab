import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function lines(parts: readonly string[]): string {
  return parts.join("\n");
}

function userMessage(text: string): { role: "user"; content: { type: "text"; text: string } } {
  return {
    role: "user",
    content: {
      type: "text",
      text
    }
  };
}

export function registerPromptTools(server: McpServer): void {
  server.registerPrompt(
    "gitlab_review_merge_request_workflow",
    {
      title: "Review Merge Request Workflow",
      description:
        "Guide the model through an objective GitLab merge request review using the MCP's existing review, diff, discussion, approval, and pipeline tools.",
      argsSchema: {
        project_id: z.string().trim().min(1).describe("GitLab project path or numeric ID."),
        merge_request_iid: z.string().trim().min(1).describe("Merge request IID."),
        focus: z
          .string()
          .trim()
          .optional()
          .describe("Optional review emphasis, such as correctness, rollout risk, testing, or approvals.")
      }
    },
    async ({ project_id, merge_request_iid, focus }) => ({
      description: "Objective merge request review workflow",
      messages: [
        userMessage(
          lines([
            `Review GitLab merge request !${merge_request_iid} in project "${project_id}" objectively.`,
            `Focus: ${focus ?? "general correctness, delivery risk, approval state, and merge readiness"}.`,
            "",
            "Use these tools as needed:",
            "- gitlab_get_merge_request",
            "- gitlab_get_merge_request_changes or gitlab_get_merge_request_diff",
            "- gitlab_get_merge_request_discussions",
            "- gitlab_get_merge_request_review_state",
            "- gitlab_get_merge_request_approval_rules",
            "- gitlab_trace_merge_request_to_pipeline_failures",
            "- gitlab_review_merge_request_risks",
            "",
            "Return:",
            "1. a short summary of what the merge request changes",
            "2. the main correctness or rollout risks",
            "3. unresolved discussion or approval blockers",
            "4. pipeline or mergeability blockers",
            "5. concrete next actions"
          ])
        )
      ]
    })
  );

  server.registerPrompt(
    "gitlab_explain_failed_pipeline_workflow",
    {
      title: "Explain Failed Pipeline Workflow",
      description:
        "Guide the model through failed-pipeline triage using pipeline, job, flaky-job, and MR-tracing tools.",
      argsSchema: {
        project_id: z.string().trim().min(1).describe("GitLab project path or numeric ID."),
        pipeline_id: z.string().trim().min(1).describe("Pipeline ID."),
        investigation_goal: z
          .string()
          .trim()
          .optional()
          .describe("Optional triage goal, such as root cause, flakiness, or release impact.")
      }
    },
    async ({ project_id, pipeline_id, investigation_goal }) => ({
      description: "Failed pipeline triage workflow",
      messages: [
        userMessage(
          lines([
            `Explain why pipeline ${pipeline_id} failed in project "${project_id}".`,
            `Investigation goal: ${investigation_goal ?? "identify the root cause, likely owner, and next remediation steps"}.`,
            "",
            "Use these tools as needed:",
            "- gitlab_get_pipeline",
            "- gitlab_get_pipeline_failed_jobs_summary",
            "- gitlab_explain_failed_pipeline",
            "- gitlab_compare_pipeline_runs",
            "- gitlab_find_flaky_jobs",
            "- gitlab_trace_job_to_commit_and_merge_request",
            "",
            "Return:",
            "1. the failing stage and jobs",
            "2. the most likely failure cause based on the available evidence",
            "3. whether the failure looks deterministic or flaky",
            "4. the commit and merge request context if available",
            "5. the fastest next debugging or remediation actions"
          ])
        )
      ]
    })
  );

  server.registerPrompt(
    "gitlab_summarize_project_status_workflow",
    {
      title: "Summarize Project Status Workflow",
      description:
        "Guide the model through an objective current-state project summary using dashboard, recent activity, MR, issue, and pipeline tools.",
      argsSchema: {
        project_id: z.string().trim().min(1).describe("GitLab project path or numeric ID."),
        days: z
          .string()
          .trim()
          .optional()
          .describe("Optional recent activity window in days, for example 7 or 14.")
      }
    },
    async ({ project_id, days }) => ({
      description: "Project status summary workflow",
      messages: [
        userMessage(
          lines([
            `Summarize the current delivery status of project "${project_id}".`,
            `Recent activity window: ${days ?? "7"} days.`,
            "",
            "Use these tools as needed:",
            "- gitlab_get_project_dashboard",
            "- gitlab_summarize_project_status",
            "- gitlab_summarize_recent_activity",
            "- gitlab_find_stale_merge_requests",
            "- gitlab_find_failed_pipelines",
            "- gitlab_find_unassigned_issues",
            "",
            "Return:",
            "1. a short health summary",
            "2. the most important active delivery signals",
            "3. top merge request, issue, and pipeline concerns",
            "4. items that look blocked or stale",
            "5. recommended next actions for the team"
          ])
        )
      ]
    })
  );

  server.registerPrompt(
    "gitlab_generate_weekly_delivery_summary_workflow",
    {
      title: "Generate Weekly Delivery Summary Workflow",
      description:
        "Guide the model through a weekly delivery summary for either a project or a group using the MCP's aggregate and activity tools.",
      argsSchema: {
        scope_type: z
          .enum(["project", "group"])
          .describe("Whether the summary target is a single project or a group."),
        scope_id: z.string().trim().min(1).describe("GitLab project or group path, or numeric ID."),
        days: z
          .string()
          .trim()
          .optional()
          .describe("Optional reporting window in days, for example 7.")
      }
    },
    async ({ scope_type, scope_id, days }) => {
      const projectTools = [
        "- gitlab_get_project_dashboard",
        "- gitlab_summarize_recent_activity",
        "- gitlab_generate_release_notes",
        "- gitlab_find_failed_pipelines"
      ];
      const groupTools = [
        "- gitlab_get_group_delivery_overview",
        "- gitlab_list_group_merge_requests",
        "- gitlab_list_group_issues"
      ];

      return {
        description: "Weekly delivery summary workflow",
        messages: [
          userMessage(
            lines([
              `Generate a weekly delivery summary for ${scope_type} "${scope_id}".`,
              `Reporting window: ${days ?? "7"} days.`,
              "",
              "Use these tools as needed:",
              ...(scope_type === "project" ? projectTools : groupTools),
              "",
              "Return:",
              "1. a concise weekly summary",
              "2. notable completed or in-flight delivery work",
              "3. high-risk blockers or regressions",
              "4. pipeline and review health signals",
              "5. a version that is easy to paste into team chat"
            ])
          )
        ]
      };
    }
  );

  server.registerPrompt(
    "gitlab_assess_project_write_safety_workflow",
    {
      title: "Assess Project Write Safety Workflow",
      description:
        "Guide the model through a safety-first assessment of whether AI-assisted writes are appropriate for a GitLab project.",
      argsSchema: {
        project_id: z.string().trim().min(1).describe("GitLab project path or numeric ID.")
      }
    },
    async ({ project_id }) => ({
      description: "Project write safety assessment workflow",
      messages: [
        userMessage(
          lines([
            `Assess whether project "${project_id}" is safe for AI-assisted write actions.`,
            "",
            "Use these tools as needed:",
            "- gitlab_validate_token",
            "- gitlab_get_project",
            "- gitlab_list_protected_branches",
            "- gitlab_get_project_approval_configuration",
            "- gitlab_get_project_approval_rules",
            "- gitlab_check_project_write_risk",
            "",
            "Return:",
            "1. whether the current setup is read-only or write-enabled",
            "2. the project protections that matter most",
            "3. the main reasons the project is low, medium, or high risk for AI writes",
            "4. what additional guardrails should be enabled before allowing writes",
            "5. a clear recommendation"
          ])
        )
      ]
    })
  );
}
