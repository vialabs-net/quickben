#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { main } from "./cli";
import { clackPrompter } from "./prompts";
import { spawnRunner } from "./run";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  isTTY: process.stdin.isTTY && process.stdout.isTTY,
  templateDir: fileURLToPath(new URL("templates", import.meta.url)),
  version: manifest.version,
  prompter: clackPrompter(),
  run: spawnRunner,
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
  error: (line) => {
    process.stderr.write(`${line}\n`);
  },
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
