import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
    <h3>${name}</h3><p><b>Authors:</b> A &amp; B</p>
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
  addRustNotices(bundle, html, (name) => {
    assert.equal(name, "MIT.txt");
    return "MIT license terms";
  });
  const text = bundle.render();
  assert.equal(text.match(/Copyright Alice/g)?.length, 1);
  assert.equal(text.match(/Copyright Bob/g)?.length, 1);
  assert.equal(text.match(/Permission granted to <everyone>\./g)?.length, 2);
  assert.match(text, /Authors: A & B/);
  assert.match(text, /File\/Directory: library\/core/);
  assert.match(text, /Copyright: Rust contributors/);
  for (const name of ["one", "two", "three"])
    assert.match(text, new RegExp(`Rust standard-library dependency: ${name}`));
  assert.throws(() =>
    addRustNotices(new NoticeBundle(), "<body>changed format</body>", () => ""),
  );
  assert.throws(() =>
    addRustNotices(
      new NoticeBundle(),
      html.replace("&amp;", "&unknown;"),
      () => "MIT",
    ),
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
  const dependencies = JSON.parse(
    fs.readFileSync("engine/frozenight/dependencies.json", "utf8"),
  );
  for (const dependency of dependencies)
    assert.ok(
      text.includes(
        `Cargo dependency: ${dependency.name} ${dependency.version}\nSPDX: ${dependency.license}`,
      ),
    );
  assert.match(text, /Copyright: 1991-2024 Unicode, Inc/);
  assert.match(text, /UNICODE LICENSE V3/);
});
