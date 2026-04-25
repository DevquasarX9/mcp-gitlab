import path from "node:path";

import type { AppConfig } from "../config.js";
import { GuardrailError } from "../gitlab/errors.js";

export type SafetyLevel = "read-only" | "safe-write" | "destructive" | "admin-only";

export const ACCESS_LEVEL = {
  guest: 10,
  reporter: 20,
  developer: 30,
  maintainer: 40,
  owner: 50
} as const;

export function assertWriteEnabled(config: AppConfig): void {
  if (!config.enableWriteTools) {
    throw new GuardrailError(
      "Write tools are disabled. Set ENABLE_WRITE_TOOLS=true to allow write operations.",
      "WRITE_DISABLED"
    );
  }
}

export function assertDestructiveEnabled(
  config: AppConfig,
  confirmDestructive?: boolean
): void {
  if (!config.enableDestructiveTools) {
    throw new GuardrailError(
      "Destructive tools are disabled. Set ENABLE_DESTRUCTIVE_TOOLS=true to allow destructive operations.",
      "DESTRUCTIVE_DISABLED"
    );
  }

  if (!confirmDestructive) {
    throw new GuardrailError(
      "This operation is destructive. Re-run it with confirm_destructive=true.",
      "DESTRUCTIVE_CONFIRMATION_REQUIRED"
    );
  }
}

export function assertProjectAllowed(
  config: AppConfig,
  project: { id?: number; path_with_namespace?: string; namespace?: { full_path?: string } }
): void {
  const projectId = project.id ? String(project.id) : undefined;
  const fullPath = project.path_with_namespace;
  const namespace = project.namespace?.full_path;

  if (
    config.projectDenylist.some(
      (entry) => entry === projectId || entry === fullPath || entry === namespace
    )
  ) {
    throw new GuardrailError("The target project is explicitly denied by configuration.", "PROJECT_DENIED");
  }

  if (
    config.projectAllowlist.length > 0 &&
    !config.projectAllowlist.some(
      (entry) => entry === projectId || entry === fullPath || entry === namespace
    )
  ) {
    throw new GuardrailError("The target project is not on the configured allowlist.", "PROJECT_NOT_ALLOWED");
  }

  if (
    config.groupAllowlist.length > 0 &&
    namespace &&
    !config.groupAllowlist.some(
      (entry) => namespace === entry || namespace.startsWith(`${entry}/`)
    )
  ) {
    throw new GuardrailError("The target project is outside the configured group allowlist.", "GROUP_NOT_ALLOWED");
  }
}

export function assertGroupAllowed(
  config: AppConfig,
  group: { id?: number; full_path?: string }
): void {
  if (config.groupAllowlist.length === 0) {
    return;
  }

  const groupId = group.id ? String(group.id) : undefined;
  const fullPath = group.full_path;

  const allowed = config.groupAllowlist.some(
    (entry) => entry === groupId || entry === fullPath || fullPath?.startsWith(`${entry}/`)
  );

  if (!allowed) {
    throw new GuardrailError("The target group is not on the configured allowlist.", "GROUP_NOT_ALLOWED");
  }
}

export function assertMaxSize(size: number, maxSize: number, label: string): void {
  if (size > maxSize) {
    throw new GuardrailError(
      `${label} exceeds the configured limit (${size} bytes > ${maxSize} bytes).`,
      "SIZE_LIMIT_EXCEEDED"
    );
  }
}

export function validateRepositoryPath(filePath: string): string {
  if (filePath.includes("\0")) {
    throw new GuardrailError("Repository paths cannot contain null bytes.", "INVALID_PATH");
  }

  const normalized = path.posix.normalize(filePath.trim());
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.startsWith("/")
  ) {
    throw new GuardrailError("Repository paths must stay within the repository root.", "INVALID_PATH");
  }

  return normalized;
}

export function validateRef(ref: string): string {
  const normalized = ref.trim();

  if (normalized.length === 0) {
    throw new GuardrailError("Git ref cannot be empty.", "INVALID_REF");
  }

  if (normalized.includes("\0")) {
    throw new GuardrailError("Git ref cannot contain null bytes.", "INVALID_REF");
  }

  return normalized;
}

export function stripUnsafeText(text: string, maxLength = 12_000): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text;
}
