import { describe, expect, it } from "vitest";

import { assertCommentAccess, assertDeveloperAccess, assertMaintainerAccess } from "../src/tools/shared.js";

describe("project permission checks", () => {
  it("requires guest access for comment operations", () => {
    expect(() =>
      assertCommentAccess({
        permissions: {
          project_access: {
            access_level: 0
          }
        }
      })
    ).toThrow(/Guest-level access/);
  });

  it("accepts guest access for comment operations", () => {
    expect(() =>
      assertCommentAccess({
        permissions: {
          project_access: {
            access_level: 10
          }
        }
      })
    ).not.toThrow();
  });

  it("requires developer access for non-comment write operations", () => {
    expect(() =>
      assertDeveloperAccess({
        permissions: {
          project_access: {
            access_level: 20
          }
        }
      })
    ).toThrow(/Developer-level access/);
  });

  it("accepts developer access", () => {
    expect(() =>
      assertDeveloperAccess({
        permissions: {
          project_access: {
            access_level: 30
          }
        }
      })
    ).not.toThrow();
  });

  it("requires maintainer access for sensitive project reads", () => {
    expect(() =>
      assertMaintainerAccess({
        permissions: {
          project_access: {
            access_level: 30
          }
        }
      })
    ).toThrow(/Maintainer-level access/);
  });
});
