import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { rustEnvironment } from "./rust-environment.ts";
import {
  canonicalFlags,
  engineInputKey,
  engineSource,
  licenseFiles,
  projectRoot,
} from "./engine-inputs.ts";
const root = path.resolve("engine/frozenight");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output")
  throw Error("Internal compiler requires --output <directory>.");
const destination = path.resolve(args[1]);
const inputKey = engineInputKey();
const sourcePin = engineSource();
const flags = canonicalFlags.join(" ");
const cargoHome = path.resolve(
  process.env.CARGO_HOME || path.join(os.homedir(), ".cargo"),
);
const actualFlags = canonicalFlags.map((flag) =>
  flag.replace("<engine-root>", root).replace("<cargo-home>", cargoHome),
);
const cargo = process.env.ENGINE_CARGO || "cargo";
const env = rustEnvironment(root);
const compiler = spawnSync(env.RUSTC!, ["-vV"], {
  encoding: "utf8",
  env,
});
const buildHost = /^host: (\S+)$/m.exec(compiler.stdout ?? "")?.[1];
if (
  compiler.status !== 0 ||
  !/^release: 1\.90\.0$/m.test(compiler.stdout ?? "") ||
  !buildHost
)
  throw Error(
    "Engine builds require Rust 1.90.0 with the wasm32-unknown-unknown target. See docs/DEVELOPMENT.md#first-source-build.",
    { cause: compiler.error },
  );
const built = spawnSync(
  cargo,
  [
    "build",
    "--manifest-path",
    root + "/Cargo.toml",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "-p",
    "upapawn-engine",
    "--lib",
  ],
  {
    stdio: "inherit",
    env: {
      ...env,
      CARGO_ENCODED_RUSTFLAGS: actualFlags.join("\x1f"),
    },
  },
);
if (built.error) throw built.error;
if (built.status !== 0) process.exit(built.status ?? 1);
const bytes = fs.readFileSync(
  root + "/target/wasm32-unknown-unknown/release/upapawn_engine.wasm",
);
const sha = (bytes: Uint8Array) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
const source = crypto.createHash("sha256");
function walk(dir: string) {
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "target") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.rs$|\.toml$|Cargo.lock$|model.json.zst$/.test(p)) {
      source.update(path.relative(root, p));
      source.update(fs.readFileSync(p));
    }
  }
}
walk(root);
source.update(flags);
const buildHash = source.digest("hex");
const wasmSha256 = sha(bytes);
const module = await WebAssembly.compile(bytes);
const imports = WebAssembly.Module.imports(module);
if (
  imports.some(
    (i) =>
      i.module !== "env" ||
      !["now_ms", "emit_progress", "out_of_memory"].includes(i.name),
  )
)
  throw Error("Unexpected native/runtime WASM import");
fs.mkdirSync(destination, { recursive: true });
const file = `engine-${wasmSha256.slice(0, 16)}.wasm`;
const manifest = {
  apiVersion: 1,
  inputKey,
  engine: "Frozenight",
  upstreamCommit: sourcePin.upstreamCommit,
  buildHash,
  networkHash: sha(fs.readFileSync(root + "/core/model.json.zst")),
  wasmSha256,
  wasmFile: file,
  rawBytes: bytes.length,
  gzipBytes: zlib.gzipSync(bytes, { level: 9 }).length,
  brotliBytes: zlib.brotliCompressSync(bytes, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 },
  }).length,
  toolchain: "Rust 1.90.0",
  buildHost,
  target: "wasm32-unknown-unknown",
  mode: "scalar",
  threads: 1,
  maximumMemoryMiB: 256,
  flags,
  imports,
};
fs.writeFileSync(destination + "/" + file, bytes);
for (const e of fs.readdirSync(destination))
  if (/^engine-[a-f0-9]+\.wasm$/.test(e) && e !== file)
    fs.unlinkSync(destination + "/" + e);
fs.writeFileSync(
  destination + "/engine-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
for (const name of licenseFiles) {
  if (name.startsWith("LICENSE-")) {
    const upstream =
      name === "LICENSE-MIT.txt" ? "LICENSE-MIT" : "LICENSE-APACHE";
    if (
      !fs
        .readFileSync(path.join(root, upstream))
        .equals(
          fs.readFileSync(path.join(projectRoot, "assets/frozenight", name)),
        )
    )
      throw Error(
        "Reviewed engine licenses are stale. Run bun run engine:notices and review the changes.",
      );
  }
  fs.copyFileSync(
    path.join(projectRoot, "assets/frozenight", name),
    path.join(destination, name),
  );
}
console.log(JSON.stringify(manifest, null, 2));
