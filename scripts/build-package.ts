import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { AssetEntry } from "../src/core/types.ts";
import { ensureEngine } from "./maintenance/engine/engine-cache.ts";

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw Error("Build failed: " + cmd);
};

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const engine = ensureEngine();
const original = engine.manifest;
const source = engine.absoluteDirectory;
const wasmFile = original.wasmFile;
const wasmBytes = fs.readFileSync(path.join(source, wasmFile));

if (
  sha(wasmBytes) !== original.wasmSha256 ||
  wasmBytes.length !== original.rawBytes
) {
  throw Error("Cached WASM does not match its build manifest");
}

fs.mkdirSync(".build", { recursive: true });
run("bun", [
  "build",
  "src/adapters/frozenight/worker.ts",
  "--target",
  "browser",
  "--format",
  "esm",
  "--minify",
  "--outfile",
  ".build/worker.js",
]);

const workerBytes = fs.readFileSync(".build/worker.js");
const workerFile = "worker-" + sha(workerBytes).slice(0, 16) + ".js";
const entry = (file: string, bytes: Uint8Array): AssetEntry => ({
  file,
  sha256: sha(bytes),
  bytes: bytes.length,
});

const notices: AssetEntry[] = [];

function collect(dir: string, prefix = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + e.name;
    const file = path.join(dir, e.name);
    if (e.isDirectory()) collect(file, rel + "/");
    else if (rel !== wasmFile) notices.push(entry(rel, fs.readFileSync(file)));
  }
}
collect(source);

// Directory order differs between runtimes; keep generated metadata stable.
notices.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
const manifest = {
  apiVersion: 1,
  packageVersion: pkg.version,
  descriptor: {
    engineId: "frozenight",
    engineName: "Frozenight",
    engineVersion: pkg.version + "+" + original.upstreamCommit.slice(0, 12),
    sourceRevision: original.upstreamCommit,
    buildHash: original.buildHash,
    modelHash: original.networkHash,
    adapterHash: sha(workerBytes),
  },
  wasm: entry(wasmFile, wasmBytes),
  worker: entry(workerFile, workerBytes),
  notices,
  toolchain: original.toolchain,
  maximumLinearMemoryMiB: original.maximumMemoryMiB,
};

// Keep each path literal: new URL(variable, import.meta.url) cannot be discovered
// by consumer bundlers. no-inline keeps workers, WASM and notices as HTTP assets
// in bundlers that support that query; other hosts can serve it as a normal URL.
const assetUrl = (file: string) =>
  `new URL(${JSON.stringify("./assets/frozenight/" + file + "?no-inline")}, import.meta.url)`;

const assetUrls = `() => ({
  wasm: ${assetUrl(manifest.wasm.file)},
  worker: ${assetUrl(manifest.worker.file)},
  notices: {${notices.map((notice) => `${JSON.stringify(notice.file)}: ${assetUrl(notice.file)}`).join(",")}}
})`;
fs.rmSync("dist", { recursive: true, force: true });

const destination = "dist/assets/frozenight";
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true });

fs.writeFileSync(path.join(destination, workerFile), workerBytes);
fs.writeFileSync(
  path.join(destination, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

const sdk = await Bun.build({
  entrypoints: ["src/index.ts"],
  target: "browser",
  format: "esm",
  external: ["chess.js"],
  outdir: "dist",
  define: {
    __CHESS_ENGINE_MANIFEST__: JSON.stringify(manifest),
  },
  plugins: [
    {
      name: "packaged-asset-urls",
      setup(build) {
        build.onLoad(
          { filter: /\/adapters\/frozenight\/urls\.ts$/ },
          (args) => ({
            contents: fs
              .readFileSync(args.path, "utf8")
              .replace("__CHESS_ENGINE_ASSET_URLS__()", `(${assetUrls})()`),
            loader: "ts",
          }),
        );
      },
    },
  ],
});

if (!sdk.success) {
  throw new AggregateError(sdk.logs, "SDK build failed");
}

run("bun", ["x", "--no-install", "tsc", "-p", "tsconfig.build.json"]);

// npm users run the published CLI with Node; Bun is only needed by maintainers.
const cli = "dist/bin/copy-assets.js";

run("bun", [
  "build",
  "bin/copy-assets.ts",
  "--target",
  "node",
  "--format",
  "esm",
  "--outfile",
  cli,
]);

fs.writeFileSync(
  cli,
  fs
    .readFileSync(cli, "utf8")
    .replace(/^#!.*\n(?:\/\/ @bun\n)?/, "#!/usr/bin/env node\n"),
);

fs.chmodSync(cli, 0o755);

console.log(
  "Built SDK, declarations and content-addressed engine assets. Engine cache reused when inputs match.",
);
