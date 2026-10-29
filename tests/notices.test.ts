import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  compilationInventory,
  rustLibraryPackages,
} from "../scripts/maintenance/engine/notice-inventory.ts";
import {
  NoticeBundle,
  addRustNotices,
} from "../scripts/maintenance/engine/notice-bundle.ts";

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

test("notice sharing preserves distinct authors and license wording", () => {
  const bundle = new NoticeBundle();
  const first = bundle.addText("Copyright Alice\n\nPermission granted.");
  assert.equal(bundle.addText("Copyright  Alice Permission\n granted."), first);
  assert.notEqual(
    bundle.addText("Copyright Bob\n\nPermission granted."),
    first,
  );
  assert.notEqual(
    bundle.addText("Copyright Alice\n\nPermission denied."),
    first,
  );
});

test("Rust conversion preserves metadata, encoded text and shared notices", () => {
  const bundle = new NoticeBundle();
  const section = (name: string, copyright: string) => `
    <h3>📦 ${name}-1.0.0</h3><p><b>Authors:</b> A &amp; B</p>
    <p><b>License:</b> MIT</p><p><b>Notices:</b>
    <details><summary><code>LICENSE-MIT</code></summary>
    <pre>Copyright ${copyright}\nPermission granted to &#60;everyone&#62;.</pre>
    </details></p>`;
  const html = `<body><h2 id="in-tree-files">In-tree files</h2>
    <p><b>File/Directory:</b> library/core</p><p><b>License:</b> MIT</p>
    <p><b>Copyright:</b> Rust contributors</p>
    <h2 id="out-of-tree-dependencies">Out-of-tree dependencies</h2>
    ${section("one", "Alice")}${section("two", "Alice")}${section("three", "Bob")}
    </body>`;
  addRustNotices(
    bundle,
    html,
    (name) => {
      assert.equal(name, "MIT.txt");
      return "MIT license terms";
    },
    new Set(["one-1.0.0", "two-1.0.0", "three-1.0.0"]),
    "",
  );
  const text = bundle.render();
  assert.equal(text.match(/Copyright Alice/g)?.length, 1);
  assert.equal(text.match(/Copyright Bob/g)?.length, 1);
  assert.equal(text.match(/Permission granted to <everyone>\./g)?.length, 2);
  assert.match(text, /Authors: A & B/);
  assert.match(text, /File\/Directory: library\/core/);
  assert.match(text, /Copyright: Rust contributors/);
  for (const name of ["one", "two", "three"])
    assert.match(
      text,
      new RegExp(`Rust standard-library dependency: 📦 ${name}`),
    );
  assert.throws(() =>
    addRustNotices(
      new NoticeBundle(),
      "<body>changed format</body>",
      () => "",
      new Set(),
      "",
    ),
  );
  assert.throws(() =>
    addRustNotices(
      new NoticeBundle(),
      html.replace("&amp;", "&unknown;"),
      () => "MIT",
      new Set(["one-1.0.0"]),
      "",
    ),
  );
});

test("Rust notices follow actual target link inputs, not the toolchain-wide inventory", () => {
  const target = "wasm32-unknown-unknown";
  const libdir = path.resolve("/tmp/test-sysroot/lib", target);
  const build = path.resolve("/tmp/test-notice-build");
  const artifact = (id: string, filename: string) =>
    JSON.stringify({
      reason: "compiler-artifact",
      package_id: id,
      filenames: [path.join(build, filename)],
    });
  const output = [
    artifact("runtime", `${target}/release/deps/libruntime.rlib`),
    artifact("generator", "release/deps/libgenerator.dylib"),
    ...["std", "compiler_builtins", "dlmalloc"].map((name) =>
      JSON.stringify(path.join(libdir, `lib${name}-abc123.rlib`)),
    ),
    // Host paths cannot select a target dependency.
    JSON.stringify(
      path.join("/tmp/test-sysroot/host", "libfortanix_sgx_abi-abc123.rlib"),
    ),
  ].join("\n");
  const inventory = compilationInventory(output, build, target, libdir);
  assert.deepEqual([...inventory.packages.get("runtime")!], ["wasm"]);
  assert.deepEqual([...inventory.packages.get("generator")!], ["build"]);
  const locked = [
    { name: "std", version: "0.0.0" },
    { name: "compiler_builtins", version: "0.1.160" },
    { name: "dlmalloc", version: "0.2.10", source: "registry" },
    { name: "fortanix-sgx-abi", version: "0.6.1", source: "registry" },
  ];
  assert.deepEqual(
    rustLibraryPackages(inventory.libraries, locked).map((p) => p.name),
    ["compiler_builtins", "dlmalloc", "std"],
  );
  assert.throws(
    () => rustLibraryPackages(new Set(["unknown"]), locked),
    /Cannot identify/,
  );
  assert.throws(
    () => compilationInventory("", build, target, libdir),
    /Missing/,
  );

  const header = `<body><h2 id="in-tree-files">In-tree files</h2>
    <p><b>License:</b> MIT</p><h2 id="out-of-tree-dependencies">Dependencies</h2>`;
  const section = (id: string, license: string) => `<h3>📦 ${id}</h3>
    <p><b>License:</b> ${license}</p><p><b>Authors:</b> Upstream author</p>
    <details><summary>LICENSE</summary><pre>Complete ${license} terms</pre></details>`;
  const html =
    header + section("fortanix-sgx-abi-0.6.1", "MPL-2.0") + "</body>";
  const supplemental = section("dlmalloc-0.2.10", "MIT");
  const selected = new Set(
    rustLibraryPackages(inventory.libraries, locked)
      .filter((p) => p.source)
      .map((p) => `${p.name}-${p.version}`),
  );
  const bundle = new NoticeBundle();
  addRustNotices(bundle, html, () => "MIT terms", selected, supplemental);
  assert.match(bundle.render(), /dlmalloc-0.2.10/);
  assert.doesNotMatch(bundle.render(), /fortanix|MPL/);
  // This is a target filter, never a license or component denylist.
  const sgx = new NoticeBundle();
  addRustNotices(
    sgx,
    html,
    () => "MIT terms",
    new Set(["fortanix-sgx-abi-0.6.1"]),
    supplemental,
  );
  assert.match(sgx.render(), /Complete MPL-2.0 terms/);
  assert.throws(
    () =>
      addRustNotices(
        new NoticeBundle(),
        html,
        () => "MIT",
        new Set(["missing-1.0.0"]),
        supplemental,
      ),
    /Missing upstream Rust notice/,
  );
  assert.throws(
    () =>
      addRustNotices(
        new NoticeBundle(),
        header +
          "<h3>📦 missing-text-1.0.0</h3><p><b>License:</b> MIT</p></body>",
        () => "MIT",
        new Set(["missing-text-1.0.0"]),
        "",
      ),
    /Missing complete upstream license/,
  );
});

test("committed notices resolve all references and cover the pinned dependencies", () => {
  const text = fs.readFileSync(
    "assets/frozenight/THIRD-PARTY-NOTICES.txt",
    "utf8",
  );
  const definitions = [...text.matchAll(/^\[(N\d+)\]\n-{72}\n/gm)];
  const ids = new Set(definitions.map((match) => match[1]));
  assert.equal(ids.size, definitions.length);
  for (const [, id] of text.matchAll(/\[(N\d+)\]/g))
    assert.ok(ids.has(id), `Unresolved notice ${id}`);
  const bodies = definitions.map((match, index) =>
    normalize(
      text.slice(
        match.index! + match[0].length,
        definitions[index + 1]?.index ?? text.length,
      ),
    ),
  );
  assert.equal(
    new Set(bodies).size,
    bodies.length,
    "Duplicate complete notice text",
  );
  assert.ok(
    normalize(text).includes(
      normalize(fs.readFileSync("node_modules/chess.js/LICENSE", "utf8")),
    ),
  );
  const lock = Bun.TOML.parse(
    fs.readFileSync("engine/frozenight/Cargo.lock", "utf8"),
  ) as {
    package: { name: string; version: string; source?: string }[];
  };
  const components = [...text.matchAll(/^Cargo dependency: (\S+) (\S+)$/gm)];
  assert.ok(components.length > 0);
  for (const [, name, version] of components)
    assert.ok(
      lock.package.some(
        (p) => p.name === name && p.version === version && p.source,
      ),
      `Unpinned Cargo notice: ${name} ${version}`,
    );
  assert.match(text, /Copyright: 1991-2024 Unicode, Inc/);
  assert.match(text, /UNICODE LICENSE V3/);
  assert.match(text, /LLVM Exceptions to the Apache 2.0 License/);
  assert.doesNotMatch(text, /fortanix-sgx-abi|MPL-2\.0/);
  assert.match(text, /Rust in-tree dependency: compiler_builtins/);
});
