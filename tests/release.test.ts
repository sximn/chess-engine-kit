import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { releaseNotes, releaseArguments } from "../scripts/release/metadata.ts";
import { publishArguments } from "../scripts/release/publish.ts";
import {
  readRegistryPackage,
  verifyRegistryArtifact,
  verifyRegistryChannel,
  verifyChannelAdvance,
  type RegistryPackage,
} from "../scripts/release/registry.ts";
import { compareEngineArtifacts } from "../scripts/maintenance/engine/verify-reproducibility.ts";

const notes =
  "## [Unreleased]\n\n## [1.2.3] - 2026-10-28\n\n### Fixed\n\n- Preserve the completed analysis.\n";

test("release notes require a unique dated version entry with useful content", () => {
  assert.equal(
    releaseNotes(notes, "1.2.3"),
    "### Fixed\n\n- Preserve the completed analysis.\n",
  );
  for (const invalid of [
    notes.replace("1.2.3", "1.2.2"),
    notes + notes,
    notes.replace("2026-10-28", "2026-02-31"),
    notes.replace("- Preserve the completed analysis.", ""),
    notes.replace("Preserve the completed analysis.", "TODO"),
  ])
    assert.throws(() => releaseNotes(invalid, "1.2.3"));
  assert.throws(() => releaseArguments(["--tag"]));
  assert.throws(() => publishArguments(["--unknown"]));
  assert.throws(() => publishArguments(["--tag", "typo"]));
  assert.deepEqual(publishArguments(["--dry-run", "--release-tag", "v1.2.3"]), {
    dryRun: true,
    tag: "next",
    releaseTag: "v1.2.3",
  });
});

test("engine verification detects stale bytes, notices and extra or missing assets without modifying originals", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-assets-"));
  try {
    const original = path.join(temp, "original"),
      rebuilt = path.join(temp, "rebuilt");
    fs.mkdirSync(original);
    fs.mkdirSync(rebuilt);
    for (const directory of [original, rebuilt]) {
      fs.mkdirSync(path.join(directory, "licenses"));
      fs.writeFileSync(path.join(directory, "engine.wasm"), "wasm");
      fs.writeFileSync(path.join(directory, "licenses/MIT"), "notice");
    }
    fs.writeFileSync(
      path.join(original, "engine-manifest.json"),
      JSON.stringify({
        wasmSha256: "binary",
        buildHash: "source",
        gzipBytes: 10,
        brotliBytes: 8,
      }),
    );
    fs.writeFileSync(
      path.join(rebuilt, "engine-manifest.json"),
      JSON.stringify({
        wasmSha256: "binary",
        buildHash: "source",
        gzipBytes: 11,
        brotliBytes: 9,
      }),
    );
    compareEngineArtifacts(original, rebuilt);
    fs.writeFileSync(
      path.join(rebuilt, "engine-manifest.json"),
      JSON.stringify({
        wasmSha256: "other-binary",
        buildHash: "source",
        gzipBytes: 11,
        brotliBytes: 9,
      }),
    );
    assert.throws(
      () => compareEngineArtifacts(original, rebuilt),
      /engine-manifest.json/,
    );
    fs.copyFileSync(
      path.join(original, "engine-manifest.json"),
      path.join(rebuilt, "engine-manifest.json"),
    );
    fs.writeFileSync(path.join(rebuilt, "engine.wasm"), "new wasm");
    assert.throws(
      () => compareEngineArtifacts(original, rebuilt),
      /engine.wasm/,
    );
    assert.equal(
      fs.readFileSync(path.join(original, "engine.wasm"), "utf8"),
      "wasm",
    );
    fs.writeFileSync(path.join(rebuilt, "engine.wasm"), "wasm");
    fs.writeFileSync(path.join(rebuilt, "licenses/MIT"), "new notice");
    assert.throws(
      () => compareEngineArtifacts(original, rebuilt),
      /licenses\/MIT/,
    );
    fs.writeFileSync(path.join(rebuilt, "licenses/MIT"), "notice");
    fs.writeFileSync(path.join(rebuilt, "extra"), "");
    assert.throws(() => compareEngineArtifacts(original, rebuilt), /extra/);
    fs.unlinkSync(path.join(rebuilt, "extra"));
    fs.unlinkSync(path.join(rebuilt, "engine.wasm"));
    assert.throws(
      () => compareEngineArtifacts(original, rebuilt),
      /engine.wasm/,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("registry checks bind package identity, exact archive bytes and the requested channel", async () => {
  const bytes = Buffer.from("verified tarball");
  const pkg: RegistryPackage = {
    versions: {
      "1.2.3": {
        name: "test",
        version: "1.2.3",
        dist: {
          integrity:
            "sha512-" + createHash("sha512").update(bytes).digest("base64"),
        },
      },
    },
    "dist-tags": { next: "1.2.3" },
  };
  verifyRegistryArtifact(pkg, "test", "1.2.3", bytes);
  verifyRegistryChannel(pkg, "1.2.3", "next");
  verifyChannelAdvance(pkg, "1.3.0", "next");
  assert.throws(
    () => verifyChannelAdvance(pkg, "1.2.2", "next"),
    /roll the channel backward/,
  );
  assert.throws(
    () =>
      verifyRegistryArtifact(pkg, "test", "1.2.3", Buffer.from("different")),
    /different bytes/,
  );
  assert.throws(() => verifyRegistryArtifact(pkg, "wrong", "1.2.3", bytes));
  assert.throws(
    () => verifyRegistryChannel(pkg, "1.2.3", "latest"),
    /will not silently move/,
  );
  const request = async (url: string) => {
    assert.equal(url, "https://registry.npmjs.org/%40test%2Fpackage");
    return new Response("{}", { status: 404 });
  };
  assert.equal(await readRegistryPackage("@test/package", request), null);
});

test("publication validates Git history, artifacts and engine evidence; retries never republish different bytes", async () => {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "chess-release-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    for (const name of [
      "src",
      "bin",
      "docs",
      "tests",
      "examples",
      "assets/frozenight",
      "engine",
      ".github",
      ".build/reports",
    ])
      fs.mkdirSync(path.join(directory, name), { recursive: true });
    for (const name of [
      "bun.lock",
      "tsconfig.json",
      "tsconfig.build.json",
      "playwright.config.ts",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ])
      fs.writeFileSync(path.join(directory, name), "fixture\n");
    fs.writeFileSync(path.join(directory, ".gitignore"), ".build/\n");
    fs.writeFileSync(path.join(directory, "CHANGELOG.md"), notes);
    const pkg = {
      name: "@test/chess-runtime",
      version: "1.2.3",
      repository: { url: "git+https://github.com/sximn/chess-engine-kit.git" },
    };
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(pkg));
    const manifest = { wasmSha256: "wasm-hash", buildHash: "source-hash" };
    fs.writeFileSync(
      path.join(directory, "assets/frozenight/engine-manifest.json"),
      JSON.stringify(manifest),
    );
    fs.writeFileSync(path.join(directory, "engine/source.rs"), "source");
    for (const name of [
      "lib.ts",
      "release/metadata.ts",
      "release/registry.ts",
      "release/publish.ts",
      "release/finish-release.ts",
    ]) {
      fs.mkdirSync(path.dirname(path.join(directory, "scripts", name)), {
        recursive: true,
      });
      fs.copyFileSync(
        path.join("scripts", name),
        path.join(directory, "scripts", name),
      );
    }
    git("init", "-q", "-b", "main");
    const commit = () => {
      git("add", "--all");
      git(
        "-c",
        "user.name=Release test",
        "-c",
        "user.email=release@example.test",
        "commit",
        "-qm",
        "fixture",
      );
    };
    commit();
    git("tag", "v1.2.3");
    const moduleUrl = (name: string) =>
      pathToFileURL(path.join(directory, "scripts", name)).href;
    const { releaseFingerprint, releaseCommit, sha256 } = await import(
      moduleUrl("lib.ts")
    );
    const { validateRelease } = await import(moduleUrl("release/metadata.ts"));
    const { publishRelease } = await import(moduleUrl("release/publish.ts"));
    // Tests do not use the host workflow's repository/default-branch environment.
    const priorBranch = process.env.RELEASE_DEFAULT_BRANCH;
    const priorExpectedCommit = process.env.RELEASE_EXPECTED_COMMIT;
    const priorRepository = process.env.GITHUB_REPOSITORY;
    const priorToken = process.env.GH_TOKEN;
    const priorSummary = process.env.GITHUB_STEP_SUMMARY;
    delete process.env.RELEASE_DEFAULT_BRANCH;
    delete process.env.RELEASE_EXPECTED_COMMIT;
    process.env.GITHUB_REPOSITORY = "sximn/chess-engine-kit";
    // Mock publications must never appear as real releases in the host CI summary.
    process.env.GITHUB_STEP_SUMMARY = path.join(
      directory,
      ".build/test-summary.md",
    );
    try {
      assert.equal(validateRelease("v1.2.3", "next").commit, releaseCommit());
      assert.throws(
        () => validateRelease("v1.2.2", "next"),
        /matching package.json/,
      );
      fs.appendFileSync(path.join(directory, "README.md"), "uncommitted");
      assert.throws(() => validateRelease("v1.2.3", "next"), /checkout clean/);
      fs.writeFileSync(path.join(directory, "README.md"), "fixture\n");
      fs.writeFileSync(path.join(directory, "forgotten-file"), "untracked");
      assert.throws(() => validateRelease("v1.2.3", "next"), /checkout clean/);
      fs.unlinkSync(path.join(directory, "forgotten-file"));
      fs.writeFileSync(path.join(directory, "README.md"), "next commit");
      commit();
      assert.throws(
        () => validateRelease("v1.2.3", "next"),
        /does not match HEAD/,
      );
      git("tag", "-f", "v1.2.3");
      process.env.RELEASE_DEFAULT_BRANCH = "main";
      assert.throws(() => validateRelease("v1.2.3", "next"), /default branch/);
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      validateRelease("v1.2.3", "next");
      delete process.env.RELEASE_DEFAULT_BRANCH;
      process.env.RELEASE_EXPECTED_COMMIT = "other-commit";
      assert.throws(
        () => validateRelease("v1.2.3", "next"),
        /incorrect provenance/,
      );
      delete process.env.RELEASE_EXPECTED_COMMIT;
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ ...pkg, version: "1.2.3-rc.1" }),
      );
      assert.throws(
        () => validateRelease("v1.2.3-rc.1", "latest"),
        /Prerelease versions/,
      );
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify(pkg),
      );

      const bytes = Buffer.from("verified fixture");
      const tarball = path.join(directory, ".build/package.tgz");
      fs.writeFileSync(tarball, bytes);
      const receipt = {
        schemaVersion: 1,
        name: pkg.name,
        version: pkg.version,
        tarball: ".build/package.tgz",
        sha256: sha256(bytes),
        fingerprint: releaseFingerprint(),
        commit: releaseCommit(),
      };
      const seal = () =>
        fs.writeFileSync(
          path.join(directory, ".build/release.json"),
          JSON.stringify(receipt),
        );
      seal();
      const commands: { command: string; args: string[] }[] = [];
      const execute = (command: string, args: string[]) =>
        commands.push({ command, args });
      const neverQuery = async () => {
        throw Error("Dry run contacted the registry");
      };
      await publishRelease(
        { dryRun: true, tag: "latest", releaseTag: "" },
        { query: neverQuery, execute },
      );
      assert.deepEqual(commands.pop(), {
        command: "npm",
        args: [
          "publish",
          tarball,
          "--ignore-scripts",
          "--access",
          "public",
          "--tag",
          "latest",
          "--registry",
          "https://registry.npmjs.org",
          "--dry-run",
        ],
      });
      const options = { dryRun: false, tag: "next", releaseTag: "v1.2.3" };
      await assert.rejects(
        publishRelease(options, { query: neverQuery, execute }),
        /engine:verify/,
      );
      const evidencePath = path.join(
        directory,
        ".build/reports/engine-verification.json",
      );
      const engine = {
        schemaVersion: 1,
        ...manifest,
        commit: receipt.commit,
        fingerprint: receipt.fingerprint,
        committedAssetsMatch: true,
        noticesMatch: true,
      };
      fs.writeFileSync(
        evidencePath,
        JSON.stringify({ ...engine, fingerprint: "stale" }),
      );
      await assert.rejects(
        publishRelease(options, { query: neverQuery, execute }),
        /Engine verification is stale/,
      );
      fs.writeFileSync(evidencePath, JSON.stringify(engine));
      const published: RegistryPackage = {
        versions: {
          "1.2.3": {
            name: pkg.name,
            version: pkg.version,
            dist: {
              integrity:
                "sha512-" + createHash("sha512").update(bytes).digest("base64"),
            },
          },
        },
        "dist-tags": { next: "1.2.3" },
      };
      let calls = 0;
      // An existing package without this version exercises publication without bootstrap credentials.
      const query = async () =>
        ++calls === 1 ? { versions: {}, "dist-tags": {} } : published;
      await publishRelease(options, { query, execute });
      assert.equal(commands.length, 1);
      assert.equal(commands[0].command, "npm");
      assert.equal(commands[0].args.includes("--dry-run"), false);
      assert.equal(
        JSON.parse(
          fs.readFileSync(
            path.join(directory, ".build/reports/published.json"),
            "utf8",
          ),
        ).commit,
        receipt.commit,
      );
      commands.length = 0;
      await publishRelease(options, { query: async () => published, execute });
      assert.equal(
        commands.length,
        0,
        "A retry must not upload the same version again",
      );
      await assert.rejects(
        publishRelease(options, {
          query: async () => ({ ...published, "dist-tags": { next: "1.2.2" } }),
          execute,
        }),
        /will not silently move/,
      );
      await assert.rejects(
        publishRelease(options, {
          query: async () => {
            throw Error("Registry unavailable");
          },
          execute,
        }),
        /Registry unavailable/,
      );
      await assert.rejects(
        publishRelease(options, {
          query: async () => ({ versions: {}, "dist-tags": { next: "2.0.0" } }),
          execute,
        }),
        /roll the channel backward/,
      );

      const { finishRelease } = await import(
        moduleUrl("release/finish-release.ts")
      );
      process.env.GH_TOKEN = "test-token-never-sent";
      const finalOptions = { tag: "v1.2.3", channel: "next" };
      const request = async () => new Response("{}", { status: 404 });
      await assert.rejects(
        finishRelease(finalOptions, {
          query: async () => null,
          execute,
          request,
        }),
        /refusing to announce/,
      );
      assert.equal(commands.length, 0);
      await finishRelease(finalOptions, {
        query: async () => published,
        execute,
        request,
      });
      assert.deepEqual(
        commands.map((command) => command.args[1]),
        ["create", "upload", "edit"],
      );
      assert.ok(commands[0].args.includes("--draft"));
      commands.length = 0;
      const existingRelease = {
        draft: true,
        body: releaseNotes(notes, "1.2.3"),
        prerelease: true,
        name: "v1.2.3",
      };
      const existingRequest = async () => Response.json(existingRelease);
      await finishRelease(finalOptions, {
        query: async () => published,
        execute,
        request: existingRequest,
      });
      assert.deepEqual(
        commands.map((command) => command.args[1]),
        ["upload", "edit"],
      );
      commands.length = 0;
      existingRelease.draft = false;
      await finishRelease(finalOptions, {
        query: async () => published,
        execute,
        request: existingRequest,
      });
      assert.deepEqual(
        commands.map((command) => command.args[1]),
        ["upload"],
      );
      commands.length = 0;
      existingRelease.body = "manually edited notes";
      await assert.rejects(
        finishRelease(finalOptions, {
          query: async () => published,
          execute,
          request: existingRequest,
        }),
        /different notes/,
      );
      const failedRequest = async () =>
        new Response("unavailable", { status: 503 });
      await assert.rejects(
        finishRelease(finalOptions, {
          query: async () => published,
          execute,
          request: failedRequest,
        }),
        /lookup failed/,
      );
      assert.equal(commands.length, 0);
      const different = structuredClone(published);
      different.versions["1.2.3"].dist.integrity = "sha512-other";
      await assert.rejects(
        publishRelease(options, { query: async () => different, execute }),
        /different bytes/,
      );
      fs.unlinkSync(tarball);
      await assert.rejects(
        publishRelease(
          { ...options, dryRun: true },
          { query: neverQuery, execute },
        ),
        /release:prepare again/,
      );
      fs.writeFileSync(path.join(directory, ".build/release.json"), "null");
      await assert.rejects(
        publishRelease(
          { ...options, dryRun: true },
          { query: neverQuery, execute },
        ),
        /Invalid release receipt/,
      );
      seal();
      fs.writeFileSync(tarball, "tampered");
      await assert.rejects(
        publishRelease(
          { ...options, dryRun: true },
          { query: neverQuery, execute },
        ),
        /tarball changed/,
      );
      fs.writeFileSync(tarball, bytes);
      fs.appendFileSync(path.join(directory, "engine/source.rs"), "changed");
      await assert.rejects(
        publishRelease(
          { ...options, dryRun: true },
          { query: neverQuery, execute },
        ),
        /tarball changed/,
      );
      fs.writeFileSync(path.join(directory, "engine/source.rs"), "source");
      fs.appendFileSync(path.join(directory, "CHANGELOG.md"), "changed");
      await assert.rejects(
        publishRelease(
          { ...options, dryRun: true },
          { query: neverQuery, execute },
        ),
        /tarball changed/,
      );
      fs.writeFileSync(path.join(directory, "CHANGELOG.md"), notes);
      receipt.commit = "old-commit";
      seal();
      await assert.rejects(
        publishRelease(
          { ...options, dryRun: true },
          { query: neverQuery, execute },
        ),
        /commit or tarball changed/,
      );
      assert.equal(commands.length, 0);
    } finally {
      if (priorBranch === undefined) delete process.env.RELEASE_DEFAULT_BRANCH;
      else process.env.RELEASE_DEFAULT_BRANCH = priorBranch;
      for (const [key, value] of Object.entries({
        RELEASE_EXPECTED_COMMIT: priorExpectedCommit,
        GITHUB_REPOSITORY: priorRepository,
        GH_TOKEN: priorToken,
        GITHUB_STEP_SUMMARY: priorSummary,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
