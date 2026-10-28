import fs from "node:fs";
import path from "node:path";
import {
  root,
  run,
  readPackage,
  releaseFingerprint,
  releaseCommit,
  sha256,
  reportPath,
} from "../lib.ts";
import { registry, validateRelease } from "./metadata.ts";
import { verifyReleaseEngine } from "./engine-artifact.ts";
import {
  readRegistryPackage,
  verifyRegistryArtifact,
  verifyRegistryChannel,
  verifyChannelAdvance,
} from "./registry.ts";

export function publishArguments(args: string[]) {
  let dryRun = false,
    tag = "next",
    releaseTag = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--tag" && args[i + 1]) tag = args[++i];
    else if (args[i] === "--release-tag" && args[i + 1]) releaseTag = args[++i];
    else
      throw Error(
        "Use --dry-run, --tag next|latest and --release-tag v<version>.",
      );
  }
  if (tag !== "next" && tag !== "latest")
    throw Error("Choose the next or latest npm channel.");
  return { dryRun, tag, releaseTag };
}

export async function publishRelease(
  options: ReturnType<typeof publishArguments>,
  dependencies = { query: readRegistryPackage, execute: run },
) {
  const { dryRun, tag, releaseTag } = options;
  let receipt;
  try {
    receipt = JSON.parse(
      fs.readFileSync(path.join(root, ".build/release.json"), "utf8"),
    );
  } catch {
    throw Error(
      "Run bun run release:prepare before publishing or its dry run.",
    );
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw Error("Invalid release receipt. Run bun run release:prepare again.");
  }
  const pkg = readPackage();
  const tarball = path.resolve(
    root,
    typeof receipt.tarball === "string" ? receipt.tarball : "",
  );
  if (
    receipt.schemaVersion !== 2 ||
    !tarball.startsWith(path.join(root, ".build") + path.sep) ||
    !fs.existsSync(tarball) ||
    fs.realpathSync(tarball) !== tarball ||
    receipt.name !== pkg.name ||
    receipt.version !== pkg.version ||
    receipt.commit !== releaseCommit() ||
    receipt.fingerprint !== releaseFingerprint() ||
    sha256(fs.readFileSync(tarball)) !== receipt.sha256
  )
    throw Error(
      "Release inputs, commit or tarball changed. Run bun run release:prepare again.",
    );

  await verifyReleaseEngine(tarball, receipt);

  if (dryRun) {
    // No registry lookup, credentials or publishing call is possible on this path.
    dependencies.execute("npm", [
      "publish",
      tarball,
      "--ignore-scripts",
      "--access",
      "public",
      "--tag",
      tag,
      "--registry",
      registry,
      "--dry-run",
    ]);
    return;
  }

  const release = validateRelease(releaseTag, tag);
  if (process.env.GITHUB_ACTIONS === "true") {
    const npmResult = Bun.spawnSync(["npm", "--version"], { env: process.env });
    const npmVersion = npmResult.stdout
      .toString()
      .trim()
      .split(".")
      .map(Number);
    if (
      npmResult.exitCode !== 0 ||
      npmVersion.length !== 3 ||
      !npmVersion.every(Number.isInteger) ||
      npmVersion[0] < 11 ||
      (npmVersion[0] === 11 &&
        (npmVersion[1] < 5 || (npmVersion[1] === 5 && npmVersion[2] < 1)))
    )
      throw Error("Trusted publishing requires npm >=11.5.1.");
  }

  const bytes = fs.readFileSync(tarball);
  const existing = await dependencies.query(pkg.name);
  let alreadyPublished = false;
  if (existing?.versions[pkg.version]) {
    verifyRegistryArtifact(existing, pkg.name, pkg.version, bytes);
    verifyRegistryChannel(existing, pkg.version, release.channel);
    alreadyPublished = true;
    console.log(
      "The exact verified tarball is already published on the requested channel; resuming without uploading it again.",
    );
  } else {
    verifyChannelAdvance(existing, pkg.version, release.channel);
    if (
      !existing &&
      process.env.GITHUB_ACTIONS === "true" &&
      !process.env.NODE_AUTH_TOKEN
    ) {
      throw Error(
        "This package does not exist on npm yet. Configure the temporary NPM_TOKEN environment secret for the first publish; see docs/PUBLISHING.md. Trusted publishing is configured after the package exists.",
      );
    }
    dependencies.execute("npm", [
      "publish",
      tarball,
      "--ignore-scripts",
      "--access",
      "public",
      "--tag",
      tag,
      "--registry",
      registry,
      ...(process.env.RELEASE_PROVENANCE === "true" ? ["--provenance"] : []),
    ]);
  }
  // npm can take a short time to expose a new version or tag on its read endpoint.
  let published;
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await dependencies.query(pkg.name);
    if (
      current?.versions[pkg.version] &&
      current["dist-tags"][tag] === pkg.version
    ) {
      published = current;
      break;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!published)
    throw Error(
      "npm upload may have succeeded, but version/channel verification did not complete. Re-run failed jobs using the original artifact; do not bump the version or move the tag.",
    );
  const integrity = verifyRegistryArtifact(
    published,
    pkg.name,
    pkg.version,
    bytes,
  );
  verifyRegistryChannel(published, pkg.version, release.channel);
  const record = {
    ...release,
    notes: undefined,
    sha256: receipt.sha256,
    integrity,
    alreadyPublished,
    distTags: published["dist-tags"],
  };
  fs.writeFileSync(
    reportPath("published.json"),
    JSON.stringify(record, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(root, ".build/release-notes.md"), release.notes);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## npm publication verified\n\n- Package: ${pkg.name}@${pkg.version}\n- Channel: ${tag}\n- Commit: ${release.commit}\n- SHA-256: ${receipt.sha256}\n- Registry tags: ${JSON.stringify(published["dist-tags"])}\n`,
    );
  }
}

if (import.meta.main)
  await publishRelease(publishArguments(process.argv.slice(2)));
