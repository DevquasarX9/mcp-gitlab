import { buildUserFacingError } from "../gitlab/errors.js";

export type ToolEnvelope<T> = Record<string, unknown> & {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly warnings?: readonly string[];
};

export function toolSuccess<T>(data: T, warnings: readonly string[] = []) {
  const payload: ToolEnvelope<T> = {
    ok: true,
    data,
    warnings
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

export function toolFailure(error: unknown, warnings: readonly string[] = []) {
  const payload: ToolEnvelope<never> = {
    ok: false,
    error: buildUserFacingError(error),
    warnings
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true
  };
}
