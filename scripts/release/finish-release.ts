import fs from "node:fs";
import path from "node:path";
import { root, run, sha256 } from "../lib.ts";
import { releaseArguments, validateRelease } from "./metadata.ts";
import {
  readRegistryPackage,
  verifyRegistryArtifact,
  verifyRegistryChannel,
  type RegistryRequest,
} from "./registry.ts";

export async function finishRelease(
  { tag, channel }: ReturnType<typeof releaseArguments>,
  dependencies: {
    query: typeof readRegistryPackage;
    execute: typeof run;
    request: RegistryRequest;
  } = { query: readRegistryPackage, execute: run, request: fetch },
) {
  const release = validateRelease(tag, channel);
  const receipt = JSON.parse(
    fs.readFileSync(path.join(root, ".build/release.json"), "utf8"),
  );
  const evidencePath = path.join(root, ".build/reports/published.json");
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const tarball = path.resolve(root, receipt.tarball);
  if (
    !tarball.startsWith(path.join(root, ".build") + path.sep) ||
    evidence.commit !== release.commit ||
    evidence.tag !== tag ||
    evidence.channel !== channel ||
    evidence.sha256 !== receipt.sha256 ||
    sha256(fs.readFileSync(tarball)) !== receipt.sha256
  )
    throw Error("Publication evidence does not match this release.");
  const published = await dependencies.query(release.name);
  if (!published)
    throw Error("Package is missing from npm; refusing to announce a release.");
  verifyRegistryArtifact(
    published,
    release.name,
    release.version,
    fs.readFileSync(tarball),
  );
  verifyRegistryChannel(published, release.version, release.channel);
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !process.env.GH_TOKEN)
    throw Error(
      "Run release finalization in GitHub Actions with its repository token.",
    );
  const response = await dependencies.request(
    `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  let draft = true;
  const notesPath = path.join(root, ".build/release-notes.md");
  fs.writeFileSync(notesPath, release.notes);
  const prerelease = channel === "next";
  if (response.status === 404) {
    dependencies.execute("gh", [
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--verify-tag",
      "--draft",
      "--title",
      tag,
      "--notes-file",
      notesPath,
      ...(prerelease ? ["--prerelease"] : []),
    ]);
  } else {
    if (!response.ok)
      throw Error(`GitHub release lookup failed: HTTP ${response.status}`);
    const existing = (await response.json()) as {
      draft: boolean;
      body: string;
      prerelease: boolean;
      name: string;
    };
    if (
      existing.body?.trim() !== release.notes.trim() ||
      existing.prerelease !== prerelease ||
      existing.name !== tag
    )
      throw Error(
        "An existing GitHub release has different notes or metadata. Review it before retrying.",
      );
    draft = existing.draft;
  }
  dependencies.execute("gh", [
    "release",
    "upload",
    tag,
    tarball,
    path.join(root, ".build/release.json"),
    evidencePath,
    "--repo",
    repository,
    "--clobber",
  ]);
  if (draft)
    dependencies.execute("gh", [
      "release",
      "edit",
      tag,
      "--repo",
      repository,
      "--draft=false",
      `--latest=${!prerelease}`,
    ]);
  console.log(
    `GitHub release ready: https://github.com/${repository}/releases/tag/${tag}`,
  );
}

if (import.meta.main)
  await finishRelease(releaseArguments(process.argv.slice(2)));
