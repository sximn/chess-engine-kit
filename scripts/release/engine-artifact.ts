import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  engineInputKey,
  inventory,
  licenseFiles,
  projectRoot,
  validateEngine,
  digest,
} from "../maintenance/engine/engine-inputs.ts";

const prefix = "package/dist/assets/frozenight/";

export async function extractPackagedEngine(
  tarball: string,
  destination: string,
  cwd = projectRoot,
) {
  const entries = await new Bun.Archive(fs.readFileSync(tarball)).files();
  const read = async (name: string) => {
    const entry = entries.get(prefix + name);
    if (!entry) throw Error(`Missing packaged engine asset: ${name}`);
    return Buffer.from(await entry.arrayBuffer());
  };
  const raw = await read("engine-manifest.json");
  const metadata = JSON.parse(raw.toString());
  if (!/^engine-[a-f0-9]{16}\.wasm$/.test(metadata.wasmFile))
    throw Error("Invalid packaged WASM filename.");
  fs.mkdirSync(destination, { recursive: true });
  for (const name of [
    "engine-manifest.json",
    metadata.wasmFile,
    ...licenseFiles,
  ])
    fs.writeFileSync(path.join(destination, name), await read(name));
  const manifest = validateEngine(destination, engineInputKey(cwd), cwd);
  const runtime = JSON.parse((await read("manifest.json")).toString());
  const version = JSON.parse(
    fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
  ).version;
  if (
    runtime.packageVersion !== version ||
    runtime.wasm?.file !== manifest.wasmFile ||
    runtime.wasm?.sha256 !== manifest.wasmSha256 ||
    runtime.wasm?.bytes !== manifest.rawBytes ||
    !runtime.worker ||
    !Array.isArray(runtime.notices)
  )
    throw Error("Packaged SDK and engine manifests do not match this release.");
  for (const name of ["engine-manifest.json", ...licenseFiles])
    if (!runtime.notices.some((entry: { file: string }) => entry.file === name))
      throw Error(`Engine deployment manifest omits ${name}`);
  for (const asset of [runtime.wasm, runtime.worker, ...runtime.notices]) {
    if (
      typeof asset.file !== "string" ||
      asset.file
        .split("/")
        .some((part: string) => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part))
    )
      throw Error("Invalid packaged asset path.");
    const bytes = await read(asset.file);
    if (digest(bytes) !== asset.sha256 || bytes.length !== asset.bytes)
      throw Error(`Packaged asset integrity mismatch: ${asset.file}`);
  }
  return { manifest, files: inventory(destination) };
}

export async function verifyPackagedEngine(
  tarball: string,
  expected: { inputKey: string; files: Record<string, string> },
  cwd = projectRoot,
) {
  fs.mkdirSync(path.join(cwd, ".build"), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(cwd, ".build/package-engine-"));
  try {
    const packed = await extractPackagedEngine(tarball, temporary, cwd);
    if (
      packed.manifest.inputKey !== expected.inputKey ||
      !isDeepStrictEqual(packed.files, expected.files)
    )
      throw Error(
        "Packaged engine differs from the independently verified build.",
      );
    return packed.manifest;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export async function verifyReleaseEngine(
  tarball: string,
  receipt: {
    commit: string | null;
    fingerprint: string;
    engineVerificationSha256: string;
  },
  cwd = projectRoot,
) {
  const file = path.join(cwd, ".build/reports/engine-verification.json");
  let bytes: Buffer;
  let verification;
  try {
    bytes = fs.readFileSync(file);
    verification = JSON.parse(bytes.toString());
  } catch {
    throw Error(
      "Run bun run release:prepare to build and verify the engine before publication or a dry run.",
    );
  }
  if (
    verification?.schemaVersion !== 2 ||
    verification.commit !== receipt.commit ||
    verification.fingerprint !== receipt.fingerprint ||
    verification.reproducible !== true ||
    verification.noticesMatch !== true ||
    digest(bytes) !== receipt.engineVerificationSha256
  )
    throw Error(
      "Engine verification is stale or changed. Run bun run release:prepare again.",
    );
  return verifyPackagedEngine(tarball, verification, cwd);
}
