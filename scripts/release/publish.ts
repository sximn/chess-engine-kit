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

const verificationIntervalMs = 15_000;
const verificationAttempts = 81; // 80 waits: about 20 minutes, plus queries

export function publishArguments(args: string[]) {
  let dryRun = false,
    tag = "next",
    releaseTag = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--tag" && args[i + 1]) {
      tag = args[++i];
    } else if (args[i] === "--release-tag" && args[i + 1]) {
      releaseTag = args[++i];
    } else {
      throw Error(
        "Use --dry-run, --tag next|latest and --release-tag v<version>.",
      );
    }
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

  const receipt = (() => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(root, ".build/release.json"), "utf8"),
      );
    } catch {
      throw Error(
        "Run bun run release:prepare before publishing or its dry run.",
      );
    }
  })();

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
  ) {
    throw Error(
      "Release inputs, commit or tarball changed. Run bun run release:prepare again.",
    );
  }

  await verifyReleaseEngine(tarball, receipt);

  if (dryRun) {
    // Rehearse publication of an unpublished release candidate. npm may query
    // the registry and rejects existing versions, so PR CI must not run this.
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
    const npmResult = Bun.spawnSync(["npm", "--version"], {
      env: process.env,
    });
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
        (npmVersion[1] < 5 ||
          (npmVersion[1] === 5 && npmVersion[2] < 1)))
    ) {
      throw Error("Trusted publishing requires npm >=11.5.1.");
    }
  }

  const bytes = fs.readFileSync(tarball);
  const startedAt = new Date().toISOString();

  // This is diagnostic information only. 
  // published.json is written only after verification (required by finish-release.ts)
  function writeStatus(
    state: string,
    details: Record<string, unknown> = {},
  ) {
    fs.writeFileSync(
      reportPath("publication-status.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          state,
          name: pkg.name,
          version: pkg.version,
          releaseTag,
          channel: tag,
          commit: release.commit,
          sha256: receipt.sha256,
          registry,
          startedAt,
          updatedAt: new Date().toISOString(),
          ...details,
        },
        null,
        2,
      ) + "\n",
    );
  }

  // never leave a stale success record behind if this invocation fails
  fs.rmSync(reportPath("published.json"), { force: true });

  writeStatus("checking-registry");

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

    // if npm exits unsuccessfully, this state deliberately records only
    // that an upload was attempted: the registry outcome may be uncertain
    writeStatus("upload-attempted");

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
      ...(process.env.RELEASE_PROVENANCE === "true"
        ? ["--provenance"]
        : []),
    ]);
  }

  // a successful npm publish confirms acceptance of the upload
  // scanning and registry availability can take several minutes
  let published:
    | Awaited<ReturnType<typeof readRegistryPackage>>
    | undefined;

  let versionVisible: boolean | null = null;
  let channelVersion: string | null = null;
  let lastQueryError: string | null = null;

  for (let attempt = 0; attempt < verificationAttempts; attempt++) {
    let current:
      | Awaited<ReturnType<typeof readRegistryPackage>>
      | undefined;

    try {
      current = await dependencies.query(pkg.name);
      versionVisible = Boolean(current?.versions[pkg.version]);
      channelVersion = current?.["dist-tags"]?.[tag] ?? null;
      lastQueryError = null;
    } catch (error) {
      // retry transient read failures, but keep the most recent diagnostic
      lastQueryError =
        error instanceof Error ? error.message : String(error);

      console.warn(
        `Registry verification query failed: ${lastQueryError}`,
      );
    }

    // integrity failures are fatal and must not be treated as transient
    // registry availability failures
    if (current?.versions[pkg.version]) {
      verifyRegistryArtifact(current, pkg.name, pkg.version, bytes);

      if (current["dist-tags"][tag] === pkg.version) {
        verifyRegistryChannel(current, pkg.version, release.channel);
        published = current;
        break;
      }
    }

    writeStatus("waiting-for-registry", {
      alreadyPublished,
      attempt: attempt + 1,
      maxAttempts: verificationAttempts,
      versionVisible,
      channelVersion,
      lastQueryError,
    });

    if (attempt < verificationAttempts - 1) {
      console.log(
        `Waiting for ${pkg.name}@${pkg.version} on ${tag} ` +
          `(${attempt + 1}/${verificationAttempts}); ` +
          `retrying in ${verificationIntervalMs / 1000}s.`,
      );

      await new Promise((resolve) =>
        setTimeout(resolve, verificationIntervalMs),
      );
    }
  }

  if (!published) {
    writeStatus("verification-timed-out", {
      alreadyPublished,
      attempts: verificationAttempts,
      versionVisible,
      channelVersion,
      lastQueryError,
    });

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        [
          "## npm publication verification timed out",
          "",
          `- Package: ${pkg.name}@${pkg.version}`,
          `- Channel: ${tag}`,
          `- Commit: ${release.commit}`,
          `- Version visible on last successful query: ${versionVisible ?? "unknown"}`,
          `- Channel value on last successful query: ${channelVersion ?? "missing or unknown"}`,
          "",
          "The upload may have succeeded. Check npm processing and any pending staged approval.",
          "Once the original version is available on the requested channel, re-run failed jobs using the original verified artifact.",
          "Do not bump the version or move the Git tag to recover this release.",
          "",
        ].join("\n"),
      );
    }

    throw Error(
      "npm upload may have succeeded, but version/channel verification did not complete after about 20 minutes. Check npm processing and any pending staged approval. Once available, re-run failed jobs using the original artifact; do not bump the version or move the tag. See publication-status.json for diagnostics.",
    );
  }

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
  fs.writeFileSync(
    path.join(root, ".build/release-notes.md"),
    release.notes,
  );

  writeStatus("verified", {
    alreadyPublished,
    integrity,
    distTags: published["dist-tags"],
  });

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## npm publication verified\n\n- Package: ${pkg.name}@${pkg.version}\n- Channel: ${tag}\n- Commit: ${release.commit}\n- SHA-256: ${receipt.sha256}\n- Registry tags: ${JSON.stringify(published["dist-tags"])}\n`,
    );
  }
}

if (import.meta.main) {
  await publishRelease(publishArguments(process.argv.slice(2)));
}
