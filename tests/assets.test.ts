import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { assetBaseUrl, assetUrl } from "../src/adapters/frozenight/assets.ts";

test("asset URLs allow bundler queries and reject cross-origin or inline assets", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL("https://app.example/review/"),
  });
  try {
    assert.equal(
      assetUrl("/assets/engine.wasm?no-inline").href,
      "https://app.example/assets/engine.wasm?no-inline",
    );
    assert.equal(
      assetBaseUrl("./engine").href,
      "https://app.example/review/engine/",
    );
    for (const value of [
      "https://cdn.example/engine.wasm",
      "http://app.example/engine.wasm",
      "data:application/wasm;base64,AAAA",
      "blob:https://app.example/worker",
    ])
      assert.throws(() => assetUrl(value), /application origin/);
  } finally {
    if (original) Object.defineProperty(globalThis, "location", original);
    else Reflect.deleteProperty(globalThis, "location");
  }
});

test("packaged URLs retain literal paths to all verified assets and work without browser globals", async () => {
  const sdk: typeof import("../src/index.ts") = await import(
    new URL("../dist/index.js", import.meta.url).href
  );
  const urls = sdk.frozenightAssetUrls();
  const manifest = sdk.frozenightManifest;
  for (const [asset, url] of [
    [manifest.wasm, urls.wasm],
    [manifest.worker, urls.worker],
    ...manifest.notices.map(
      (notice) => [notice, urls.notices[notice.file]] as const,
    ),
  ] as const) {
    const bytes = fs.readFileSync(new URL(url));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
    );
  }
  assert.throws(
    () =>
      sdk.createFrozenight({
        assetUrls: urls,
        assetBaseUrl: "/manual/",
      }),
    /Choose assetUrls or assetBaseUrl/,
  );
});

test("asset deployment removes obsolete owned bytes and preserves unrelated/modified files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-assets-test-"));
  const sha = (s: string | Uint8Array) =>
    createHash("sha256").update(s).digest("hex");

  fs.writeFileSync(path.join(dir, "old.wasm"), "old");
  fs.writeFileSync(path.join(dir, "custom.txt"), "keep");
  fs.writeFileSync(path.join(dir, "modified.js"), "changed");

  const legacyNotices = [
    "CHESS-JS-LICENSE.txt",
    "DEPENDENCY-NOTICES.txt",
    "RUST-COPYRIGHT.html",
    "licenses/MIT.txt",
  ];

  for (const file of legacyNotices) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), "old notice");
  }

  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      apiVersion: 1,
      descriptor: { engineId: "frozenight" },
      wasm: { file: "old.wasm", sha256: sha("old") },
      worker: { file: "modified.js", sha256: sha("original") },
      notices: legacyNotices.map((file) => ({
        file,
        sha256: sha("old notice"),
      })),
    }),
  );

  execFileSync("bun", ["dist/bin/copy-assets.js", "--to", dir]);
  assert.equal(fs.existsSync(path.join(dir, "old.wasm")), false);
  for (const file of legacyNotices) {
    assert.equal(fs.existsSync(path.join(dir, file)), false);
  }

  assert.equal(fs.readFileSync(path.join(dir, "custom.txt"), "utf8"), "keep");
  assert.equal(
    fs.readFileSync(path.join(dir, "modified.js"), "utf8"),
    "changed",
  );

  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  );

  assert.equal(
    sha(fs.readFileSync(path.join(dir, manifest.wasm.file))),
    manifest.wasm.sha256,
  );

  for (const file of [
    "LICENSE-MIT.txt",
    "LICENSE-APACHE.txt",
    "THIRD-PARTY-NOTICES.txt",
  ]) {
    assert.ok(
      manifest.notices.some((notice: { file: string }) => notice.file === file),
    );
    assert.deepEqual(
      fs.readFileSync(path.join(dir, file)),
      fs.readFileSync(path.join("assets/frozenight", file)),
    );
  }
});
