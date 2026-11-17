import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  changedChangesets,
  findViolations,
  formatViolations,
  main,
  majorOf,
  parseChangeset,
  readEvent,
  workspaceVersions,
} from "./check-changeset-bumps.mjs";

const versions = new Map([
  ["@quickben/core", "0.4.0"],
  ["create-quickben", "0.4.0"],
  ["@other/stable", "1.2.0"],
]);

describe("parseChangeset", () => {
  test("reads quoted and unquoted names", () => {
    const text = `---\n"@quickben/core": patch\n'@quickben/admin': minor\ncreate-quickben: major\n---\n\nText.\n`;
    assert.deepEqual(parseChangeset(text), [
      { name: "@quickben/core", bump: "patch" },
      { name: "@quickben/admin", bump: "minor" },
      { name: "create-quickben", bump: "major" },
    ]);
  });

  test("empty changeset has no releases", () => {
    assert.deepEqual(parseChangeset("---\n---\n"), []);
  });

  test("accepts CRLF and quoted bumps", () => {
    assert.deepEqual(parseChangeset('---\r\n"@quickben/core": "patch"\r\n---\r\n'), [
      { name: "@quickben/core", bump: "patch" },
    ]);
  });

  test("rejects malformed files", () => {
    assert.throws(() => parseChangeset("no frontmatter"), /missing frontmatter/);
    assert.throws(() => parseChangeset('---\n"@quickben/core": patch\n'), /not closed/);
    assert.throws(() => parseChangeset('---\n"@quickben/core": huge\n---\n'), /cannot read/);
  });

  test("accepts trailing YAML comments on quoted and unquoted bumps", () => {
    assert.deepEqual(
      parseChangeset(
        '---\n"@quickben/core": patch # corrección compatible\n\'@quickben/admin\': "minor" # owner approval\n---\n',
      ),
      [
        { name: "@quickben/core", bump: "patch" },
        { name: "@quickben/admin", bump: "minor" },
      ],
    );
    assert.throws(
      () => parseChangeset('---\n"@quickben/core": patch#invalid\n---\n'),
      /cannot read/,
    );
  });
});

test("majorOf", () => {
  assert.equal(majorOf("0.4.0"), 0);
  assert.equal(majorOf("12.0.1"), 12);
  assert.equal(majorOf(undefined), undefined);
  assert.equal(majorOf("x"), undefined);
});

describe("findViolations", () => {
  const changesets = [
    {
      file: ".changeset/a.md",
      releases: [
        { name: "@quickben/core", bump: "patch" },
        { name: "@quickben/core", bump: "minor" },
        { name: "create-quickben", bump: "major" },
        { name: "@other/stable", bump: "minor" },
      ],
    },
  ];

  test("without labels only patch passes on 0.x", () => {
    const v = findViolations(changesets, versions, []);
    assert.deepEqual(
      v.map((x) => `${x.name}:${x.bump}`),
      ["@quickben/core:minor", "create-quickben:major"],
    );
  });

  test("release:minor allows minor, not major", () => {
    const v = findViolations(changesets, versions, ["release:minor"]);
    assert.deepEqual(
      v.map((x) => x.bump),
      ["major"],
    );
  });

  test("release:major allows minor and major", () => {
    assert.deepEqual(findViolations(changesets, versions, ["release:major"]), []);
  });

  test("a 1.x package may take a minor", () => {
    const only = [{ file: "x", releases: [{ name: "@other/stable", bump: "minor" }] }];
    assert.deepEqual(findViolations(only, versions, []), []);
  });

  test("an unknown package counts as 0.x", () => {
    const only = [{ file: "x", releases: [{ name: "@quickben/nope", bump: "minor" }] }];
    assert.equal(findViolations(only, versions, []).length, 1);
  });
});

describe("formatViolations", () => {
  test("suggests patch and release:minor", () => {
    const msg = formatViolations([
      { file: ".changeset/a.md", name: "@quickben/core", bump: "minor", version: "0.4.0" },
    ]);
    assert.match(msg, /\.changeset\/a\.md: "@quickben\/core": minor \(current 0\.4\.0\)/);
    assert.match(msg, /`patch`/);
    assert.match(msg, /`release:minor`/);
  });

  test("suggests release:major for a major bump", () => {
    const msg = formatViolations([{ file: "a", name: "x", bump: "major", version: undefined }]);
    assert.match(msg, /`release:major`/);
    assert.match(msg, /current unknown/);
  });
});

describe("readEvent", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "qb-event-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("labels and base SHA from a pull_request payload", () => {
    const file = path.join(dir, "event.json");
    writeFileSync(
      file,
      JSON.stringify({
        pull_request: { labels: [{ name: "release:minor" }], base: { sha: "abc" } },
      }),
    );
    assert.deepEqual(readEvent(file), { labels: ["release:minor"], base: "abc" });
  });

  test("missing or non-PR payload", () => {
    assert.deepEqual(readEvent(undefined), { labels: [], base: undefined });
    const file = path.join(dir, "push.json");
    writeFileSync(file, JSON.stringify({ ref: "refs/heads/trunk" }));
    assert.deepEqual(readEvent(file), { labels: [], base: undefined });
  });
});

describe("in a git repository", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qb-repo-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };

  git("init", "-q", "-b", "trunk");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  write("packages/core/package.json", JSON.stringify({ name: "@quickben/core", version: "0.4.0" }));
  write("apps/site/package.json", JSON.stringify({ name: "site", version: "1.0.0" }));
  write("packages/notes.txt", "not a package");
  write(".changeset/README.md", "# Changesets\n");
  write(".changeset/old.md", '---\n"@quickben/core": minor\n---\n\nOld.\n');
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();

  const run = (argv, env = {}) => {
    const out = [];
    const code = main({ root, argv, env, log: (m) => out.push(m), error: (m) => out.push(m) });
    return { code, out: out.join("\n") };
  };

  test("workspaceVersions reads packages and apps", () => {
    assert.deepEqual(
      workspaceVersions(root),
      new Map([
        ["@quickben/core", "0.4.0"],
        ["site", "1.0.0"],
      ]),
    );
  });

  test("no changed changesets passes; old ones are not checked", () => {
    assert.deepEqual(changedChangesets(root, base), []);
    assert.deepEqual(run(["--base", base]), { code: 0, out: "No changesets added or changed." });
  });

  test("a new minor changeset fails, the label fixes it", () => {
    write(".changeset/README.md", "# Changesets\n\nEdited.\n");
    write(".changeset/config.json", "{}\n");
    write(".changeset/new.md", '---\n"@quickben/core": minor\n---\n\nNew.\n');
    write(".changeset/revisión.md", '---\n"@quickben/core": minor\n---\n\nUnicode.\n');
    git("rm", "-q", ".changeset/old.md");
    git("add", "-A");
    git("commit", "-qm", "change");
    assert.deepEqual(changedChangesets(root, base), [
      ".changeset/new.md",
      ".changeset/revisión.md",
    ]);

    const failed = run(["--base", base]);
    assert.equal(failed.code, 1);
    assert.match(failed.out, /new\.md: "@quickben\/core": minor/);
    assert.match(failed.out, /revisión\.md: "@quickben\/core": minor/);

    const event = path.join(root, "event.json");
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: { labels: [{ name: "release:minor" }], base: { sha: base } },
      }),
    );
    assert.equal(run([], { GITHUB_EVENT_PATH: event }).code, 0);
    assert.equal(run(["--base", base, "--label", "release:minor"]).code, 0);
  });

  test("patch changesets with trailing comments pass without labels", () => {
    for (const file of ["new.md", "revisión.md"]) {
      write(`.changeset/${file}`, '---\n"@quickben/core": patch # compatible\n---\n\nPatch.\n');
    }
    git("add", "-A");
    git("commit", "-qm", "patch");
    const result = run(["--base", base]);
    assert.equal(result.code, 0);
    assert.match(result.out, /Changeset bumps are fine/);
  });

  test("a malformed changeset fails", () => {
    write(".changeset/bad.md", "oops\n");
    git("add", "-A");
    git("commit", "-qm", "bad");
    const result = run(["--base", base, "--label", "release:minor"]);
    assert.equal(result.code, 1);
    assert.match(result.out, /bad\.md: missing frontmatter/);
  });

  test("unknown argument throws", () => {
    assert.throws(() => run(["--nope"]), /unknown argument/);
  });
});
