#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { AssetEntry, EngineAssetManifest } from "../src/core/types.ts";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--to") {
  console.error(
    "Usage: chess-engine-assets --to <public-folder>/engines/frozenight",
  );
  process.exit(1);
}
const source = fileURLToPath(new URL("../assets/frozenight/", import.meta.url));
const manifest: EngineAssetManifest = JSON.parse(
  fs.readFileSync(path.join(source, "manifest.json"), "utf8"),
);
const destination = path.resolve(args[1]);
if (
  destination === path.resolve(source) ||
  source.startsWith(destination + path.sep)
)
  throw Error("Choose a consumer asset destination");
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const entries = (m: EngineAssetManifest): AssetEntry[] => [
  m.wasm,
  m.worker,
  ...m.notices,
];
let previous: AssetEntry[] | undefined;
try {
  const old = JSON.parse(
    fs.readFileSync(path.join(destination, "manifest.json"), "utf8"),
  );
  if (
    old.apiVersion === 1 &&
    old.descriptor.engineId === manifest.descriptor.engineId &&
    Array.isArray(old.notices)
  )
    previous = entries(old);
} catch {
  /* First install or an untrusted old manifest: do not delete anything. */
}
const verified = entries(manifest).map((asset) => {
  const origin = path.resolve(source, asset.file),
    target = path.resolve(destination, asset.file);
  if (!origin.startsWith(source) || !target.startsWith(destination + path.sep))
    throw Error("Invalid asset path");
  const bytes = fs.readFileSync(origin);
  if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256)
    throw Error("Asset integrity failed: " + asset.file);
  return { asset, target, bytes };
});
for (const { target, bytes } of verified) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
fs.writeFileSync(
  path.join(destination, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
// Remove only unchanged files listed in our previous manifest, never unrelated consumer files.
const retained = new Set(verified.map((v) => v.asset.file));
for (const asset of previous ?? []) {
  if (!asset || typeof asset.file !== "string" || retained.has(asset.file))
    continue;
  const target = path.resolve(destination, asset.file);
  if (
    !target.startsWith(destination + path.sep) ||
    !fs.existsSync(target) ||
    !fs.statSync(target).isFile()
  )
    continue;
  if (sha(fs.readFileSync(target)) === asset.sha256) fs.unlinkSync(target);
}
console.log("Copied verified engine assets to " + destination);
