import { describe, expect, it } from "vitest";

import {
  buildGitLabSearchLabelsRequest,
  buildGitLabSearchRequest
} from "../src/tools/search.js";

const context = {
  resolveProjectId: (projectId: string) => projectId === "api" ? "group/project-api" : projectId,
  resolveGroupId: (groupId: string) => groupId === "platform" ? "engineering/platform" : groupId,
  requireProject: async (_projectId: string) => ({}),
  requireGroup: async (_groupId: string) => ({}),
  config: {
    projectAllowlist: [],
    groupAllowlist: [],
    projectDenylist: []
  }
};

describe("gitlab search tool helpers", () => {
  it("builds a global search request when no target is provided", async () => {
    const request = await buildGitLabSearchRequest(
      {
        scope: "issues",
        search: "flaky test",
        state: "opened",
        per_page: 50
      },
      context
    );

    expect(request).toEqual({
      path: "/search",
      target: "global",
      query: {
        scope: "issues",
        search: "flaky test",
        state: "opened",
        per_page: 50
      }
    });
  });

  it("builds an allowlist-checked project search request", async () => {
    const request = await buildGitLabSearchRequest(
      {
        scope: "blobs",
        search: "authentication middleware",
        project_id: "api",
        search_type: "advanced",
        fields: ["title"]
      },
      context
    );

    expect(request.path).toBe("/projects/group%2Fproject-api/search");
    expect(request.target).toBe("project");
    expect(request.query).toMatchObject({
      scope: "blobs",
      search: "authentication middleware",
      search_type: "advanced",
      fields: ["title"]
    });
  });

  it("builds an allowlist-checked group search request", async () => {
    const request = await buildGitLabSearchRequest(
      {
        scope: "work_items",
        search: "release blocker",
        group_id: "platform",
        type: ["issue", "task"],
        sort: "desc",
        order_by: "created_at"
      },
      context
    );

    expect(request.path).toBe("/groups/engineering%2Fplatform/search");
    expect(request.target).toBe("group");
    expect(request.query).toMatchObject({
      scope: "work_items",
      search: "release blocker",
      type: ["issue", "task"],
      sort: "desc",
      order_by: "created_at"
    });
  });

  it("rejects ambiguous search targets", async () => {
    await expect(
      buildGitLabSearchRequest(
        {
          scope: "issues",
          search: "ambiguous",
          project_id: "api",
          group_id: "platform"
        },
        context
      )
    ).rejects.toThrow(/either project_id or group_id, not both/);
  });

  it("rejects global search when project or group scope controls are configured", async () => {
    await expect(
      buildGitLabSearchRequest(
        {
          scope: "issues",
          search: "scoped only"
        },
        {
          ...context,
          config: {
            ...context.config,
            projectAllowlist: ["group/project-api"]
          }
        }
      )
    ).rejects.toThrow(/Global gitlab_search is disabled/);
  });

  it("builds project and group label search requests", async () => {
    const projectRequest = await buildGitLabSearchLabelsRequest(
      {
        full_path: "api",
        is_project: true,
        search: "bug",
        with_counts: true,
        include_ancestor_groups: true
      },
      context
    );

    expect(projectRequest).toEqual({
      path: "/projects/group%2Fproject-api/labels",
      target: "project",
      query: {
        search: "bug",
        with_counts: true,
        include_ancestor_groups: true
      }
    });

    const groupRequest = await buildGitLabSearchLabelsRequest(
      {
        full_path: "platform",
        is_project: false,
        search: "workflow"
      },
      context
    );

    expect(groupRequest).toEqual({
      path: "/groups/engineering%2Fplatform/labels",
      target: "group",
      query: {
        search: "workflow"
      }
    });
  });
});
