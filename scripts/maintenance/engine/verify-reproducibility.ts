import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ensureEngine } from "./engine-cache.ts";
import {
  engineInputKey,
  inventory,
  licenseFiles,
  validateEngine,
} from "./engine-inputs.ts";
import { extractPackagedEngine } from "../../release/engine-artifact.ts";
import {
  root,
  run,
  reportPath,
  releaseFingerprint,
  releaseCommit,
} from "../../lib.ts";

// Compressed-size estimates are diagnostics, not distributed compressed bytes.
// Node and Bun's zlib implementations can produce different estimates for the
// same WASM. Every identity field, the raw WASM and all notices must still match.
function manifestIdentity(bytes: Buffer) {
  const {
    gzipBytes: _gzip,
    brotliBytes: _brotli,
    ...identity
  } = JSON.parse(bytes.toString());
  return identity;
}

// Compare the complete asset tree, including notices and extra/missing files.
export function compareEngineArtifacts(expected: string, rebuilt: string) {
  function files(directory: string, prefix = ""): Map<string, Buffer> {
    const result = new Map<string, Buffer>();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) {
        for (const [name, bytes] of files(
          path.join(directory, entry.name),
          relative + "/",
        ))
          result.set(name, bytes);
      } else if (entry.isFile())
        result.set(relative, fs.readFileSync(path.join(directory, entry.name)));
      else throw Error(`Unexpected engine asset type: ${relative}`);
    }
    return result;
  }
  const original = files(expected),
    copy = files(rebuilt);
  for (const name of new Set([...original.keys(), ...copy.keys()])) {
    if (
      name === "engine-manifest.json" &&
      original.has(name) &&
      copy.has(name) &&
      isDeepStrictEqual(
        manifestIdentity(original.get(name)!),
        manifestIdentity(copy.get(name)!),
      )
    )
      continue;
    if (
      !original.get(name)?.equals(copy.get(name) ?? Buffer.alloc(0)) ||
      !copy.has(name)
    ) {
      throw Error(
        `Generated engine builds differ: ${name}. Inspect the pinned toolchain, build inputs and diagnostics before preparing a release.`,
      );
    }
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--package"))
    throw Error("Use engine:verify [--package <tested-tarball>].");
  run("bun", ["scripts/maintenance/engine/engine-notices.ts", "--check"]);
  const report = reportPath("engine-verification.json");
  fs.rmSync(report, { force: true });
  const fingerprint = releaseFingerprint();
  const commit = releaseCommit();
  const key = engineInputKey();
  const temp = fs.mkdtempSync(path.join(root, ".build/engine-rebuild-"));
  try {
    const cached = args.length ? null : ensureEngine();
    const baseline =
      cached?.absoluteDirectory ?? path.join(temp, "package-engine");
    if (args.length)
      await extractPackagedEngine(path.resolve(args[1]), baseline);
    const manifest = validateEngine(baseline, key);
    const files = inventory(baseline);
    fs.cpSync(path.join(root, "engine"), path.join(temp, "engine"), {
      recursive: true,
      filter: (file) => path.basename(file) !== "target",
    });
    fs.cpSync(
      path.join(root, "scripts/maintenance/engine"),
      path.join(temp, "scripts/maintenance/engine"),
      { recursive: true },
    );
    fs.copyFileSync(
      path.join(root, "package.json"),
      path.join(temp, "package.json"),
    );
    fs.symlinkSync(
      path.join(root, "node_modules"),
      path.join(temp, "node_modules"),
      "dir",
    );
    fs.mkdirSync(path.join(temp, "assets/frozenight"), { recursive: true });
    for (const name of licenseFiles)
      fs.copyFileSync(
        path.join(root, "assets/frozenight", name),
        path.join(temp, "assets/frozenight", name),
      );
    const rebuilt = path.join(temp, "rebuilt-engine");
    run(
      "bun",
      [
        path.join(temp, "scripts/maintenance/engine/compile-engine.ts"),
        "--output",
        rebuilt,
      ],
      { cwd: temp },
    );
    run(
      "bun",
      [
        path.join(temp, "scripts/maintenance/engine/engine-notices.ts"),
        "--output",
        rebuilt,
      ],
      { cwd: temp },
    );
    compareEngineArtifacts(baseline, rebuilt);
    if (
      fingerprint !== releaseFingerprint() ||
      commit !== releaseCommit() ||
      key !== engineInputKey() ||
      !isDeepStrictEqual(files, inventory(baseline))
    )
      throw Error(
        "Source inputs or the baseline engine changed during verification. Run it again.",
      );
    fs.writeFileSync(
      report,
      JSON.stringify(
        {
          schemaVersion: 2,
          commit,
          fingerprint,
          inputKey: key,
          files,
          wasmSha256: manifest.wasmSha256,
          buildHash: manifest.buildHash,
          reproducible: true,
          noticesMatch: true,
          independentCheckout: true,
          diagnosticFieldsIgnored: ["gzipBytes", "brotliBytes"],
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "Independent source builds produce identical WASM and reviewed notices. No generated assets were read from Git or written to source directories.",
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
