import fs from "node:fs";
import path from "node:path";
import { root, run, readPackage, releaseFingerprint, sha256 } from "../lib.ts";

const args = process.argv.slice(2);

let dryRun = false,
  tag = "next";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dry-run") {
    dryRun = true;
  } else if (args[i] === "--tag" && args[i + 1]) {
    tag = args[++i];
  } else {
    throw Error("Use --dry-run and/or --tag <dist-tag>");
  }
}

if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
  throw Error("Supply a valid npm dist-tag");
}

let receipt;
try {
  receipt = JSON.parse(
    fs.readFileSync(path.join(root, ".build/release.json"), "utf8"),
  );
} catch {
  throw Error("Run bun run release:prepare before publishing or its dry run.");
}

const pkg = readPackage();

if (
  !dryRun &&
  JSON.stringify([pkg.repository, pkg.homepage, pkg.bugs]).includes(
    "REPLACE_ME",
  )
) {
  throw Error(
    "Replace the repository/homepage/bugs placeholders in package.json, then prepare the release again.",
  );
}

const tarball = path.resolve(root, receipt.tarball);
if (
  !tarball.startsWith(path.join(root, ".build") + path.sep) ||
  receipt.name !== pkg.name ||
  receipt.version !== pkg.version ||
  receipt.fingerprint !== releaseFingerprint() ||
  sha256(fs.readFileSync(tarball)) !== receipt.sha256
) {
  throw Error(
    "Release inputs or tarball changed. Run bun run release:prepare again.",
  );
}

run(
  "bun",
  [
    "publish",
    tarball,
    "--ignore-scripts",
    "--access",
    "public",
    "--tag",
    tag,
    ...(dryRun ? ["--dry-run"] : []),
  ],
  {
    // Bun requires a token even for dry runs. This nonsecret value is used only
    // with --dry-run; real publication uses the caller's registry credentials.
    env: dryRun ? { NPM_CONFIG_TOKEN: "bun-dry-run-placeholder" } : {},
  },
);
