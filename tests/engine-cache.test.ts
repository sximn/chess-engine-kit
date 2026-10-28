import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureEngine,
  readEngineCache,
  copyEngineCache,
} from "../scripts/maintenance/engine/engine-cache.ts";
import {
  digest,
  engineInputKey,
} from "../scripts/maintenance/engine/engine-inputs.ts";
import {
  makeEngineProject,
  writeEngineFixture,
  writePackageFixture,
} from "./engine-fixture.ts";
import { verifyPackagedEngine } from "../scripts/release/engine-artifact.ts";

function fixture() {
  const cwd = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "engine-cache-")),
  );
  makeEngineProject(cwd);
  return cwd;
}

test("engine cache reuses verified outputs for SDK/version edits and invalidates engine inputs", () => {
  const cwd = fixture();
  try {
    let builds = 0;
    const build = (out: string, root: string) => {
      builds++;
      writeEngineFixture(out, root);
    };
    const initial = ensureEngine({ cwd, build });
    assert.equal(initial.reused, false);
    assert.equal(ensureEngine({ cwd, build }).reused, true);
    fs.writeFileSync(path.join(cwd, "src/sdk.ts"), "SDK edit");
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    );
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ ...pkg, version: "1.2.4" }),
    );
    assert.equal(ensureEngine({ cwd, build }).key, initial.key);
    assert.equal(builds, 1);
    fs.appendFileSync(
      path.join(cwd, "engine/frozenight/core/lib.rs"),
      "// engine edit\n",
    );
    assert.notEqual(ensureEngine({ cwd, build }).key, initial.key);
    fs.appendFileSync(
      path.join(cwd, "scripts/maintenance/engine/Dockerfile"),
      "\n# toolchain edit\n",
    );
    ensureEngine({ cwd, build });
    fs.appendFileSync(
      path.join(cwd, "assets/frozenight/THIRD-PARTY-NOTICES.txt"),
      "notice edit",
    );
    ensureEngine({ cwd, build });
    fs.writeFileSync(
      path.join(cwd, "engine/frozenight/core/model.json.zst"),
      "new model",
    );
    assert.throws(
      () => ensureEngine({ cwd, build }),
      /reviewed source.json pin/,
    );
    const source = JSON.parse(
      fs.readFileSync(path.join(cwd, "engine/frozenight/source.json"), "utf8"),
    );
    fs.writeFileSync(
      path.join(cwd, "engine/frozenight/source.json"),
      JSON.stringify({ ...source, modelSha256: digest("new model") }),
    );
    ensureEngine({ cwd, build });
    assert.equal(builds, 5);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("cache validates every byte, rejects escaping indexes and preserves good output after failed builds", () => {
  const cwd = fixture();
  try {
    const first = ensureEngine({ cwd, build: writeEngineFixture });
    fs.appendFileSync(
      path.join(first.absoluteDirectory, first.manifest.wasmFile),
      "corrupt",
    );
    assert.equal(readEngineCache(cwd), null);
    const repaired = ensureEngine({ cwd, build: writeEngineFixture });
    assert.notEqual(repaired.absoluteDirectory, first.absoluteDirectory);
    assert.throws(
      () =>
        ensureEngine({
          cwd,
          force: true,
          build: () => {
            throw Error("compile failed");
          },
        }),
      /compile failed/,
    );
    assert.equal(
      readEngineCache(cwd)?.absoluteDirectory,
      repaired.absoluteDirectory,
    );
    const index = path.join(cwd, ".build/engine", repaired.key + ".json");
    const record = JSON.parse(fs.readFileSync(index, "utf8"));
    fs.writeFileSync(
      index,
      JSON.stringify({ ...record, directory: "../escape" }),
    );
    assert.equal(readEngineCache(cwd), null);
    ensureEngine({ cwd, build: writeEngineFixture });
    assert.throws(
      () =>
        ensureEngine({
          cwd,
          force: true,
          build: (out, root) => {
            writeEngineFixture(out, root);
            fs.appendFileSync(
              path.join(root, "engine/frozenight/core/lib.rs"),
              "// raced edit",
            );
          },
        }),
      /inputs changed during compilation/,
    );
    assert.equal(readEngineCache(cwd), null);
    assert.equal(
      fs
        .readdirSync(path.join(cwd, ".build/engine/objects"))
        .some((name) => name.startsWith(".building-")),
      false,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("version rehearsal can transport a verified engine cache without compiling", () => {
  const cwd = fixture(),
    destination = fixture();
  try {
    const built = ensureEngine({ cwd, build: writeEngineFixture });
    copyEngineCache(destination, cwd);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(destination, "package.json"), "utf8"),
    );
    fs.writeFileSync(
      path.join(destination, "package.json"),
      JSON.stringify({ ...pkg, version: "2.0.0" }),
    );
    const copied = ensureEngine({
      cwd: destination,
      build: () => {
        throw Error("Unexpected compilation");
      },
    });
    assert.equal(copied.key, built.key);
    assert.equal(copied.manifest.wasmSha256, built.manifest.wasmSha256);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test("package engine validation needs no local compiler/cache and catches missing or altered deployed assets", async () => {
  const cwd = fixture();
  try {
    const built = ensureEngine({ cwd, build: writeEngineFixture });
    const tarball = path.join(cwd, ".build/package.tgz");
    await writePackageFixture(tarball, built, cwd);
    const expected = { inputKey: built.key, files: built.files };
    const backup = path.join(cwd, ".build/cache-backup");
    fs.cpSync(built.absoluteDirectory, backup, { recursive: true });
    fs.rmSync(path.join(cwd, ".build/engine"), {
      recursive: true,
      force: true,
    });
    assert.equal(
      (await verifyPackagedEngine(tarball, expected, cwd)).wasmSha256,
      built.manifest.wasmSha256,
    );
    const source = { ...built, absoluteDirectory: backup };
    await writePackageFixture(tarball, source, cwd, (files) => {
      delete files["package/dist/assets/frozenight/" + built.manifest.wasmFile];
    });
    await assert.rejects(
      verifyPackagedEngine(tarball, expected, cwd),
      /Missing packaged engine asset/,
    );
    await writePackageFixture(tarball, source, cwd, (files) => {
      files["package/dist/assets/frozenight/" + built.manifest.wasmFile] =
        "corrupt";
    });
    await assert.rejects(
      verifyPackagedEngine(tarball, expected, cwd),
      /does not match its manifest/,
    );
    await writePackageFixture(tarball, source, cwd, (files) => {
      files["package/dist/assets/frozenight/THIRD-PARTY-NOTICES.txt"] =
        "corrupt";
    });
    await assert.rejects(
      verifyPackagedEngine(tarball, expected, cwd),
      /integrity mismatch/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
