#!/usr/bin/env node
import process from "node:process";

import { runCli } from "./cli-run";

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
// The runner and the database may keep the process alive.
process.exit();
