#!/usr/bin/env node
import process from "node:process";

import { runCli } from "./cli-run";

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
// Drain pipes before exiting; large exports may still be buffered.
await Promise.all([
  new Promise<void>((done) =>
    process.stdout.write("", () => {
      done();
    }),
  ),
  new Promise<void>((done) =>
    process.stderr.write("", () => {
      done();
    }),
  ),
]);
process.exit();
