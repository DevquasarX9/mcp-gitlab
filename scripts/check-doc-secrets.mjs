#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = [
  ".env.example",
  "README.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "docs",
  "examples"
];

const allowedPlaceholderFragments = [
  "xxxx",
  "your-",
  "replace-",
  "example",
  "placeholder",
  "local-secret",
  "test-token",
  "${",
  "<",
  ">"
];

const sensitiveEnvNames = new Set([
  "GITLAB_TOKEN",
  "MCP_HTTP_AUTH_TOKEN",
  "NPM_TOKEN"
]);

function isAllowedPlaceholder(value) {
  const normalized = value.trim().replace(/^["']|["']$/g, "");

  if (normalized.length === 0) {
    return true;
  }

  if (/^x+$/i.test(normalized.replace(/^glpat-/, ""))) {
    return true;
  }

  return allowedPlaceholderFragments.some((fragment) =>
    normalized.toLowerCase().includes(fragment)
  );
}

function isTextFile(path) {
  return /\.(md|json|toml|ya?ml|env|example)$/i.test(path) ||
    path === ".env.example" ||
    path === "README.md" ||
    path === "SECURITY.md" ||
    path === "CHANGELOG.md";
}

async function collectFiles(path) {
  if (isTextFile(path)) {
    return [path];
  }

  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => collectFiles(join(path, entry.name)))
  );

  return nested.flat().filter(isTextFile);
}

function collectLineFindings(file, lineNumber, line) {
  const findings = [];

  for (const match of line.matchAll(/\bglpat-[A-Za-z0-9_-]{20,}\b/g)) {
    if (!isAllowedPlaceholder(match[0])) {
      findings.push({
        file,
        lineNumber,
        reason: "real-looking GitLab personal access token"
      });
    }
  }

  for (const match of line.matchAll(/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g)) {
    findings.push({
      file,
      lineNumber,
      reason: `real-looking GitHub token prefix ${match[0].slice(0, 4)}`
    });
  }

  for (const match of line.matchAll(/\bsk-[A-Za-z0-9]{32,}\b/g)) {
    findings.push({
      file,
      lineNumber,
      reason: `real-looking API key prefix ${match[0].slice(0, 3)}`
    });
  }

  for (const match of line.matchAll(/\bAIza[0-9A-Za-z_-]{35}\b/g)) {
    findings.push({
      file,
      lineNumber,
      reason: `real-looking Google API key prefix ${match[0].slice(0, 4)}`
    });
  }

  const bearerMatch = line.match(/\bAuthorization\b[^\n]*\bBearer\s+([^"'\s]+)/i);
  if (bearerMatch?.[1] && !isAllowedPlaceholder(bearerMatch[1])) {
    findings.push({
      file,
      lineNumber,
      reason: "real-looking bearer token in documentation"
    });
  }

  const envMatch = line.match(/\b([A-Z0-9_]*TOKEN)\b\s*[:=]\s*["']?([^"',\s]*)/);
  if (envMatch?.[1] && sensitiveEnvNames.has(envMatch[1])) {
    const value = envMatch[2] ?? "";
    if (!isAllowedPlaceholder(value)) {
      findings.push({
        file,
        lineNumber,
        reason: `real-looking ${envMatch[1]} value`
      });
    }
  }

  return findings;
}

const files = (await Promise.all(roots.map(collectFiles))).flat();
const findings = [];

for (const file of files) {
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    findings.push(...collectLineFindings(file, index + 1, line));
  }
}

if (findings.length > 0) {
  console.error("Documentation secret check failed:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.lineNumber} ${finding.reason}`);
  }

  process.exitCode = 1;
} else {
  console.log(`docs secret check ok: scanned ${files.length} files`);
}
