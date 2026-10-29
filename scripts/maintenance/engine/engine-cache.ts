import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  engineInputKey,
  engineTools,
  engineTarget,
  rustVersion,
  inventory,
  projectRoot,
  validateEngine,
  type EngineManifest,
} from "./engine-inputs.ts";

export type EngineCache = {
  schemaVersion: 1;
  key: string;
  directory: string;
  files: Record<string, string>;
};
export type BuiltEngine = EngineCache & {
  manifest: EngineManifest;
  absoluteDirectory: string;
  reused: boolean;
};

export function readEngineCache(cwd = projectRoot): BuiltEngine | null {
  cwd = fs.realpathSync(cwd);
  const key = engineInputKey(cwd);
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(cwd, ".build/engine", key + ".json"), "utf8"),
    ) as EngineCache;
    const directory = path.resolve(cwd, record.directory);
    const objects = path.join(cwd, ".build/engine/objects") + path.sep;
    if (
      record.schemaVersion !== 1 ||
      record.key !== key ||
      !directory.startsWith(objects) ||
      fs.realpathSync(directory) !== directory ||
      !isDeepStrictEqual(record.files, inventory(directory))
    )
      return null;
    return {
      ...record,
      manifest: validateEngine(directory, key, cwd),
      absoluteDirectory: directory,
      reused: true,
    };
  } catch {
    return null;
  }
}

export function ensureEngine({
  cwd = projectRoot,
  force = false,
  build = compile,
}: {
  cwd?: string;
  force?: boolean;
  build?: (directory: string, cwd: string) => void;
} = {}): BuiltEngine {
  cwd = fs.realpathSync(cwd);
  const cached = readEngineCache(cwd);
  if (cached && !force) {
    console.log(
      `Using verified local engine cache ${cached.key.slice(0, 12)}.`,
    );
    return cached;
  }
  const key = engineInputKey(cwd);
  const cache = path.join(cwd, ".build/engine");
  const objects = path.join(cache, "objects");
  fs.mkdirSync(objects, { recursive: true });
  const identifier = key + "-" + randomUUID();
  const staging = path.join(objects, ".building-" + identifier);
  const directory = path.join(objects, identifier);
  fs.mkdirSync(staging);
  let published = false;
  try {
    build(staging, cwd);
    if (engineInputKey(cwd) !== key)
      throw Error(
        "Engine inputs changed during compilation. Run the build again.",
      );
    const manifest = validateEngine(staging, key, cwd);
    const files = inventory(staging);
    fs.renameSync(staging, directory);
    const record: EngineCache = {
      schemaVersion: 1,
      key,
      directory: path.relative(cwd, directory).split(path.sep).join("/"),
      files,
    };
    const temporaryIndex = path.join(cache, ".index-" + identifier + ".json");
    try {
      fs.writeFileSync(temporaryIndex, JSON.stringify(record, null, 2) + "\n");
      fs.renameSync(temporaryIndex, path.join(cache, key + ".json"));
    } finally {
      fs.rmSync(temporaryIndex, { force: true });
    }
    published = true;
    console.log(`Built engine cache ${key.slice(0, 12)} from source.`);
    return { ...record, manifest, absoluteDirectory: directory, reused: false };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!published) fs.rmSync(directory, { recursive: true, force: true });
  }
}

function compile(directory: string, cwd: string) {
  const result = spawnSync(
    "bun",
    [path.join(cwd, engineTools, "compile-engine.ts"), "--output", directory],
    { cwd, env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(
      `Engine compilation failed. Install Rust ${rustVersion} with the ${engineTarget} target. See docs/DEVELOPMENT.md#first-source-build.`,
    );
}

// Used by the isolated version-bump rehearsal; no compilation or downloads occur.
export function copyEngineCache(destination: string, cwd = projectRoot) {
  const cached = readEngineCache(cwd);
  if (!cached) throw Error("Build the engine before copying its cache.");
  fs.mkdirSync(path.join(destination, ".build/engine"), { recursive: true });
  fs.cpSync(
    cached.absoluteDirectory,
    path.join(destination, cached.directory),
    { recursive: true },
  );
  const {
    manifest: _manifest,
    absoluteDirectory: _absolute,
    reused: _reused,
    ...record
  } = cached;
  fs.writeFileSync(
    path.join(destination, ".build/engine", cached.key + ".json"),
    JSON.stringify(record, null, 2) + "\n",
  );
}
