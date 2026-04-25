import { describe, expect, it } from "vitest";

import { assertDeveloperAccess, assertMaintainerAccess } from "../src/tools/shared.js";

describe("project permission checks", () => {
  it("requires developer access for write operations", () => {
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
