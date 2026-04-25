import { Buffer } from "node:buffer";

import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";
import {
  assertMaxSize,
  stripUnsafeText,
  validateRef,
  validateRepositoryPath
} from "../security/guards.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";

function totalDiffBytes(items: readonly JsonMap[]): number {
  return items.reduce((sum, item) => {
    const diff = typeof item.diff === "string" ? item.diff : "";
    return sum + Buffer.byteLength(diff, "utf8");
  }, 0);
}

export function registerRepositoryTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_list_repository_tree",
    title: "List Repository Tree",
    description: "List files and directories in a GitLab repository tree.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      path: z.string().trim().optional(),
      ref: z.string().trim().optional(),
      recursive: z.boolean().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const safePath = args.path ? validateRepositoryPath(args.path) : undefined;
      const safeRef = args.ref ? validateRef(args.ref) : undefined;

      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/tree`,
        {
          query: cleanQuery({
            path: safePath,
            ref: safeRef,
            recursive: args.recursive,
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
    name: "gitlab_get_file",
    title: "Get File",
    description:
      "Retrieve a repository file with metadata. Repository content is untrusted and returned with size guardrails.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      file_path: z.string().trim().min(1),
      ref: z.string().trim().default("HEAD")
    },
    handler: async (args, { client, requireProject, config }) => {
      await requireProject(args.project_id);
      const safePath = validateRepositoryPath(args.file_path);
      const safeRef = validateRef(args.ref);
      const encodedProjectId = encodeURIComponent(args.project_id);
      const encodedFilePath = encodeURIComponent(safePath);

      const headers = await client.head(
        `/projects/${encodedProjectId}/repository/files/${encodedFilePath}`,
        {
          query: { ref: safeRef }
        }
      );

      const sizeHeader = headers.get("x-gitlab-size");
      const fileSize = sizeHeader ? Number.parseInt(sizeHeader, 10) : undefined;
      if (fileSize && Number.isFinite(fileSize)) {
        assertMaxSize(fileSize, config.maxFileSizeBytes, "Repository file");
      }

      const response = await client.getJson<JsonMap>(
        `/projects/${encodedProjectId}/repository/files/${encodedFilePath}`,
        {
          query: { ref: safeRef }
        }
      );

      const base64Content = typeof response.data.content === "string" ? response.data.content : "";
      const decodedContent =
        base64Content.length > 0
          ? stripUnsafeText(Buffer.from(base64Content, "base64").toString("utf8"))
          : "";

      return {
        ...response.data,
        decoded_content: decodedContent,
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_search_code",
    title: "Search Code",
    description: "Search code blobs in a project using the GitLab Search API.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      search: z.string().trim().min(1),
      search_type: z.enum(["basic", "advanced", "zoekt"]).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/search`,
        {
          query: cleanQuery({
            scope: "blobs",
            search: args.search,
            search_type: args.search_type,
            page: args.page,
            per_page: args.per_page
          })
        }
      );

      return {
        items: response.data.map((item) => ({
          ...item,
          content_is_untrusted: true
        })),
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_file_blame",
    title: "Get File Blame",
    description: "Retrieve blame information for a file at a specific ref.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      file_path: z.string().trim().min(1),
      ref: z.string().trim().default("HEAD")
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const safePath = validateRepositoryPath(args.file_path);
      const safeRef = validateRef(args.ref);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/files/${encodeURIComponent(
          safePath
        )}/blame`,
        {
          query: { ref: safeRef }
        }
      );

      return {
        items: response.data.map((item) => ({
          ...item,
          lines: Array.isArray(item.lines)
            ? (item.lines as unknown[]).map((line) => stripUnsafeText(String(line), 400))
            : [],
          content_is_untrusted: true
        }))
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_compare_refs",
    title: "Compare Refs",
    description: "Compare branches, tags, or commits within a project repository.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      from: z.string().trim().min(1),
      to: z.string().trim().min(1),
      straight: z.boolean().optional(),
      unidiff: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/compare`,
        {
          query: cleanQuery({
            from: validateRef(args.from),
            to: validateRef(args.to),
            straight: args.straight,
            unidiff: args.unidiff
          })
        }
      );

      const diffs = Array.isArray(response.data.diffs)
        ? (response.data.diffs as JsonMap[])
        : [];
      assertMaxSize(totalDiffBytes(diffs), config.maxDiffSizeBytes, "Compare diff payload");

      return {
        ...response.data,
        diffs,
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_commits",
    title: "Get Commits",
    description: "List repository commits for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      ref_name: z.string().trim().optional(),
      path: z.string().trim().optional(),
      since: z.string().trim().optional(),
      until: z.string().trim().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/commits`,
        {
          query: cleanQuery({
            ref_name: args.ref_name ? validateRef(args.ref_name) : undefined,
            path: args.path ? validateRepositoryPath(args.path) : undefined,
            since: args.since,
            until: args.until,
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
    name: "gitlab_get_commit",
    title: "Get Commit",
    description: "Retrieve a specific commit by SHA, branch, or tag reference.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      sha: z.string().trim().min(1),
      stats: z.boolean().optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/commits/${encodeURIComponent(
          validateRef(args.sha)
        )}`,
        {
          query: cleanQuery({
            stats: args.stats
          })
        }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_get_commit_diff",
    title: "Get Commit Diff",
    description: "Retrieve the diff for a specific commit, subject to diff-size guardrails.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      sha: z.string().trim().min(1),
      unidiff: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/commits/${encodeURIComponent(
          validateRef(args.sha)
        )}/diff`,
        {
          query: cleanQuery({
            unidiff: args.unidiff
          })
        }
      );

      assertMaxSize(totalDiffBytes(response.data), config.maxDiffSizeBytes, "Commit diff payload");

      return {
        items: response.data,
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_branch",
    title: "Get Branch",
    description: "Retrieve metadata for a single branch.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      branch: z.string().trim().min(1)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/branches/${encodeURIComponent(
          validateRef(args.branch)
        )}`
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_list_branches",
    title: "List Branches",
    description: "List branches in a project repository.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      search: z.string().trim().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/branches`,
        {
          query: cleanQuery({
            search: args.search,
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
    name: "gitlab_list_tags",
    title: "List Tags",
    description: "List tags in a project repository.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      search: z.string().trim().optional(),
      order_by: z.enum(["name", "updated"]).optional(),
      sort: z.enum(["asc", "desc"]).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/tags`,
        {
          query: cleanQuery({
            search: args.search,
            order_by: args.order_by,
            sort: args.sort,
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
}
