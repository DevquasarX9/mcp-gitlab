#!/usr/bin/env node
import "dotenv/config";

import { runDoctor, resolveCliMode } from "./doctor.js";
import { runHttpServer } from "./httpServer.js";
import { runCli } from "./index.js";

const mode = resolveCliMode(process.argv.slice(2));

const entrypoint = mode === "doctor" ? runDoctor : mode === "http" ? runHttpServer : runCli;

void entrypoint().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
