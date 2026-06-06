import { describe, expect, it } from "vitest";

import {
  buildMergeRequestCommitsRequest,
  buildMergeRequestPipelinesRequest
} from "../src/tools/mergeRequests.js";

describe("merge request related collection helpers", () => {
  it("builds an MR commits request with encoded project path and pagination", () => {
    expect(
      buildMergeRequestCommitsRequest({
        project_id: "group/project-api",
        merge_request_iid: 42,
        page: 2,
        per_page: 50
      })
    ).toEqual({
      path: "/projects/group%2Fproject-api/merge_requests/42/commits",
      query: {
        page: 2,
        per_page: 50
      }
    });
  });

  it("builds an MR pipelines request without empty optional query values", () => {
    expect(
      buildMergeRequestPipelinesRequest({
        project_id: "platform/api",
        merge_request_iid: 7
      })
    ).toEqual({
      path: "/projects/platform%2Fapi/merge_requests/7/pipelines",
      query: {}
    });
  });
});
