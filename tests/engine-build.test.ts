import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildInLinuxContainer } from "../scripts/maintenance/engine/linux-build.ts";

test("canonical compiler isolates Linux caches, mounts sources read-only and remaps paths", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "chess linux builder "),
  );
  try {
    fs.mkdirSync(path.join(directory, "target/release"), { recursive: true });
    const native = path.join(directory, "target/release/native-reference");
    fs.writeFileSync(native, "native cache");
    const artifact = path.join(
      directory,
      "target/linux-x64/target/wasm32-unknown-unknown/release/upapawn_engine.wasm",
    );
    const invocations: string[][] = [];
    const bytes = Buffer.from("canonical compiler output");
    const flags = [
      "-C",
      "link-arg=--max-memory=268435456",
      "--remap-path-prefix=<engine-root>=/engine/frozenight",
      "--remap-path-prefix=<cargo-home>=/cargo",
    ];
    const actual = buildInLinuxContainer(directory, flags, (args) => {
      invocations.push(args);
      if (args[0] === "run") {
        assert.equal(args[args.indexOf("--platform") + 1], "linux/amd64");
        assert.ok(args.includes(`${directory}:/engine/frozenight:ro`));
        assert.ok(args.includes("CARGO_HOME=/cargo"));
        assert.ok(args.includes("CARGO_TARGET_DIR=/engine/frozenight/target"));
        assert.ok(args.includes("CARGO_INCREMENTAL=0"));
        assert.ok(
          args.includes(
            "CARGO_ENCODED_RUSTFLAGS=-C\x1flink-arg=--max-memory=268435456\x1f--remap-path-prefix=/engine/frozenight=/engine/frozenight\x1f--remap-path-prefix=/cargo=/cargo",
          ),
        );
        assert.equal(args.includes("--env-file"), false);
        fs.mkdirSync(path.dirname(artifact), { recursive: true });
        fs.writeFileSync(artifact, bytes);
      }
    });
    assert.deepEqual(actual, bytes);
    assert.deepEqual(
      invocations.map((args) => args[0]),
      ["build", "run"],
    );
    assert.equal(fs.readFileSync(native, "utf8"), "native cache");
    // A failed rebuild must never return the previous successful artifact.
    assert.throws(
      () =>
        buildInLinuxContainer(directory, flags, (args) => {
          if (args[0] === "run") throw Error("Compiler failed");
        }),
      /Compiler failed/,
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
      "scripts",
      "node_modules/chess.js",
      "sysroot/share/doc/rust/licenses",
    ])
      fs.mkdirSync(path.join(directory, name), { recursive: true });
    for (const name of ["engine-notices.ts", "notice-bundle.ts"])
      fs.copyFileSync(
        path.join("scripts/maintenance/engine", name),
        path.join(directory, "scripts", name),
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
      `#!${process.execPath}\nif (process.env.RUSTC !== ${JSON.stringify(rustc)}) { console.error("No matching Rust compiler configured"); process.exit(1); }\nconsole.log(JSON.stringify({packages:[]}));\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      rustc,
      `#!${process.execPath}\nconsole.log(${JSON.stringify(path.join(directory, "sysroot"))});\n`,
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
    const result = Bun.spawnSync(
      [process.execPath, "scripts/engine-notices.ts"],
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
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
