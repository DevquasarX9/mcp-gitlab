import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";
import { stripUnsafeText } from "../security/guards.js";
import {
  assertDeveloperAccess,
  assertMaintainerAccess,
  cleanQuery,
  registerTool,
  type ToolDeps
} from "./shared.js";

function redactVariables(
  variables: readonly JsonMap[],
  exposeValues: boolean
): readonly JsonMap[] {
  return variables.map((item) =>
    exposeValues
      ? item
      : {
          ...item,
          value: "[REDACTED]"
        }
  );
}

export function registerPipelineTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_list_pipelines",
    title: "List Pipelines",
    description: "List pipelines for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      status: z.string().trim().optional(),
      ref: z.string().trim().optional(),
      source: z.string().trim().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines`,
        {
          query: cleanQuery({
            status: args.status,
            ref: args.ref,
            source: args.source,
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
    name: "gitlab_get_pipeline",
    title: "Get Pipeline",
    description: "Retrieve a single pipeline by ID.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_list_pipeline_jobs",
    title: "List Pipeline Jobs",
    description: "List jobs for a specific pipeline.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive(),
      include_retried: z.boolean().optional(),
      scope: z.array(z.string().trim().min(1)).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}/jobs`,
        {
          query: cleanQuery({
            include_retried: args.include_retried,
            scope: args.scope,
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
    name: "gitlab_get_job",
    title: "Get Job",
    description: "Retrieve a single CI/CD job by ID.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      job_id: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/jobs/${args.job_id}`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_get_job_trace",
    title: "Get Job Trace",
    description:
      "Return the job trace text. Job output is untrusted and trimmed to a caller-specified tail length.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      job_id: z.number().int().positive(),
      tail_lines: z.number().int().positive().max(500).optional().default(120)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<string>(
        `/projects/${encodeURIComponent(args.project_id)}/jobs/${args.job_id}/trace`
      );

      const traceText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      const lines = traceText.split("\n");

      return {
        content_is_untrusted: true,
        total_lines: lines.length,
        tail_lines: args.tail_lines,
        trace_tail: stripUnsafeText(lines.slice(-args.tail_lines).join("\n"), 24_000)
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_retry_job",
    title: "Retry Job",
    description: "Retry a failed or canceled job.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      job_id: z.number().int().positive()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/jobs/${args.job_id}/retry`
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/jobs/${args.job_id}/retry`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_cancel_pipeline",
    title: "Cancel Pipeline",
    description:
      "Cancel a running pipeline. This is treated as destructive and requires confirm_destructive=true.",
    safety: "destructive",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive(),
      confirm_destructive: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/pipelines/${args.pipeline_id}/cancel`
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}/cancel`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_trigger_pipeline",
    title: "Trigger Pipeline",
    description: "Create a new pipeline on a branch or tag.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      ref: z.string().trim().min(1),
      variables: z
        .array(
          z.object({
            key: z.string().trim().min(1),
            value: z.string(),
            variable_type: z.enum(["env_var", "file"]).optional()
          })
        )
        .optional(),
      inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        ref: args.ref,
        variables: args.variables,
        inputs: args.inputs
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/pipeline`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/pipeline`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_list_project_variables",
    title: "List Project Variables",
    description:
      "List CI/CD variables for a project. Secret values are redacted unless EXPOSE_SECRET_VARIABLE_VALUES=true.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertMaintainerAccess(project);

      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/variables`,
        {
          query: cleanQuery({
            page: args.page,
            per_page: args.per_page
          })
        }
      );

      return {
        items: redactVariables(response.data, config.exposeSecretVariableValues),
        pagination: response.pagination,
        secret_values_redacted: !config.exposeSecretVariableValues
      };
    }
  });
}
