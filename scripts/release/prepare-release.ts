import fs from "node:fs";
import path from "node:path";
import { ensureEngine } from "../maintenance/engine/engine-cache.ts";
import { verifyPackagedEngine } from "./engine-artifact.ts";
import {
  root,
  run,
  readPackage,
  releaseFingerprint,
  sha256,
  reportPath,
  releaseCommit,
} from "../lib.ts";

const receipt = path.join(root, ".build/release.json");

fs.rmSync(receipt, { force: true });

const fingerprint = releaseFingerprint();
const commit = releaseCommit();

run("bun", ["run", "check"]);
run("bun", ["scripts/maintenance/engine/engine-notices.ts", "--check"]);
// Release preparation always builds from source, even when a local cache exists.
const engine = ensureEngine({ force: true });
run("bun", ["run", "engine:verify"]);
run("bun", ["run", "test:native"]);
run("bun", ["run", "test:versioning"]);
run("bun", ["run", "test:package"]);
run("bun", ["run", "test:browser"]);

const packed = JSON.parse(
  fs.readFileSync(reportPath("package-build.json"), "utf8"),
);

const pkg = readPackage();
const verificationFile = reportPath("engine-verification.json");
const verification = JSON.parse(fs.readFileSync(verificationFile, "utf8"));
if (
  verification.schemaVersion !== 2 ||
  verification.fingerprint !== fingerprint ||
  verification.commit !== commit ||
  verification.inputKey !== engine.key ||
  verification.reproducible !== true ||
  verification.noticesMatch !== true
)
  throw Error("Engine verification is stale; prepare the release again.");
await verifyPackagedEngine(path.join(root, packed.file), verification);

if (fingerprint !== releaseFingerprint() || commit !== releaseCommit()) {
  throw Error(
    "Release inputs changed during preparation. Run bun run release:prepare again.",
  );
}

if (
  packed.name !== pkg.name ||
  packed.version !== pkg.version ||
  sha256(fs.readFileSync(path.join(root, packed.file))) !== packed.sha256
) {
  throw Error("Release artifact changed during verification");
}

fs.writeFileSync(
  receipt,
  JSON.stringify(
    {
      schemaVersion: 2,
      name: pkg.name,
      version: pkg.version,
      tarball: packed.file,
      sha256: packed.sha256,
      fingerprint,
      commit,
      engineVerificationSha256: sha256(fs.readFileSync(verificationFile)),
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `Ready for review: ${packed.file}. Run bun run release:dry-run. Nothing has been published.`,
);
