import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

test("release commands verify inputs and tarball, and dry-run never becomes publication", async () => {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "chess-release-")),
  );
  try {
    for (const name of [
      "scripts",
      "src",
      "bin",
      "docs",
      "tests",
      "examples",
      "assets",
      ".build",
    ])
      fs.mkdirSync(path.join(directory, name));
    for (const name of [
      "bun.lock",
      "tsconfig.json",
      "tsconfig.build.json",
      "tsconfig.scripts.json",
      "playwright.config.ts",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ])
      fs.writeFileSync(path.join(directory, name), "fixture\n");
    const pkg = {
      name: "@test/chess-runtime",
      version: "1.2.3",
      repository: "https://github.com/REPLACE_ME/runtime",
    };
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(pkg));
    for (const name of ["lib.ts", "release/publish.ts"]) {
      fs.mkdirSync(path.dirname(path.join(directory, "scripts", name)), {
        recursive: true,
      });
      fs.copyFileSync(
        path.join("scripts", name),
        path.join(directory, "scripts", name),
      );
    }
    const { releaseFingerprint, sha256 } = await import(
      pathToFileURL(path.join(directory, "scripts/lib.ts")).href
    );
    const tarball = path.join(directory, ".build/package.tgz");
    fs.writeFileSync(tarball, "verified fixture");
    const receipt = {
      name: pkg.name,
      version: pkg.version,
      tarball: ".build/package.tgz",
      sha256: sha256(fs.readFileSync(tarball)),
      fingerprint: releaseFingerprint(),
    };
    fs.writeFileSync(
      path.join(directory, ".build/release.json"),
      JSON.stringify(receipt),
    );

    // Every child uses a fake npm executable: these tests cannot reach a registry.
    const captured = path.join(directory, ".build/arguments.json");
    fs.writeFileSync(
      path.join(directory, "bin/npm"),
      '#!/usr/bin/env bun\nrequire("node:fs").writeFileSync(process.env.RELEASE_TEST_CAPTURE, JSON.stringify(process.argv.slice(2)));\n',
      { mode: 0o755 },
    );
    const invoke = (args: string[]) =>
      spawnSync(
        "bun",
        [path.join(directory, "scripts/release/publish.ts"), ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH:
              path.join(directory, "bin") + path.delimiter + process.env.PATH,
            RELEASE_TEST_CAPTURE: captured,
          },
        },
      );
    // The stub itself is a release input, so seal the receipt after creating it.
    receipt.fingerprint = releaseFingerprint();
    fs.writeFileSync(
      path.join(directory, ".build/release.json"),
      JSON.stringify(receipt),
    );
    assert.equal(invoke(["--dry-run", "--tag", "latest"]).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(captured, "utf8")), [
      "publish",
      tarball,
      "--ignore-scripts",
      "--access",
      "public",
      "--tag",
      "latest",
      "--dry-run",
    ]);
    fs.unlinkSync(captured);
    assert.match(invoke([]).stderr, /Replace the repository/);
    assert.equal(fs.existsSync(captured), false);
    fs.appendFileSync(path.join(directory, "README.md"), "changed");
    assert.match(
      invoke(["--dry-run"]).stderr,
      /Release inputs or tarball changed/,
    );
    fs.writeFileSync(path.join(directory, "README.md"), "fixture\n");
    fs.writeFileSync(tarball, "tampered");
    assert.match(
      invoke(["--dry-run"]).stderr,
      /Release inputs or tarball changed/,
    );
    fs.writeFileSync(tarball, "verified fixture");
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ ...pkg, version: "1.2.4" }),
    );
    assert.match(
      invoke(["--dry-run"]).stderr,
      /Release inputs or tarball changed/,
    );
    assert.equal(fs.existsSync(captured), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
