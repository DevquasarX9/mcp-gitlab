import { describe, expect, it } from "vitest";

import {
  GitLabApiError,
  buildUserFacingError,
  normalizeGitLabError
} from "../src/gitlab/errors.js";

describe("GitLab error normalization", () => {
  it("normalizes rate-limit responses", () => {
    const error = normalizeGitLabError({
      status: 429,
      endpoint: "https://gitlab.example.com/api/v4/projects",
      requestId: "abc-123",
      retryAfterHeader: "60",
      body: { message: "Too Many Requests" }
    });

    expect(error).toBeInstanceOf(GitLabApiError);
    expect(error.retryAfterSeconds).toBe(60);
    expect(buildUserFacingError(error)).toContain("Retry after 60 seconds");
  });

  it("builds a helpful auth error", () => {
    const error = normalizeGitLabError({
      status: 401,
      endpoint: "https://gitlab.example.com/api/v4/user",
      body: { message: "401 Unauthorized" }
    });

    expect(buildUserFacingError(error)).toContain("authentication failed");
  });
});
