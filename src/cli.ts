#!/usr/bin/env node
import "dotenv/config";

import { runCli } from "./index.js";

void runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
