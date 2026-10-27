import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { root, readPackage, run, reportPath, packPackage } from "../lib.ts";

const original = readPackage();
const sourceFiles = ["package.json", "src/adapters/frozenight/manifest.ts"];

const before = sourceFiles.map((file) =>
  fs.readFileSync(path.join(root, file)),
);

fs.mkdirSync(path.join(root, ".build"), { recursive: true });

const directory = fs.mkdtempSync(path.join(root, ".build/version-rehearsal-"));

try {
  // Package verification checks the complete package separately. Only copy the
  // inputs needed to prove that a version bump reaches the SDK and its assets.
  for (const name of [
    "package.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "src",
    "assets",
    "bin",
    "scripts/build-package.ts",
  ]) {
    const destination = path.join(directory, name);

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(root, name), destination, { recursive: true });
  }

  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(directory, "node_modules"),
    "dir",
  );

  run("bun", ["run", "version:patch"], { cwd: directory });

  const bumped = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );

  assert.notEqual(
    bumped.version,
    original.version,
    "Version bump did not change the version",
  );

  run("bun", ["scripts/build-package.ts"], { cwd: directory });

  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(directory, "dist/assets/frozenight/manifest.json"),
      "utf8",
    ),
  );

  assert.equal(manifest.packageVersion, bumped.version);
  assert.equal(
    manifest.descriptor.engineVersion,
    bumped.version + "+" + manifest.descriptor.sourceRevision.slice(0, 12),
  );

  const sdk = await import(
    pathToFileURL(path.join(directory, "dist/index.js")).href
  );

  assert.deepEqual(
    sdk.frozenightManifest,
    manifest,
    "SDK and deployed asset metadata differ",
  );

  const packed = await packPackage({ cwd: directory });

  assert.equal(packed.name, original.name);
  assert.equal(packed.version, bumped.version);
  assert.equal(
    path.basename(packed.file),
    original.name.replace(/^@/, "").replace("/", "-") +
      "-" +
      bumped.version +
      ".tgz",
  );

  sourceFiles.forEach((file, i) =>
    assert.deepEqual(
      fs.readFileSync(path.join(root, file)),
      before[i],
      "Version rehearsal changed " + file,
    ),
  );

  fs.writeFileSync(
    reportPath("versioning.json"),
    JSON.stringify(
      {
        sourceVersion: original.version,
        rehearsedVersion: bumped.version,
        packedVersion: packed.version,
        sourceUnchanged: true,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(
    `Version rehearsal passed: ${original.version} -> ${bumped.version}; source unchanged; no application installs.`,
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
