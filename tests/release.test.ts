import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ensureEngine } from "../scripts/maintenance/engine/engine-cache.ts";
import {
  makeEngineProject,
  writeEngineFixture,
  writePackageFixture,
} from "./engine-fixture.ts";
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

test("release gates bind source, independent engine proof and tested tarball without a local cache", async () => {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "chess-release-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const saved = Object.fromEntries(
    [
      "RELEASE_DEFAULT_BRANCH",
      "RELEASE_EXPECTED_COMMIT",
      "GITHUB_REPOSITORY",
      "GH_TOKEN",
      "GITHUB_STEP_SUMMARY",
      "GITHUB_OUTPUT",
      "GITHUB_ACTIONS",
      "NODE_AUTH_TOKEN",
      "RELEASE_PROVENANCE",
      "PATH",
    ].map((name) => [name, process.env[name]]),
  );
  try {
    makeEngineProject(directory);
    fs.writeFileSync(path.join(directory, "CHANGELOG.md"), notes);
    fs.mkdirSync(path.join(directory, "src/adapters/frozenight"), {
      recursive: true,
    });
    const bridge = path.join(directory, "src/adapters/frozenight/manifest.ts");
    fs.writeFileSync(bridge, "export const authoredBridge = true;\n");
    for (const name of [
      "lib.ts",
      "release/metadata.ts",
      "release/check-release.ts",
      "release/registry.ts",
      "release/engine-artifact.ts",
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
    const { finishRelease } = await import(
      moduleUrl("release/finish-release.ts")
    );
    const sourceFingerprint = releaseFingerprint();
    const finderMetadata = path.join(directory, "src/.DS_Store");
    fs.writeFileSync(finderMetadata, "Finder metadata");
    assert.equal(releaseFingerprint(), sourceFingerprint);
    fs.unlinkSync(finderMetadata);
    delete process.env.RELEASE_DEFAULT_BRANCH;
    delete process.env.RELEASE_EXPECTED_COMMIT;
    process.env.GITHUB_REPOSITORY = "sximn/chess-engine-kit";
    process.env.GH_TOKEN = "test-token-never-sent";
    process.env.GITHUB_STEP_SUMMARY = path.join(
      directory,
      ".build/test-summary.md",
    );
    process.env.GITHUB_OUTPUT = path.join(directory, ".build/test-output");
    assert.equal(validateRelease("v1.2.3", "next").commit, releaseCommit());
    assert.throws(
      () => validateRelease("v1.2.2", "next"),
      /matching package.json/,
    );
    fs.appendFileSync(bridge, "// dirty authored source");
    assert.throws(() => validateRelease("v1.2.3", "next"), /checkout clean/);
    fs.writeFileSync(bridge, "export const authoredBridge = true;\n");
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
    process.env.RELEASE_EXPECTED_COMMIT = "other";
    assert.throws(
      () => validateRelease("v1.2.3", "next"),
      /incorrect provenance/,
    );
    delete process.env.RELEASE_EXPECTED_COMMIT;
    process.env.RELEASE_DEFAULT_BRANCH = "main";
    assert.throws(() => validateRelease("v1.2.3", "next"), /default branch/);
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    validateRelease("v1.2.3", "next");
    delete process.env.RELEASE_DEFAULT_BRANCH;
    const pkg = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf8"),
    );
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ ...pkg, version: "1.2.3-rc.1" }),
    );
    assert.throws(
      () => validateRelease("v1.2.3-rc.1", "latest"),
      /Prerelease versions/,
    );
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(pkg));

    const built = ensureEngine({ cwd: directory, build: writeEngineFixture });
    const backup = path.join(directory, ".build/engine-backup");
    fs.cpSync(built.absoluteDirectory, backup, { recursive: true });
    const tarball = path.join(directory, ".build/package.tgz");
    await writePackageFixture(tarball, built, directory);
    const bytes = fs.readFileSync(tarball);
    const receiptPath = path.join(directory, ".build/release.json");
    const reportPath = path.join(
      directory,
      ".build/reports/engine-verification.json",
    );
    const verification = {
      schemaVersion: 2,
      commit: releaseCommit(),
      fingerprint: releaseFingerprint(),
      inputKey: built.key,
      files: built.files,
      wasmSha256: built.manifest.wasmSha256,
      buildHash: built.manifest.buildHash,
      reproducible: true,
      noticesMatch: true,
    };
    const proof = JSON.stringify(verification, null, 2) + "\n";
    const receipt = {
      schemaVersion: 2,
      name: pkg.name,
      version: pkg.version,
      tarball: ".build/package.tgz",
      sha256: sha256(bytes),
      fingerprint: verification.fingerprint,
      commit: verification.commit,
      engineVerificationSha256: sha256(Buffer.from(proof)),
    };
    const seal = () => {
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      fs.writeFileSync(reportPath, proof);
    };
    const commands: { command: string; args: string[] }[] = [];
    const execute = (command: string, args: string[]) =>
      commands.push({ command, args });
    const neverQuery = async () => {
      throw Error("Unexpected registry lookup");
    };
    const options = { dryRun: false, tag: "next", releaseTag: "v1.2.3" };
    const dry = { ...options, dryRun: true };
    // Exercise the Actions path without depending on the runner's npm version
    // or inheriting real publication credentials. All uploads remain mocked.
    const mockBin = path.join(directory, ".build/mock-bin");
    fs.mkdirSync(mockBin);
    const npmVersion = path.join(mockBin, "npm-version");
    const npmInvocation = path.join(mockBin, "npm-invocation.json");
    fs.writeFileSync(npmVersion, "11.5.1");
    fs.writeFileSync(
      path.join(mockBin, "npm"),
      `#!${process.execPath}\nimport fs from "node:fs";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") console.log(fs.readFileSync(${JSON.stringify(npmVersion)}, "utf8"));
else if (args[0] === "publish" && args.includes("--dry-run")) fs.writeFileSync(${JSON.stringify(npmInvocation)}, JSON.stringify(args));
else throw Error("The test npm stub refuses every command except version checks and dry runs");\n`,
      { mode: 0o755 },
    );
    process.env.PATH = mockBin + path.delimiter + process.env.PATH;
    process.env.GITHUB_ACTIONS = "true";
    process.env.RELEASE_PROVENANCE = "true";
    delete process.env.NODE_AUTH_TOKEN;
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /release:prepare/,
    );
    seal();
    fs.unlinkSync(reportPath);
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /release:prepare/,
    );
    seal();
    assert.equal(
      git("status", "--porcelain"),
      "",
      "Build outputs must leave tracked sources clean",
    );
    // Publishing and its dry run must operate entirely from the transported
    // tarball/proof. The publish job intentionally has no engine cache or Rust.
    fs.rmSync(path.join(directory, ".build/engine"), {
      recursive: true,
      force: true,
    });
    assert.equal(fs.existsSync(path.join(directory, "node_modules")), false);
    for (const args of [
      [
        "scripts/release/check-release.ts",
        "--tag",
        "v1.2.3",
        "--channel",
        "next",
      ],
      ["scripts/release/publish.ts", "--dry-run", "--tag", "next"],
    ]) {
      const result = Bun.spawnSync([process.execPath, ...args], {
        cwd: directory,
        env: process.env,
      });
      assert.equal(result.exitCode, 0, result.stderr.toString());
    }
    assert.ok(
      JSON.parse(fs.readFileSync(npmInvocation, "utf8")).includes(
        "--ignore-scripts",
      ),
    );
    assert.equal(fs.existsSync(path.join(directory, ".build/engine")), false);
    await publishRelease(
      { ...dry, tag: "latest" },
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
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ ...verification, reproducible: false }),
    );
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /Engine verification is stale/,
    );
    seal();
    const changedProof = JSON.stringify({
      ...verification,
      files: { ...verification.files, "engine-manifest.json": "bad" },
    });
    fs.writeFileSync(reportPath, changedProof);
    receipt.engineVerificationSha256 = sha256(Buffer.from(changedProof));
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /independently verified build/,
    );
    receipt.engineVerificationSha256 = sha256(Buffer.from(proof));
    seal();
    await writePackageFixture(
      tarball,
      { ...built, absoluteDirectory: backup },
      directory,
      (files) => {
        delete files[
          "package/dist/assets/frozenight/" + built.manifest.wasmFile
        ];
      },
    );
    receipt.sha256 = sha256(fs.readFileSync(tarball));
    seal();
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /Missing packaged engine asset/,
    );
    fs.writeFileSync(tarball, bytes);
    receipt.sha256 = sha256(bytes);
    seal();

    for (const unsupported of ["11.5.0", "invalid version"]) {
      fs.writeFileSync(npmVersion, unsupported);
      await assert.rejects(
        publishRelease(options, { query: neverQuery, execute }),
        /Trusted publishing requires npm/,
      );
    }
    fs.writeFileSync(npmVersion, "11.5.1");
    await assert.rejects(
      publishRelease(options, { query: async () => null, execute }),
      /temporary NPM_TOKEN/,
    );
    assert.equal(commands.length, 0);

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
    let lookups = 0;
    process.env.NODE_AUTH_TOKEN = "fixture-bootstrap-token-never-sent";
    await publishRelease(options, {
      query: async () => (++lookups === 1 ? null : published),
      execute,
    });
    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, "npm");
    assert.equal(commands[0].args.includes("--dry-run"), false);
    assert.equal(commands[0].args.includes("--provenance"), true);
    delete process.env.NODE_AUTH_TOKEN;
    commands.length = 0;
    await publishRelease(options, { query: async () => published, execute });
    assert.equal(
      commands.length,
      0,
      "Retries must not re-upload a published tarball",
    );
    await assert.rejects(
      publishRelease(options, {
        query: async () => ({ ...published, "dist-tags": { next: "1.2.2" } }),
        execute,
      }),
      /will not silently move/,
    );
    const different = structuredClone(published);
    different.versions["1.2.3"].dist.integrity = "sha512-other";
    await assert.rejects(
      publishRelease(options, { query: async () => different, execute }),
      /different bytes/,
    );
    await assert.rejects(
      publishRelease(options, {
        query: async () => ({ versions: {}, "dist-tags": { next: "2.0.0" } }),
        execute,
      }),
      /roll the channel backward/,
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

    const finishOptions = { tag: "v1.2.3", channel: "next" };
    const missing = async () => new Response("{}", { status: 404 });
    assert.equal(
      fs.existsSync(path.join(directory, ".build/reports/published.json")),
      false,
      "Failed publication attempts must clear stale success evidence",
    );
    // Finalization requires fresh evidence from a successful verification.
    await publishRelease(options, { query: async () => published, execute });
    assert.equal(commands.length, 0, "Verification must not upload again");
    await assert.rejects(
      finishRelease(finishOptions, {
        query: async () => null,
        execute,
        request: missing,
      }),
      /refusing to announce/,
    );
    await finishRelease(finishOptions, {
      query: async () => published,
      execute,
      request: missing,
    });
    assert.deepEqual(
      commands.map((command) => command.args[1]),
      ["create", "upload", "edit"],
    );
    assert.ok(commands[0].args.includes("--draft"));
    assert.ok(
      commands[1].args.includes(reportPath),
      "Preserve independent engine evidence with the release",
    );
    commands.length = 0;
    const existing = {
      draft: true,
      body: releaseNotes(notes, "1.2.3"),
      prerelease: true,
      name: "v1.2.3",
    };
    const request = async () => Response.json(existing);
    await finishRelease(finishOptions, {
      query: async () => published,
      execute,
      request,
    });
    assert.deepEqual(
      commands.map((command) => command.args[1]),
      ["upload", "edit"],
    );
    commands.length = 0;
    existing.draft = false;
    await finishRelease(finishOptions, {
      query: async () => published,
      execute,
      request,
    });
    assert.deepEqual(
      commands.map((command) => command.args[1]),
      ["upload"],
    );
    commands.length = 0;
    existing.body = "edited notes";
    await assert.rejects(
      finishRelease(finishOptions, {
        query: async () => published,
        execute,
        request,
      }),
      /different notes/,
    );
    await assert.rejects(
      finishRelease(finishOptions, {
        query: async () => published,
        execute,
        request: async () => new Response("unavailable", { status: 503 }),
      }),
      /lookup failed/,
    );

    fs.unlinkSync(tarball);
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /release:prepare again/,
    );
    fs.writeFileSync(tarball, "tampered");
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /tarball changed/,
    );
    fs.writeFileSync(tarball, bytes);
    fs.appendFileSync(bridge, "// source edit");
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /tarball changed/,
    );
    fs.writeFileSync(bridge, "export const authoredBridge = true;\n");
    receipt.commit = "old-commit";
    seal();
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /commit or tarball changed/,
    );
    fs.writeFileSync(receiptPath, "null");
    await assert.rejects(
      publishRelease(dry, { query: neverQuery, execute }),
      /Invalid release receipt/,
    );
    assert.equal(commands.length, 0);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
