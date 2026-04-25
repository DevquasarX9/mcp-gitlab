import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function tryGetJson(
  client: ToolDeps["client"],
  path: string,
  query?: Record<string, string | number | boolean | readonly string[]>
): Promise<{ data: JsonMap | JsonMap[] | null; warning?: string }> {
  try {
    const response = await client.getJson<JsonMap | JsonMap[]>(path, {
      query
    });
    return {
      data: response.data
    };
  } catch (error) {
    return {
      data: null,
      warning: error instanceof Error ? error.message : String(error)
    };
  }
}

export function summarizeProjectWriteRisk(input: {
  project: JsonMap;
  protectedBranches: readonly JsonMap[];
  approvalConfig?: JsonMap | null;
  approvalRules?: readonly JsonMap[];
  targetBranch?: string | null;
  warnings?: readonly string[];
}): JsonMap {
  const targetBranch =
    input.targetBranch ?? (asString(input.project.default_branch) ?? null);
  const matchingBranch = targetBranch
    ? input.protectedBranches.find((branch) => {
        const name = asString(branch.name);
        return name === targetBranch || name === "*" || (name?.includes("*") ?? false);
      }) ?? null
    : null;

  const concerns: string[] = [];
  const protections: string[] = [];

  if (input.project.archived === true) {
    concerns.push("Project is archived.");
  }

  if (!targetBranch) {
    concerns.push("Project has no detectable default branch.");
  }

  if (!matchingBranch) {
    concerns.push("Target branch is not protected.");
  } else {
    protections.push(`Target branch is protected by rule ${String(matchingBranch.name)}.`);

    if (matchingBranch.allow_force_push === true) {
      concerns.push("Protected branch allows force push.");
    } else {
      protections.push("Force push is disabled on the protected branch.");
    }

    if (matchingBranch.code_owner_approval_required === true) {
      protections.push("Code owner approval is required for the protected branch.");
    }
  }

  const approvalConfig = input.approvalConfig ?? null;
  const approvalRules = input.approvalRules ?? [];
  const approvalsRequired = approvalRules.reduce((sum, rule) => {
    const approvals = asNumber(rule.approvals_required);
    return sum + (approvals ?? 0);
  }, 0);

  if (approvalRules.length === 0 && approvalConfig === null) {
    concerns.push("Approval configuration could not be retrieved.");
  } else {
    if (approvalRules.length === 0) {
      concerns.push("No project approval rules are configured.");
    } else {
      protections.push(
        `${approvalRules.length} approval rule(s) configured with ${approvalsRequired} total required approval(s).`
      );
    }

    if (approvalConfig?.reset_approvals_on_push === true) {
      protections.push("Approvals reset on push.");
    }

    if (approvalConfig?.require_reauthentication_to_approve === true) {
      protections.push("Re-authentication is required to approve.");
    }

    if (approvalConfig?.merge_requests_author_approval === true) {
      concerns.push("Authors can approve their own merge requests.");
    }
  }

  const riskLevel =
    concerns.length >= 3
      ? "high"
      : concerns.length >= 1
        ? "medium"
        : "low";

  return {
    risk_level: riskLevel,
    target_branch: targetBranch,
    protected_branch_rule: matchingBranch,
    approval_rule_count: approvalRules.length,
    approvals_required_total: approvalsRequired,
    protections,
    concerns,
    warnings: input.warnings ?? []
  };
}

export function registerGovernanceTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_list_protected_branches",
    title: "List Protected Branches",
    description:
      "List protected branch rules configured for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/protected_branches`,
        {
          query: cleanQuery({
            page: args.page,
            per_page: args.per_page
          })
        }
      );

      return {
        items: response.data,
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_branch_protection",
    title: "Get Branch Protection",
    description:
      "Retrieve a specific protected branch rule by exact branch name or wildcard.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      branch_name: z.string().trim().min(1)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/protected_branches/${encodeURIComponent(args.branch_name)}`
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_get_project_approval_configuration",
    title: "Get Project Approval Configuration",
    description:
      "Retrieve project-level merge request approval configuration.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/approvals`
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_get_project_approval_rules",
    title: "Get Project Approval Rules",
    description:
      "List project-level merge request approval rules.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/approval_rules`,
        {
          query: cleanQuery({
            page: args.page,
            per_page: args.per_page
          })
        }
      );

      return {
        items: response.data,
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_merge_request_approval_rules",
    title: "Get Merge Request Approval Rules",
    description:
      "List the effective approval rules applied to a merge request.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);

      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/approval_rules`,
        {
          query: cleanQuery({
            page: args.page,
            per_page: args.per_page
          })
        }
      );

      return {
        items: response.data,
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_check_project_write_risk",
    title: "Check Project Write Risk",
    description:
      "Assess whether a project’s branch protections and approval configuration make mutation workflows low-, medium-, or high-risk.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      target_branch: z.string().trim().optional()
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const warnings: string[] = [];

      const [protectedBranchesResult, approvalConfigResult, approvalRulesResult] =
        await Promise.all([
          tryGetJson(
            client,
            `/projects/${encodeURIComponent(args.project_id)}/protected_branches`
          ),
          tryGetJson(client, `/projects/${encodeURIComponent(args.project_id)}/approvals`),
          tryGetJson(client, `/projects/${encodeURIComponent(args.project_id)}/approval_rules`)
        ]);

      if (protectedBranchesResult.warning) {
        warnings.push(`protected_branches: ${protectedBranchesResult.warning}`);
      }

      if (approvalConfigResult.warning) {
        warnings.push(`approval_configuration: ${approvalConfigResult.warning}`);
      }

      if (approvalRulesResult.warning) {
        warnings.push(`approval_rules: ${approvalRulesResult.warning}`);
      }

      const protectedBranches = Array.isArray(protectedBranchesResult.data)
        ? protectedBranchesResult.data
        : [];
      const approvalConfig =
        approvalConfigResult.data && !Array.isArray(approvalConfigResult.data)
          ? approvalConfigResult.data
          : null;
      const approvalRules = Array.isArray(approvalRulesResult.data)
        ? approvalRulesResult.data
        : [];

      return {
        project: {
          id: project.id,
          path_with_namespace: project.path_with_namespace,
          default_branch: project.default_branch,
          archived: project.archived
        },
        assessment: summarizeProjectWriteRisk({
          project,
          protectedBranches,
          approvalConfig,
          approvalRules,
          targetBranch: args.target_branch ?? null,
          warnings
        })
      };
    }
  });
}
