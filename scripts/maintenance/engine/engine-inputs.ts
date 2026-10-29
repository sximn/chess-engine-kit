import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const projectRoot = path.resolve(import.meta.dir, "../../..");
export const engineTools = "scripts/maintenance/engine";

const { toolchain } = Bun.TOML.parse(
  fs.readFileSync(
    path.join(projectRoot, "engine/frozenight/rust-toolchain.toml"),
    "utf8",
  ),
) as { toolchain: { channel: string; targets: string[] } };

if (
  !/^\d+\.\d+\.\d+$/.test(toolchain.channel) ||
  toolchain.targets.length !== 1
) {
  throw Error(
    "Pin one Rust release and one WASM target in rust-toolchain.toml",
  );
}

export const rustVersion = toolchain.channel;
export const engineTarget = toolchain.targets[0];

export function engineCargoArgs(root: string, command = "build") {
  return [
    command,
    "--manifest-path",
    root + "/Cargo.toml",
    "--locked",
    "--release",
    "--target",
    engineTarget,
    "-p",
    "upapawn-engine",
    "--lib",
  ];
}

export const licenseFiles = [
  "LICENSE-MIT.txt",
  "LICENSE-APACHE.txt",
  "THIRD-PARTY-NOTICES.txt",
];

export const canonicalFlags = [
  "-C",
  "link-arg=--max-memory=268435456",
  "-C",
  "link-arg=-zstack-size=1048576",
  "--remap-path-prefix=<engine-root>=/engine/frozenight",
  "--remap-path-prefix=<cargo-home>=/cargo",
  // Installed rust-src changes std source spans. Use the compiler's original
  // paths so warm builds and fresh builds agree whether sources are installed.
  "--remap-path-prefix=<rust-source>=/rustc/<rust-commit>",
];

export function engineRustFlags(
  engineRoot: string,
  cargoHome: string,
  sysroot: string,
  compiler: string,
) {
  const commit = /^commit-hash: ([a-f0-9]{40})$/m.exec(compiler)?.[1];
  if (!commit) {
    throw Error("Cannot identify pinned Rust compiler commit");
  }

  return canonicalFlags.map((flag) =>
    flag
      .replace("<engine-root>", engineRoot)
      .replace("<cargo-home>", cargoHome)
      .replace("<rust-source>", path.join(sysroot, "lib/rustlib/src/rust"))
      .replace("<rust-commit>", commit),
  );
}

export const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export function engineSource(cwd = projectRoot) {
  const source = JSON.parse(
    fs.readFileSync(path.join(cwd, "engine/frozenight/source.json"), "utf8"),
  );
  if (
    !/^[a-f0-9]{40}$/.test(source.upstreamCommit) ||
    !/^[a-f0-9]{64}$/.test(source.modelSha256)
  )
    throw Error(
      "Invalid engine source/model pins in engine/frozenight/source.json.",
    );
  if (
    digest(
      fs.readFileSync(path.join(cwd, "engine/frozenight/core/model.json.zst")),
    ) !== source.modelSha256
  )
    throw Error("Engine model does not match its reviewed source.json pin.");
  return source as { upstreamCommit: string; modelSha256: string };
}

export function inventory(
  directory: string,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relative = prefix + entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      Object.assign(result, inventory(file, relative + "/"));
    else if (entry.isFile()) result[relative] = digest(fs.readFileSync(file));
    else throw Error(`Unexpected generated engine file type: ${relative}`);
  }
  return result;
}

export function engineInputKey(cwd = projectRoot) {
  engineSource(cwd);
  const hash = createHash("sha256");
  function walk(relative: string) {
    const file = path.join(cwd, relative);
    if (fs.statSync(file).isDirectory()) {
      for (const name of fs.readdirSync(file).sort())
        if (!["target", ".git", ".DS_Store"].includes(name))
          walk(path.join(relative, name));
    } else {
      hash.update(relative.split(path.sep).join("/") + "\0");
      hash.update(fs.readFileSync(file));
      hash.update("\0");
    }
  }
  walk("engine");
  walk(engineTools);
  for (const file of licenseFiles) walk(path.join("assets/frozenight", file));
  const pkg = JSON.parse(
    fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
  );
  hash.update(
    JSON.stringify({
      bun: pkg.packageManager,
      chess: pkg.dependencies["chess.js"],
    }),
  );
  return hash.digest("hex");
}

export type EngineManifest = {
  inputKey: string;
  upstreamCommit: string;
  networkHash: string;
  buildHash: string;
  wasmFile: string;
  wasmSha256: string;
  rawBytes: number;
  buildHost: string;
  toolchain: string;
  maximumMemoryMiB: number;
  [key: string]: unknown;
};

export function validateEngine(
  directory: string,
  key: string,
  cwd = projectRoot,
): EngineManifest {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "engine-manifest.json"), "utf8"),
  ) as EngineManifest;
  const source = engineSource(cwd);
  if (
    manifest.inputKey !== key ||
    manifest.upstreamCommit !== source.upstreamCommit ||
    manifest.networkHash !== source.modelSha256 ||
    typeof manifest.buildHost !== "string" ||
    !/^[a-z0-9_]+(?:-[a-z0-9_]+){2,}$/.test(manifest.buildHost) ||
    manifest.toolchain !== `Rust ${rustVersion}` ||
    !/^[a-f0-9]{64}$/.test(manifest.buildHash) ||
    !/^engine-[a-f0-9]{16}\.wasm$/.test(manifest.wasmFile)
  )
    throw Error("Generated engine metadata does not match the current inputs.");
  const bytes = fs.readFileSync(path.join(directory, manifest.wasmFile));
  if (
    bytes.length !== manifest.rawBytes ||
    digest(bytes) !== manifest.wasmSha256 ||
    manifest.wasmFile !== `engine-${manifest.wasmSha256.slice(0, 16)}.wasm`
  )
    throw Error("Generated engine WASM does not match its manifest.");
  for (const name of licenseFiles)
    if (!fs.statSync(path.join(directory, name)).isFile())
      throw Error(`Missing engine license: ${name}`);
  return manifest;
}
