import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isDeepStrictEqual } from "node:util";
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
        `Committed engine assets differ from the source rebuild: ${name}. Run bun run engine:build and bun run engine:notices, review and commit the assets, then verify again.`,
      );
    }
  }
}

if (import.meta.main) {
  const report = reportPath("engine-verification.json");
  fs.rmSync(report, { force: true });
  const fingerprint = releaseFingerprint();
  const commit = releaseCommit();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chess-engine-rebuild-"));
  try {
    fs.cpSync(path.join(root, "engine"), path.join(temp, "engine"), {
      recursive: true,
      filter: (file) => path.basename(file) !== "target",
    });
    fs.symlinkSync(
      path.join(root, "node_modules"),
      path.join(temp, "node_modules"),
      "dir",
    );
    for (const name of ["build-engine.ts", "engine-notices.ts"]) {
      const destination = path.join(temp, "scripts/maintenance/engine", name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(
        path.join(root, "scripts/maintenance/engine", name),
        destination,
      );
      run("bun", [destination], { cwd: temp });
    }
    compareEngineArtifacts(
      path.join(root, "assets/frozenight"),
      path.join(temp, "assets/frozenight"),
    );
    if (
      !fs
        .readFileSync(path.join(root, "engine/frozenight/dependencies.json"))
        .equals(
          fs.readFileSync(
            path.join(temp, "engine/frozenight/dependencies.json"),
          ),
        )
    ) {
      throw Error(
        "Committed engine dependencies.json is stale. Run bun run engine:notices, review and commit it.",
      );
    }
    if (fingerprint !== releaseFingerprint() || commit !== releaseCommit())
      throw Error(
        "Release inputs changed during engine verification; run it again.",
      );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, "assets/frozenight/engine-manifest.json"),
        "utf8",
      ),
    );
    fs.writeFileSync(
      report,
      JSON.stringify(
        {
          schemaVersion: 1,
          commit,
          fingerprint,
          wasmSha256: manifest.wasmSha256,
          buildHash: manifest.buildHash,
          committedAssetsMatch: true,
          noticesMatch: true,
          manifestIdentityMatch: true,
          diagnosticFieldsIgnored: ["gzipBytes", "brotliBytes"],
          independentCheckout: true,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "Independent source rebuild matches the committed WASM, manifest, dependencies and license notices. Checkout assets were not modified.",
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
