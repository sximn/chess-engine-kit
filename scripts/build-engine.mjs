import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import os from "node:os";
const root = path.resolve("engine/frozenight");
const canonicalFlags = [
  "-C",
  "link-arg=--max-memory=268435456",
  "-C",
  "link-arg=-zstack-size=1048576",
  "--remap-path-prefix=<engine-root>=/engine/frozenight",
  "--remap-path-prefix=<cargo-home>=/cargo",
];
const flags = canonicalFlags.join(" ");
const cargoHome = path.resolve(
  process.env.CARGO_HOME || path.join(os.homedir(), ".cargo"),
);
const actualFlags = canonicalFlags.map((flag) =>
  flag.replace("<engine-root>", root).replace("<cargo-home>", cargoHome),
);
const cargo = process.env.ENGINE_CARGO || "cargo";
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
      ...process.env,
      RUSTUP_TOOLCHAIN: "1.90.0",
      RUSTFLAGS: "",
      CARGO_ENCODED_RUSTFLAGS: actualFlags.join("\x1f"),
    },
  },
);
if (built.status !== 0) process.exit(built.status ?? 1);
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const source = crypto.createHash("sha256");
function walk(dir) {
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
const bytes = fs.readFileSync(
  root + "/target/wasm32-unknown-unknown/release/upapawn_engine.wasm",
);
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
const destination = "assets/frozenight";
fs.mkdirSync(destination, { recursive: true });
const file = `engine-${wasmSha256.slice(0, 16)}.wasm`;
const manifest = {
  apiVersion: 1,
  engine: "Frozenight",
  upstreamCommit: "f4d5a00725b2cd5f1c32910d57a84c77b66cc670",
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
fs.copyFileSync(root + "/LICENSE-MIT", destination + "/LICENSE-MIT.txt");
fs.copyFileSync(root + "/LICENSE-APACHE", destination + "/LICENSE-APACHE.txt");
console.log(JSON.stringify(manifest, null, 2));
