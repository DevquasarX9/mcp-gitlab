import { describe, expect, it } from "vitest";

import { loadConfig, type AppConfig } from "../src/config.js";
import { resolveConfiguredAlias, resolveToolArgumentAliases } from "../src/tools/shared.js";

const baseConfig: AppConfig = {
  gitlabBaseUrl: "https://gitlab.com/api/v4",
  gitlabToken: "test-token",
  tokenHeaderMode: "bearer",
  enableWriteTools: false,
  enableDestructiveTools: false,
  enableDryRun: false,
  projectAliases: {},
  groupAliases: {},
  projectAllowlist: [],
  groupAllowlist: [],
  projectDenylist: [],
  maxFileSizeBytes: 1_048_576,
  maxDiffSizeBytes: 2_097_152,
  maxApiResponseBytes: 4_194_304,
  httpTimeoutMs: 30_000,
  gitlabUserAgent: "gitlab-mcp-server",
  logLevel: "info",
  exposeSecretVariableValues: false
};

describe("alias config parsing", () => {
  it("parses project and group aliases from env", () => {
    const config = loadConfig({
      GITLAB_TOKEN: "test-token",
      PROJECT_ALIASES: "platform=group/platform-api,storefront=commerce/storefront",
      GROUP_ALIASES: "core=engineering/core,commerce=commerce"
    });

    expect(config.projectAliases).toEqual({
      platform: "group/platform-api",
      storefront: "commerce/storefront"
    });
    expect(config.groupAliases).toEqual({
      core: "engineering/core",
      commerce: "commerce"
    });
  });

  it("rejects invalid alias entries", () => {
    expect(() =>
      loadConfig({
        GITLAB_TOKEN: "test-token",
        PROJECT_ALIASES: "broken-entry"
      })
    ).toThrow(/PROJECT_ALIASES entries must use alias=value format/);
  });
});

describe("alias resolution", () => {
  it("resolves direct and chained aliases", () => {
    expect(
      resolveConfiguredAlias(
        "api",
        {
          api: "platform",
          platform: "group/platform-api"
        },
        "project"
      )
    ).toBe("group/platform-api");
  });

  it("detects alias cycles", () => {
    expect(() =>
      resolveConfiguredAlias(
        "api",
        {
          api: "platform",
          platform: "api"
        },
        "project"
      )
    ).toThrow(/alias cycle/i);
  });

  it("normalizes project_id and group_id tool arguments through configured aliases", () => {
    const normalized = resolveToolArgumentAliases(
      {
        project_id: "api",
        group_id: "core",
        merge_request_iid: 42
      },
      {
        ...baseConfig,
        projectAliases: {
          api: "group/platform-api"
        },
        groupAliases: {
          core: "engineering/core"
        }
      }
    );

    expect(normalized).toEqual({
      project_id: "group/platform-api",
      group_id: "engineering/core",
      merge_request_iid: 42
    });
  });
});
