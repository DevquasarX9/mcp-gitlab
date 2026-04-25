export function redactSecrets(value: string, secrets: readonly string[]): string {
  let redacted = value;

  for (const secret of secrets) {
    if (!secret) {
      continue;
    }

    redacted = redacted.split(secret).join("[REDACTED]");
  }

  redacted = redacted.replace(/(authorization["']?\s*:\s*["']?bearer\s+)[^"',\s]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(private-token["']?\s*:\s*["']?)[^"',\s]+/gi, "$1[REDACTED]");

  return redacted;
}

export function redactValue<T>(input: T, secrets: readonly string[]): T {
  return JSON.parse(redactSecrets(JSON.stringify(input), secrets)) as T;
}
