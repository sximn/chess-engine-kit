import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { NoticeBundle, addRustNotices } from "./notice-bundle.ts";
import { rustEnvironment } from "./rust-environment.ts";
import {
  engineRustFlags,
  engineCargoArgs,
  engineTarget,
  rustVersion,
} from "./engine-inputs.ts";
import {
  compilationInventory,
  rustLibraryPackages,
} from "./notice-inventory.ts";

type CargoPackage = {
  id: string;
  name: string;
  version: string;
  license: string | null;
  source: string | null;
  repository: string | null;
  manifest_path: string;
};
type RustManifest = {
  package: { name: string; version: string; license: string };
};

const args = process.argv.slice(2);
const checkOnly = args.length === 1 && args[0] === "--check";
if (!checkOnly && args.length && (args.length !== 2 || args[0] !== "--output"))
  throw Error("Use engine:notices [--output <directory> | --check].");
const output = path.resolve(args[1] || "assets/frozenight");
const cargo = process.env.ENGINE_CARGO || "cargo";
const env = rustEnvironment(path.resolve("engine/frozenight"));
const rustc = env.RUSTC!;
function compilerOutput(args: string[]) {
  const result = spawnSync(rustc, args, { encoding: "utf8", env });
  if (result.status !== 0)
    throw Error(result.stderr || "Cannot run pinned rustc");
  return result.stdout.trim();
}
const compiler = compilerOutput(["-vV"]);
if (!compiler.split("\n").includes(`release: ${rustVersion}`))
  throw Error(
    `Notice generation requires the pinned Rust ${rustVersion} compiler`,
  );
const sysroot = compilerOutput(["--print", "sysroot"]);
const rustDoc = path.join(sysroot, "share/doc/rust");
const rustSource = path.join(sysroot, "lib/rustlib/src/rust/library");
if (!fs.existsSync(path.join(rustSource, "Cargo.lock")))
  throw Error(
    `Missing Rust ${rustVersion} sources. Run once: rustup component add rust-src --toolchain ${rustVersion}. npm users do not need Rust.`,
  );
for (const file of ["COPYRIGHT-library.html", "COPYRIGHT.html"])
  if (!fs.existsSync(path.join(rustDoc, file)))
    throw Error(`Missing Rust copyright inventory: ${file}`);
if (checkOnly) {
  console.log(`Rust ${rustVersion} notice prerequisites are installed.`);
  process.exit(0);
}
fs.mkdirSync(output, { recursive: true });

// A fresh target directory ensures rustc prints the link arguments even when
// the normal engine cache is warm (Cargo does not replay this stdout).
const buildDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "engine-notices-"),
);
let compiled: ReturnType<typeof compilationInventory>;
try {
  const built = spawnSync(
    cargo,
    [
      ...engineCargoArgs(path.resolve("engine/frozenight"), "rustc"),
      "--message-format=json",
      "--",
      "--print=link-args",
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...env,
        CARGO_TARGET_DIR: buildDirectory,
        CARGO_ENCODED_RUSTFLAGS: engineRustFlags(
          path.resolve("engine/frozenight"),
          path.resolve(
            process.env.CARGO_HOME || path.join(os.homedir(), ".cargo"),
          ),
          sysroot,
          compiler,
        ).join("\x1f"),
      },
    },
  );
  if (built.status !== 0) throw Error(built.stderr, { cause: built.error });
  compiled = compilationInventory(
    built.stdout,
    buildDirectory,
    engineTarget,
    compilerOutput(["--print", "target-libdir", "--target", engineTarget]),
  );
} finally {
  fs.rmSync(buildDirectory, { recursive: true, force: true });
}

const result = spawnSync(
  cargo,
  [
    "metadata",
    "--manifest-path",
    "engine/frozenight/Cargo.toml",
    "--locked",
    "--format-version",
    "1",
  ],
  {
    encoding: "utf8",
    env,
  },
);

if (result.status !== 0) {
  throw Error(result.stderr);
}

const metadata = JSON.parse(result.stdout) as { packages: CargoPackage[] },
  packages = metadata.packages.filter(
    (p) => p.source && compiled.packages.has(p.id),
  );

for (const id of compiled.packages.keys())
  if (!metadata.packages.some((p) => p.id === id))
    throw Error(`Missing Cargo metadata for compiled package ${id}`);

if (packages.some((p) => !p.license || /GPL|AGPL|LGPL/.test(p.license))) {
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
    `Cargo dependency: ${p.name} ${p.version}\nSPDX: ${p.license}\nScope: ${[...compiled.packages.get(p.id)!].sort().join(", ")}\n${references.join("\n")}`,
  );
}

// Cargo does not report the precompiled standard library. Identify every linked
// archive using the source lockfile shipped with this exact compiler release.
const locked = Bun.TOML.parse(
  fs.readFileSync(path.join(rustSource, "Cargo.lock"), "utf8"),
) as {
  package: { name: string; version: string; source?: string }[];
};
const rustPackages = rustLibraryPackages(compiled.libraries, locked.package);

addRustNotices(
  bundle,
  fs.readFileSync(path.join(rustDoc, "COPYRIGHT-library.html"), "utf8"),
  (name) => fs.readFileSync(path.join(rustDoc, "licenses", name), "utf8"),
  new Set(
    rustPackages.filter((p) => p.source).map((p) => `${p.name}-${p.version}`),
  ),
  fs.readFileSync(path.join(rustDoc, "COPYRIGHT.html"), "utf8"),
);

// Most in-tree crates use Rust's common notices above. Vendored source crates
// with their own license (currently compiler_builtins) need their full notices,
// including the LLVM exception. Fail closed if a linked source crate is unknown.
for (const p of rustPackages.filter((p) => !p.source)) {
  const directory = [
    p.name,
    p.name.replace(/_/g, "-"),
    "compiler-builtins/compiler-builtins",
  ]
    .map((name) => path.join(rustSource, name))
    .find((dir) => {
      const file = path.join(dir, "Cargo.toml");
      return (
        fs.existsSync(file) &&
        (Bun.TOML.parse(fs.readFileSync(file, "utf8")) as RustManifest).package
          ?.name === p.name
      );
    });
  if (!directory) throw Error(`Missing linked Rust source crate ${p.name}`);
  const { package: pkg } = Bun.TOML.parse(
    fs.readFileSync(path.join(directory, "Cargo.toml"), "utf8"),
  ) as RustManifest;
  if (pkg.version !== p.version || !pkg.license)
    throw Error(`Invalid linked Rust manifest: ${p.name}`);
  if (pkg.license === "MIT OR Apache-2.0") continue;
  let noticeDirectory = directory;
  let files: string[] = [];
  while (noticeDirectory.startsWith(rustSource + path.sep)) {
    files = fs
      .readdirSync(noticeDirectory)
      .sort()
      .filter(
        (name) =>
          /^(LICENSE|LICENCE|COPYING|NOTICE)/i.test(name) &&
          fs.statSync(path.join(noticeDirectory, name)).isFile(),
      );
    if (files.length) break;
    noticeDirectory = path.dirname(noticeDirectory);
  }
  if (!files.length)
    throw Error(`Missing linked Rust source notices: ${p.name}`);
  bundle.addComponent(
    `Rust in-tree dependency: ${p.name} ${p.version}\nScope: WASM link input\nSPDX: ${pkg.license}\nSource: Rust ${rustVersion} library/${path.relative(rustSource, noticeDirectory)}\n${files.map((name) => `${name}: ${bundle.addText(fs.readFileSync(path.join(noticeDirectory, name), "utf8"))}`).join("\n")}`,
  );
}

fs.writeFileSync(path.join(output, "THIRD-PARTY-NOTICES.txt"), bundle.render());
fs.copyFileSync(
  "engine/frozenight/LICENSE-MIT",
  path.join(output, "LICENSE-MIT.txt"),
);
fs.copyFileSync(
  "engine/frozenight/LICENSE-APACHE",
  path.join(output, "LICENSE-APACHE.txt"),
);
console.log(
  `Consolidated chess.js, ${packages.length} compiled Cargo crates and ${rustPackages.length} Rust ${rustVersion} link inputs for ${engineTarget}. Commit the refreshed notices with engine/dependency updates.`,
);
