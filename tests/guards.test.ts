import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import {
  assertDestructiveEnabled,
  assertProjectAllowed,
  assertWriteEnabled,
  validateRepositoryPath
} from "../src/security/guards.js";

const baseConfig: AppConfig = {
  gitlabBaseUrl: "https://gitlab.com/api/v4",
  gitlabToken: "test-token",
  tokenHeaderMode: "bearer",
  enableWriteTools: false,
  enableDestructiveTools: false,
  enableDryRun: false,
  projectAllowlist: [],
  groupAllowlist: [],
  projectDenylist: [],
  maxFileSizeBytes: 1024,
  maxDiffSizeBytes: 2048,
  maxApiResponseBytes: 4096,
  httpTimeoutMs: 5000,
  gitlabUserAgent: "test-agent",
  logLevel: "error",
  exposeSecretVariableValues: false
};

describe("security guards", () => {
  it("blocks write operations when write tools are disabled", () => {
    expect(() => assertWriteEnabled(baseConfig)).toThrow(/Write tools are disabled/);
  });

  it("blocks destructive operations without the destructive feature flag", () => {
    expect(() => assertDestructiveEnabled(baseConfig, true)).toThrow(/Destructive tools are disabled/);
  });

  it("requires explicit destructive confirmation", () => {
    expect(() =>
      assertDestructiveEnabled(
        {
          ...baseConfig,
          enableDestructiveTools: true
        },
        false
      )
    ).toThrow(/confirm_destructive=true/);
  });

  it("rejects denied projects", () => {
    const config: AppConfig = {
      ...baseConfig,
      projectDenylist: ["group/project"]
    };

    expect(() =>
      assertProjectAllowed(config, {
        id: 1,
        path_with_namespace: "group/project",
        namespace: { full_path: "group" }
      })
    ).toThrow(/explicitly denied/);
  });

  it("validates repository paths against traversal", () => {
    expect(validateRepositoryPath("src/index.ts")).toBe("src/index.ts");
    expect(() => validateRepositoryPath("../etc/passwd")).toThrow(/repository root/);
    expect(() => validateRepositoryPath("/absolute/path")).toThrow(/repository root/);
  });
});
