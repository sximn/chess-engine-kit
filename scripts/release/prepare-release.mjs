import fs from "node:fs";
import path from "node:path";
import {
  root,
  run,
  readPackage,
  releaseFingerprint,
  sha256,
  reportPath,
} from "../lib.mjs";

const receipt = path.join(root, ".build/release.json");
fs.rmSync(receipt, { force: true });
const fingerprint = releaseFingerprint();
run("npm", ["run", "check"]);
run("npm", ["test"]);
run("npm", ["run", "test:versioning"]);
run("npm", ["run", "test:package"]);
run("npm", ["run", "test:browser"]);
const packed = JSON.parse(
  fs.readFileSync(reportPath("package-build.json"), "utf8"),
);
const pkg = readPackage();
if (fingerprint !== releaseFingerprint())
  throw Error(
    "Release inputs changed during preparation. Run npm run release:prepare again.",
  );
if (
  packed.name !== pkg.name ||
  packed.version !== pkg.version ||
  sha256(fs.readFileSync(path.join(root, packed.file))) !== packed.sha256
)
  throw Error("Release artifact changed during verification");
fs.writeFileSync(
  receipt,
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      tarball: packed.file,
      sha256: packed.sha256,
      fingerprint,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Ready for review: ${packed.file}. Run npm run release:dry-run. Nothing has been published.`,
);
