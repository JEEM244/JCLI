#!/usr/bin/env node
import "dotenv/config";
import { runCli } from "./cli.js";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Error desconocido.";
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
