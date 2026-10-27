import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
test("asset deployment removes obsolete owned bytes and preserves unrelated/modified files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-assets-test-"));
  const sha = (s: string | Uint8Array) =>
    createHash("sha256").update(s).digest("hex");
  fs.writeFileSync(path.join(dir, "old.wasm"), "old");
  fs.writeFileSync(path.join(dir, "custom.txt"), "keep");
  fs.writeFileSync(path.join(dir, "modified.js"), "changed");
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      apiVersion: 1,
      descriptor: { engineId: "frozenight" },
      wasm: { file: "old.wasm", sha256: sha("old") },
      worker: { file: "modified.js", sha256: sha("original") },
      notices: [],
    }),
  );
  execFileSync("bun", ["dist/bin/copy-assets.js", "--to", dir]);
  assert.equal(fs.existsSync(path.join(dir, "old.wasm")), false);
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
});
