import { describe, expect, it } from "vitest";

import { collectMergeRequestDiscussions } from "../src/tools/mergeRequests.js";

describe("collectMergeRequestDiscussions", () => {
  it("auto-fetches later discussion pages so older notes are not skipped", async () => {
    const calls: Array<{ page?: number; per_page?: number }> = [];
    const client = {
      async getJson<T>(_path: string, options?: { query?: Record<string, unknown> }) {
        const page = typeof options?.query?.page === "number" ? options.query.page : 1;
        const perPage = typeof options?.query?.per_page === "number" ? options.query.per_page : undefined;
        calls.push({
          page,
          per_page: perPage
        });

        if (page === 1) {
          return {
            data: [{ id: "discussion-1", notes: [{ id: 101 }] }] as T,
            headers: new Headers(),
            pagination: {
              page: 1,
              perPage: perPage,
              nextPage: 2,
              total: 2,
              totalPages: 2
            }
          };
        }

        return {
          data: [{ id: "discussion-2", notes: [{ id: 387634 }, { id: 387704 }] }] as T,
          headers: new Headers(),
          pagination: {
            page: 2,
            perPage: perPage,
            total: 2,
            totalPages: 2
          }
        };
      }
    };

    const result = await collectMergeRequestDiscussions(client, {
      projectId: "developers/SGFramework",
      mergeRequestIid: 373,
      perPage: 100,
      maxPages: 10
    });

    expect(calls).toEqual([
      { page: 1, per_page: 100 },
      { page: 2, per_page: 100 }
    ]);
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({
      id: "discussion-2",
      notes: [{ id: 387634 }, { id: 387704 }]
    });
    expect(result.pagination).toMatchObject({
      page: 1,
      perPage: 100,
      total: 2,
      totalPages: 2,
      pagesFetched: 2,
      autoPaginated: true
    });
  });

  it("keeps single-page behavior when a specific page is requested", async () => {
    const calls: Array<{ page?: number; per_page?: number }> = [];
    const client = {
      async getJson<T>(_path: string, options?: { query?: Record<string, unknown> }) {
        const page = typeof options?.query?.page === "number" ? options.query.page : 1;
        const perPage = typeof options?.query?.per_page === "number" ? options.query.per_page : undefined;
        calls.push({
          page,
          per_page: perPage
        });

        return {
          data: [{ id: `discussion-${page}` }] as T,
          headers: new Headers(),
          pagination: {
            page,
            perPage,
            nextPage: 3,
            total: 3,
            totalPages: 3
          }
        };
      }
    };

    const result = await collectMergeRequestDiscussions(client, {
      projectId: "developers/SGFramework",
      mergeRequestIid: 373,
      page: 2,
      perPage: 50,
      maxPages: 10
    });

    expect(calls).toEqual([{ page: 2, per_page: 50 }]);
    expect(result.items).toEqual([{ id: "discussion-2" }]);
    expect(result.pagination).toMatchObject({
      page: 2,
      perPage: 50,
      nextPage: 3,
      pagesFetched: 1,
      autoPaginated: false
    });
  });
});
