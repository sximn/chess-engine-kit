import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const cargo = process.env.ENGINE_CARGO || "cargo";
const result = spawnSync(
  cargo,
  [
    "metadata",
    "--manifest-path",
    "engine/frozenight/Cargo.toml",
    "--locked",
    "--offline",
    "--format-version",
    "1",
  ],
  { encoding: "utf8", env: { ...process.env, RUSTUP_TOOLCHAIN: "1.90.0" } },
);
if (result.status !== 0) throw Error(result.stderr);
const metadata = JSON.parse(result.stdout),
  packages = metadata.packages.filter((p) => p.source);
const manifest = packages.map((p) => ({
  name: p.name,
  version: p.version,
  license: p.license,
  source: p.source,
  repository: p.repository,
}));
if (manifest.some((p) => !p.license || /GPL|AGPL|LGPL/.test(p.license)))
  throw Error("Dependency license requires review");
let text =
  "Frozenight browser port: dependency notices\n\nIncludes build-time dependencies as well as runtime libraries. Cargo.lock pins exact checksums.\n\n";
for (const p of packages) {
  text +=
    "\n" +
    "=".repeat(60) +
    "\n" +
    p.name +
    " " +
    p.version +
    "\nSPDX: " +
    p.license +
    "\n";
  const dir = path.dirname(p.manifest_path);
  const licenses = fs
    .readdirSync(dir)
    .filter(
      (n) =>
        /^(LICENSE|LICENCE|COPYING|NOTICE)/i.test(n) &&
        fs.statSync(path.join(dir, n)).isFile(),
    );
  if (!licenses.length) {
    if (["cozy-chess", "cozy-chess-types"].includes(p.name))
      text +=
        "\n" +
        fs.readFileSync("engine/frozenight/COZY-CHESS-LICENSE-MIT.txt", "utf8");
    else throw Error("Missing packaged notice for " + p.name);
  }
  for (const file of licenses)
    text +=
      "\n" + file + "\n" + fs.readFileSync(path.join(dir, file), "utf8") + "\n";
}
const dir = "assets/frozenight";
fs.writeFileSync(dir + "/DEPENDENCY-NOTICES.txt", text);
fs.writeFileSync(
  "engine/frozenight/dependencies.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log("Retained notices for", packages.length, "locked crates");

// Rust's shipped standard-library notices are outside Cargo metadata.
const rustc = process.env.ENGINE_CARGO
  ? path.join(path.dirname(cargo), "rustc")
  : "rustc";
const sysrootResult = spawnSync(rustc, ["--print", "sysroot"], {
  encoding: "utf8",
  env: { ...process.env, RUSTUP_TOOLCHAIN: "1.90.0" },
});
if (sysrootResult.status !== 0)
  throw Error("Cannot locate pinned Rust standard-library notices");
const rustDoc = path.join(sysrootResult.stdout.trim(), "share/doc/rust");
fs.copyFileSync(
  path.join(rustDoc, "COPYRIGHT-library.html"),
  dir + "/RUST-COPYRIGHT.html",
);
fs.cpSync(path.join(rustDoc, "licenses"), dir + "/licenses", {
  recursive: true,
});
console.log(
  "Retained Rust 1.90.0 standard-library notices (including notices for other targets).",
);
