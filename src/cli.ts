#!/usr/bin/env node
import "dotenv/config";

import { runDoctor, resolveCliMode } from "./doctor.js";
import { runCli } from "./index.js";

const mode = resolveCliMode(process.argv.slice(2));

const entrypoint = mode === "doctor" ? runDoctor : runCli;

void entrypoint().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
