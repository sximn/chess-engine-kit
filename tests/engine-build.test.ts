import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { makeEngineProject } from "./engine-fixture.ts";
import {
  validateEngine,
  engineInputKey,
} from "../scripts/maintenance/engine/engine-inputs.ts";
import { rustEnvironment } from "../scripts/maintenance/engine/rust-environment.ts";

test("native builds pin the model, compiler and target despite ambient Cargo overrides", () => {
  const env = rustEnvironment("/engine/frozenight", {
    ENGINE_CARGO: "/tools/cargo",
    CARGO_HOME: "/cache/cargo",
    RUSTUP_HOME: "/tools/rustup",
    EVALFILE: "/another-model.zst",
    RUSTUP_TOOLCHAIN: "nightly",
    RUSTC: "/another-rustc",
    RUSTC_WRAPPER: "sccache",
    RUSTC_WORKSPACE_WRAPPER: "wrapper",
    CARGO_PROFILE_RELEASE_OPT_LEVEL: "0",
    CARGO_BUILD_TARGET: "another-target",
    CARGO_TARGET_DIR: "/another-target-directory",
    CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: "--cfg alternate",
    RUSTFLAGS: "--cfg alternate",
    CARGO_ENCODED_RUSTFLAGS: "--cfg\x1falternate",
  });
  assert.equal(env.EVALFILE, "/engine/frozenight/core/model.json.zst");
  assert.equal(env.RUSTUP_TOOLCHAIN, "1.90.0");
  assert.equal(env.RUSTC, "/tools/rustc");
  assert.equal(env.CARGO_TARGET_DIR, "/engine/frozenight/target");
  assert.equal(env.CARGO_HOME, "/cache/cargo");
  assert.equal(env.RUSTUP_HOME, "/tools/rustup");
  for (const name of [
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "CARGO_PROFILE_RELEASE_OPT_LEVEL",
    "CARGO_BUILD_TARGET",
    "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS",
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
  ])
    assert.equal(env[name], undefined, name);
});

test("WASM builds use local pinned Rust, record its host and reject failed rebuilds", () => {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "chess local builder ")),
  );
  try {
    makeEngineProject(directory);
    const tools = path.join(directory, ".build/tools");
    fs.mkdirSync(tools);
    const invocation = path.join(tools, "invocation.json");
    const version = path.join(tools, "version");
    const failed = path.join(tools, "failed");
    fs.writeFileSync(version, "1.90.0");
    fs.writeFileSync(
      path.join(tools, "rustc"),
      `#!${process.execPath}
import fs from "node:fs";
if (process.argv.includes("-vV")) {
  console.log("release: " + fs.readFileSync(${JSON.stringify(version)}, "utf8"));
  console.log("host: aarch64-apple-darwin");
  console.log("commit-hash: " + "1".repeat(40));
} else console.log(${JSON.stringify(path.join(tools, "sysroot"))});
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(tools, "cargo"),
      `#!${process.execPath}
import fs from "node:fs";
import path from "node:path";
if (fs.existsSync(${JSON.stringify(failed)})) process.exit(1);
fs.writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({ args: process.argv.slice(2), env: process.env }));
const artifact = path.join(process.env.CARGO_TARGET_DIR, "wasm32-unknown-unknown/release/upapawn_engine.wasm");
fs.mkdirSync(path.dirname(artifact), { recursive: true });
fs.writeFileSync(artifact, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
`,
      { mode: 0o755 },
    );
    const run = () =>
      Bun.spawnSync(
        [
          process.execPath,
          "scripts/maintenance/engine/compile-engine.ts",
          "--output",
          ".build/output",
        ],
        {
          cwd: directory,
          env: {
            ...process.env,
            // Only the stub compiler is available; no external build service is used.
            PATH: tools,
            ENGINE_CARGO: path.join(tools, "cargo"),
            CARGO_HOME: path.join(directory, ".build/cargo"),
            RUSTFLAGS: "--cfg alternate",
            CARGO_BUILD_TARGET: "another-target",
          },
        },
      );
    const result = run();
    assert.equal(result.exitCode, 0, result.stderr.toString());
    const manifest = validateEngine(
      path.join(directory, ".build/output"),
      engineInputKey(directory),
      directory,
    );
    assert.equal(manifest.buildHost, "aarch64-apple-darwin");
    const { args, env } = JSON.parse(fs.readFileSync(invocation, "utf8"));
    assert.ok(args.includes("--locked"));
    assert.equal(args[args.indexOf("--target") + 1], "wasm32-unknown-unknown");
    assert.equal(env.RUSTUP_TOOLCHAIN, "1.90.0");
    assert.equal(env.RUSTFLAGS, undefined);
    assert.equal(env.CARGO_BUILD_TARGET, undefined);
    assert.ok(
      env.CARGO_ENCODED_RUSTFLAGS.includes(
        `--remap-path-prefix=${path.join(directory, "engine/frozenight")}=/engine/frozenight`,
      ),
    );
    assert.ok(
      env.CARGO_ENCODED_RUSTFLAGS.includes(
        `--remap-path-prefix=${path.join(directory, ".build/cargo")}=/cargo`,
      ),
    );
    assert.ok(
      env.CARGO_ENCODED_RUSTFLAGS.includes(
        `--remap-path-prefix=${path.join(tools, "sysroot/lib/rustlib/src/rust")}=/rustc/${"1".repeat(40)}`,
      ),
      "Installed Rust sources must not change embedded standard-library paths",
    );
    fs.unlinkSync(invocation);
    fs.writeFileSync(version, "1.91.0");
    const wrongVersion = run();
    assert.notEqual(wrongVersion.exitCode, 0);
    assert.match(wrongVersion.stderr.toString(), /require Rust 1\.90\.0/);
    assert.equal(fs.existsSync(invocation), false);
    fs.writeFileSync(version, "1.90.0");
    fs.writeFileSync(failed, "fail compilation");
    assert.notEqual(
      run().exitCode,
      0,
      "A failed build must not reuse stale WASM",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("notice generation uses the configured Cargo's Rust compiler with a cold cache", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chess-cold-cargo-"));
  try {
    for (const name of [
      "tools",
      "engine/frozenight",
      "assets/frozenight",
      "scripts/maintenance/engine",
      "node_modules/chess.js",
      "sysroot/share/doc/rust/licenses",
      "sysroot/lib/rustlib/src/rust/library/std",
      "sysroot/lib/rustlib/src/rust/library/compiler-builtins/compiler-builtins",
    ])
      fs.mkdirSync(path.join(directory, name), { recursive: true });
    for (const name of [
      "engine-notices.ts",
      "notice-bundle.ts",
      "rust-environment.ts",
      "engine-inputs.ts",
      "notice-inventory.ts",
    ])
      fs.copyFileSync(
        path.join("scripts/maintenance/engine", name),
        path.join(directory, "scripts/maintenance/engine", name),
      );
    fs.copyFileSync(
      "engine/frozenight/rust-toolchain.toml",
      path.join(directory, "engine/frozenight/rust-toolchain.toml"),
    );
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { "chess.js": "1.4.0" } }),
    );
    fs.writeFileSync(
      path.join(directory, "node_modules/chess.js/package.json"),
      JSON.stringify({ version: "1.4.0", license: "MIT" }),
    );
    fs.writeFileSync(
      path.join(directory, "node_modules/chess.js/LICENSE"),
      "Chess license fixture",
    );
    fs.writeFileSync(
      path.join(directory, "engine/frozenight/LICENSE-MIT"),
      "MIT fixture",
    );
    fs.writeFileSync(
      path.join(directory, "engine/frozenight/LICENSE-APACHE"),
      "Apache fixture",
    );
    const rustc = path.join(directory, "tools/rustc");
    fs.writeFileSync(
      path.join(directory, "tools/cargo"),
      `#!${process.execPath}
if (process.env.RUSTC !== ${JSON.stringify(rustc)}) { console.error("No matching Rust compiler configured"); process.exit(1); }
require("node:fs").writeFileSync(${JSON.stringify(path.join(directory, "cargo-invoked"))}, "called");
if (process.argv.includes("rustc")) {
  console.log(JSON.stringify({reason:"compiler-artifact", package_id:"engine", filenames:[process.env.CARGO_TARGET_DIR + "/wasm32-unknown-unknown/release/engine.wasm"]}));
  for (const name of ["std", "compiler_builtins"]) console.log(JSON.stringify(${JSON.stringify(path.join(directory, "sysroot/target-libdir"))} + "/lib" + name + "-abc123.rlib"));
} else console.log(JSON.stringify({packages:[{id:"engine", source:null}]}));
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      rustc,
      `#!${process.execPath}
if (process.argv.includes("-vV")) {
  console.log("release: 1.90.0");
  console.log("commit-hash: " + "1".repeat(40));
} else console.log(process.argv.includes("target-libdir") ? ${JSON.stringify(path.join(directory, "sysroot/target-libdir"))} : ${JSON.stringify(path.join(directory, "sysroot"))});
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(directory, "sysroot/share/doc/rust/COPYRIGHT-library.html"),
      '<body><h2 id="in-tree-files">In-tree files</h2><p><b>License:</b> MIT</p><p><b>Copyright:</b> Rust fixture</p><h2 id="out-of-tree-dependencies">Out-of-tree dependencies</h2></body>',
    );
    fs.writeFileSync(
      path.join(directory, "sysroot/share/doc/rust/licenses/MIT.txt"),
      "Rust license fixture",
    );
    fs.writeFileSync(
      path.join(directory, "sysroot/share/doc/rust/COPYRIGHT.html"),
      "<body></body>",
    );
    const source = path.join(directory, "sysroot/lib/rustlib/src/rust/library");
    fs.writeFileSync(
      path.join(source, "Cargo.lock"),
      'version = 4\n[[package]]\nname = "std"\nversion = "0.0.0"\n[[package]]\nname = "compiler_builtins"\nversion = "0.0.0"\n',
    );
    for (const [dir, name] of [
      ["std", "std"],
      ["compiler-builtins/compiler-builtins", "compiler_builtins"],
    ])
      fs.writeFileSync(
        path.join(source, dir, "Cargo.toml"),
        `[package]\nname = "${name}"\nversion = "0.0.0"\nlicense = "MIT OR Apache-2.0"\n`,
      );
    const result = Bun.spawnSync(
      [process.execPath, "scripts/maintenance/engine/engine-notices.ts"],
      {
        cwd: directory,
        env: {
          ...process.env,
          PATH: path.join(directory, "tools"),
          ENGINE_CARGO: path.join(directory, "tools/cargo"),
          CARGO_HOME: path.join(directory, "cold-cache"),
        },
      },
    );
    assert.equal(result.exitCode, 0, result.stderr.toString());
    const notices = fs.readFileSync(
      path.join(directory, "assets/frozenight/THIRD-PARTY-NOTICES.txt"),
      "utf8",
    );
    assert.match(notices, /Chess license fixture/);
    assert.match(notices, /Rust license fixture/);
    fs.unlinkSync(path.join(directory, "cargo-invoked"));
    fs.unlinkSync(path.join(source, "Cargo.lock"));
    const missingSource = Bun.spawnSync(
      [
        process.execPath,
        "scripts/maintenance/engine/engine-notices.ts",
        "--check",
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          ENGINE_CARGO: path.join(directory, "tools/cargo"),
        },
      },
    );
    assert.notEqual(missingSource.exitCode, 0);
    assert.match(
      missingSource.stderr.toString(),
      /Run once: rustup component add rust-src/,
    );
    assert.equal(
      fs.existsSync(path.join(directory, "cargo-invoked")),
      false,
      "Preflight must fail before Cargo compilation",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
