export interface PaginationMeta {
  readonly page?: number;
  readonly perPage?: number;
  readonly nextPage?: number;
  readonly prevPage?: number;
  readonly total?: number;
  readonly totalPages?: number;
  readonly nextLink?: string;
}

export function parsePaginationHeaders(headers: Headers): PaginationMeta {
  const linkHeader = headers.get("link");

  return {
    page: parseOptionalInt(headers.get("x-page")),
    perPage: parseOptionalInt(headers.get("x-per-page")),
    nextPage: parseOptionalInt(headers.get("x-next-page")),
    prevPage: parseOptionalInt(headers.get("x-prev-page")),
    total: parseOptionalInt(headers.get("x-total")),
    totalPages: parseOptionalInt(headers.get("x-total-pages")),
    nextLink: extractNextLink(linkHeader)
  };
}

function parseOptionalInt(value: string | null): number | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractNextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) {
    return undefined;
  }

  const parts = linkHeader.split(",");
  for (const part of parts) {
    const [uri, relation] = part.split(";");
    if (uri && relation?.includes('rel="next"')) {
      return uri.trim().replace(/^<|>$/g, "");
    }
  }

  return undefined;
}
