import { describe, expect, it } from "vitest";

import { parsePaginationHeaders } from "../src/gitlab/pagination.js";

describe("parsePaginationHeaders", () => {
  it("extracts numeric pagination metadata and next link", () => {
    const headers = new Headers({
      "x-page": "2",
      "x-per-page": "20",
      "x-next-page": "3",
      "x-prev-page": "1",
      "x-total": "55",
      "x-total-pages": "3",
      link: '<https://gitlab.example.com/api/v4/projects?page=3>; rel="next", <https://gitlab.example.com/api/v4/projects?page=1>; rel="prev"'
    });

    const result = parsePaginationHeaders(headers);

    expect(result).toEqual({
      page: 2,
      perPage: 20,
      nextPage: 3,
      prevPage: 1,
      total: 55,
      totalPages: 3,
      nextLink: "https://gitlab.example.com/api/v4/projects?page=3"
    });
  });

  it("handles missing headers", () => {
    const result = parsePaginationHeaders(new Headers());
    expect(result).toEqual({
      page: undefined,
      perPage: undefined,
      nextPage: undefined,
      prevPage: undefined,
      total: undefined,
      totalPages: undefined,
      nextLink: undefined
    });
  });
});
