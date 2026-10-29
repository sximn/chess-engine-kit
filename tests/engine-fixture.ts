import fs from "node:fs";
import path from "node:path";
import {
  digest,
  engineInputKey,
  engineSource,
  inventory,
  licenseFiles,
} from "../scripts/maintenance/engine/engine-inputs.ts";
import type { BuiltEngine } from "../scripts/maintenance/engine/engine-cache.ts";

export function makeEngineProject(directory: string) {
  for (const name of [
    "engine/frozenight/core",
    "assets/frozenight",
    "src",
    "bin",
    "docs",
    "tests",
    "examples",
    ".github",
    ".build/reports",
    "scripts",
  ])
    fs.mkdirSync(path.join(directory, name), { recursive: true });
  fs.cpSync(
    path.join(import.meta.dir, "../scripts/maintenance/engine"),
    path.join(directory, "scripts/maintenance/engine"),
    { recursive: true },
  );
  fs.copyFileSync(
    path.join(import.meta.dir, "../engine/frozenight/rust-toolchain.toml"),
    path.join(directory, "engine/frozenight/rust-toolchain.toml"),
  );
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "@test/chess-runtime",
      version: "1.2.3",
      repository: { url: "git+https://github.com/sximn/chess-engine-kit.git" },
      packageManager: "bun@1.4.4",
      dependencies: { "chess.js": "1.4.0" },
    }),
  );
  fs.writeFileSync(
    path.join(directory, ".gitignore"),
    ".build/\ndist/\nnode_modules/\nengine/frozenight/target/\n",
  );
  for (const name of [
    "bun.lock",
    "tsconfig.json",
    "tsconfig.build.json",
    "playwright.config.ts",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ])
    fs.writeFileSync(path.join(directory, name), "fixture\n");
  fs.writeFileSync(
    path.join(directory, "engine/frozenight/core/model.json.zst"),
    "model fixture",
  );
  fs.writeFileSync(
    path.join(directory, "engine/frozenight/core/lib.rs"),
    "fn fixture() {}\n",
  );
  fs.writeFileSync(
    path.join(directory, "engine/frozenight/source.json"),
    JSON.stringify({
      upstreamCommit: "1".repeat(40),
      modelSha256: digest("model fixture"),
    }),
  );
  for (const name of licenseFiles)
    fs.writeFileSync(
      path.join(directory, "assets/frozenight", name),
      name + " fixture\n",
    );
  fs.writeFileSync(
    path.join(directory, "engine/frozenight/LICENSE-MIT"),
    "LICENSE-MIT.txt fixture\n",
  );
  fs.writeFileSync(
    path.join(directory, "engine/frozenight/LICENSE-APACHE"),
    "LICENSE-APACHE.txt fixture\n",
  );
}

export function writeEngineFixture(output: string, cwd: string) {
  fs.mkdirSync(output, { recursive: true });
  const source = engineSource(cwd);
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const hash = digest(wasm),
    file = `engine-${hash.slice(0, 16)}.wasm`;
  const manifest = {
    apiVersion: 1,
    inputKey: engineInputKey(cwd),
    engine: "Frozenight",
    upstreamCommit: source.upstreamCommit,
    networkHash: source.modelSha256,
    buildHash: digest(
      fs.readFileSync(path.join(cwd, "engine/frozenight/core/lib.rs")),
    ),
    wasmFile: file,
    wasmSha256: hash,
    rawBytes: wasm.length,
    gzipBytes: 28,
    brotliBytes: 12,
    toolchain: "Rust 1.90.0",
    buildHost: "x86_64-unknown-linux-gnu",
    target: "wasm32-unknown-unknown",
    maximumMemoryMiB: 256,
  };
  fs.writeFileSync(path.join(output, file), wasm);
  fs.writeFileSync(
    path.join(output, "engine-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  for (const name of licenseFiles)
    fs.copyFileSync(
      path.join(cwd, "assets/frozenight", name),
      path.join(output, name),
    );
}

export async function writePackageFixture(
  tarball: string,
  engine: BuiltEngine,
  cwd: string,
  edit?: (files: Record<string, Uint8Array | string>) => void,
) {
  const prefix = "package/dist/assets/frozenight/";
  const files: Record<string, Uint8Array | string> = {};
  for (const name of Object.keys(engine.files))
    files[prefix + name] = fs.readFileSync(
      path.join(engine.absoluteDirectory, name),
    );
  const worker = Buffer.from("export {};\n"),
    workerFile = `worker-${digest(worker).slice(0, 16)}.js`;
  files[prefix + workerFile] = worker;
  const entry = (file: string) => ({
    file,
    sha256: digest(files[prefix + file] as Uint8Array),
    bytes: (files[prefix + file] as Uint8Array).length,
  });
  const pkg = JSON.parse(
    fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
  );
  files[prefix + "manifest.json"] = JSON.stringify({
    apiVersion: 1,
    packageVersion: pkg.version,
    wasm: entry(engine.manifest.wasmFile),
    worker: entry(workerFile),
    notices: Object.keys(engine.files)
      .filter((name) => name !== engine.manifest.wasmFile)
      .map(entry),
  });
  files["package/package.json"] = JSON.stringify(pkg);
  edit?.(files);
  fs.writeFileSync(
    tarball,
    Buffer.from(await new Bun.Archive(files, { compress: "gzip" }).bytes()),
  );
}
