import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { NoticeBundle, addRustNotices } from "./notice-bundle.ts";

type CargoPackage = {
  name: string;
  version: string;
  license: string | null;
  source: string | null;
  repository: string | null;
  manifest_path: string;
};

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

if (result.status !== 0) {
  throw Error(result.stderr);
}

const metadata = JSON.parse(result.stdout) as { packages: CargoPackage[] },
  packages = metadata.packages.filter((p) => p.source);

const manifest = packages.map((p) => ({
  name: p.name,
  version: p.version,
  license: p.license,
  source: p.source,
  repository: p.repository,
}));

if (manifest.some((p) => !p.license || /GPL|AGPL|LGPL/.test(p.license))) {
  throw Error("Dependency license requires review");
}

const bundle = new NoticeBundle();

const chess = JSON.parse(
  fs.readFileSync("node_modules/chess.js/package.json", "utf8"),
);

const expectedChess = JSON.parse(fs.readFileSync("package.json", "utf8"))
  .dependencies["chess.js"];

if (chess.version !== expectedChess) {
  throw Error("Install the pinned chess.js before refreshing notices");
}

bundle.addComponent(
  `chess.js ${chess.version}\nSPDX: ${chess.license}\nLICENSE: ${bundle.addText(fs.readFileSync("node_modules/chess.js/LICENSE", "utf8"))}`,
);

for (const p of packages) {
  const references: string[] = [];
  const dir = path.dirname(p.manifest_path);

  const licenses = fs
    .readdirSync(dir)
    .sort()
    .filter(
      (n) =>
        /^(LICENSE|LICENCE|COPYING|NOTICE)/i.test(n) &&
        fs.statSync(path.join(dir, n)).isFile(),
    );

  if (!licenses.length) {
    if (["cozy-chess", "cozy-chess-types"].includes(p.name)) {
      references.push(
        `LICENSE-MIT: ${bundle.addText(fs.readFileSync("engine/frozenight/COZY-CHESS-LICENSE-MIT.txt", "utf8"))}`,
      );
    } else {
      throw Error("Missing packaged notice for " + p.name);
    }
  }

  for (const file of licenses) {
    references.push(
      `${file}: ${bundle.addText(fs.readFileSync(path.join(dir, file), "utf8"))}`,
    );
  }

  bundle.addComponent(
    `Cargo dependency: ${p.name} ${p.version}\nSPDX: ${p.license}\n${references.join("\n")}`,
  );
}

// Rust's shipped standard-library notices are outside Cargo metadata.
const rustc = process.env.ENGINE_CARGO
  ? path.join(path.dirname(cargo), "rustc")
  : "rustc";

const sysrootResult = spawnSync(rustc, ["--print", "sysroot"], {
  encoding: "utf8",
  env: { ...process.env, RUSTUP_TOOLCHAIN: "1.90.0" },
});

if (sysrootResult.status !== 0) {
  throw Error("Cannot locate pinned Rust standard-library notices");
}

const rustDoc = path.join(sysrootResult.stdout.trim(), "share/doc/rust");

addRustNotices(
  bundle,
  fs.readFileSync(path.join(rustDoc, "COPYRIGHT-library.html"), "utf8"),
  (name) => fs.readFileSync(path.join(rustDoc, "licenses", name), "utf8"),
);

fs.writeFileSync("assets/frozenight/THIRD-PARTY-NOTICES.txt", bundle.render());
fs.writeFileSync(
  "engine/frozenight/dependencies.json",
  JSON.stringify(manifest, null, 2) + "\n",
);

console.log(
  `Consolidated chess.js, ${packages.length} locked crates and Rust 1.90.0 standard-library notices. Commit the refreshed notices with engine/dependency updates.`,
);
