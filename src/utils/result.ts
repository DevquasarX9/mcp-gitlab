import { buildUserFacingError } from "../gitlab/errors.js";
import { isToolPresentation } from "../tools/output.js";

export type ToolEnvelope<T> = Record<string, unknown> & {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly warnings?: readonly string[];
};

export function toolSuccess<T>(data: T, warnings: readonly string[] = []) {
  const unwrappedData = isToolPresentation(data) ? data.data : data;
  const payload: ToolEnvelope<T> = {
    ok: true,
    data: unwrappedData as T,
    warnings
  };

  return {
    content: [{
      type: "text" as const,
      text: isToolPresentation(data) ? data.contentText : JSON.stringify(payload, null, 2)
    }],
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
