import fs from "node:fs";
import path from "node:path";
import { ensureEngine } from "../maintenance/engine/engine-cache.ts";
import { verifyPackagedEngine } from "../release/engine-artifact.ts";
import { verifyEntrypoints } from "./verify-entrypoints.ts";
import type { EngineAssetManifest } from "../../src/core/types.ts";
import {
  root,
  run,
  packPackage,
  applications,
  installApplication,
  reportPath,
  sha256,
} from "../lib.ts";

run("bun", ["scripts/build-package.ts"]);
const packed = await packPackage();
const engine = ensureEngine();
await verifyPackagedEngine(packed.file, {
  inputKey: engine.key,
  files: engine.files,
});

if (
  packed.files.some((file) =>
    /^(src|engine|scripts|tests|examples|node_modules|artifacts|\.build)\//.test(
      file,
    ),
  )
) {
  throw Error("Development files leaked into the runtime package");
}

for (const required of [
  "dist/index.js",
  "dist/types/index.d.ts",
  "dist/core.js",
  "dist/types/core.d.ts",
  "dist/frozenight.js",
  "dist/types/frozenight.d.ts",
  "dist/frozenight-manual.js",
  "dist/types/frozenight-manual.d.ts",
  "dist/bin/copy-assets.js",
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "dist/assets/frozenight/LICENSE-MIT.txt",
  "dist/assets/frozenight/LICENSE-APACHE.txt",
  "dist/assets/frozenight/THIRD-PARTY-NOTICES.txt",
  "docs/API.md",
  "docs/PROVENANCE.md",
]) {
  if (!packed.files.includes(required)) {
    throw Error(`Missing packaged file: ${required}`);
  }
}

if (
  !packed.files.some((file) => file.endsWith(".wasm")) ||
  !packed.files.some((file) => /worker-.*\.js$/.test(file))
) {
  throw Error("Missing runtime assets");
}

// Relative Markdown links must resolve within the published artifact, not just the checkout.
for (const file of packed.files.filter((file) => file.endsWith(".md"))) {
  const markdown = fs.readFileSync(path.join(root, file), "utf8");

  for (const [, target] of markdown.matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) {
      continue;
    }

    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(file), target.split("#")[0]),
    );

    if (!packed.files.includes(resolved)) {
      throw Error(`Broken packaged documentation link: ${file} -> ${target}`);
    }
  }
}

for (const name of Object.keys(applications)) {
  const directory = await installApplication(name, packed.file);

  run(name === "minimal" ? "npm" : "bun", ["run", "build"], { cwd: directory });

  if (fs.existsSync(path.join(directory, "public"))) {
    throw Error("Consumer builds must not create an engine folder in public");
  }
  const manifest: EngineAssetManifest = JSON.parse(
    fs.readFileSync(
      path.join(root, "dist/assets/frozenight/manifest.json"),
      "utf8",
    ),
  );
  const emitted = new Set<string>();
  function inspect(folder: string) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) inspect(file);
      else emitted.add(sha256(fs.readFileSync(file)));
    }
  }
  inspect(path.join(directory, "dist"));
  // Consumer bundlers may minify the worker. WASM and legal notices must retain
  // their exact bytes; browser tests verify that the emitted worker executes.
  for (const asset of [manifest.wasm, ...manifest.notices]) {
    if (!emitted.has(asset.sha256))
      throw Error(
        `Bundler omitted or modified packaged asset: ${name}/${asset.file}`,
      );
  }
  if (name === "browser-app") {
    verifyEntrypoints(directory, "vite");
    // Exercise the optional manual-folder path against the packaged Node CLI.
    run("node", [
      path.join(
        directory,
        "node_modules",
        packed.name,
        "dist/bin/copy-assets.js",
      ),
      "--to",
      path.join(directory, "dist/manual-engine"),
    ]);
  }
  if (name === "webpack-app") verifyEntrypoints(directory, "webpack");
}

fs.writeFileSync(
  reportPath("package-build.json"),
  JSON.stringify(
    {
      ...packed,
      file: path.relative(root, packed.file),
      applications: Object.keys(applications),
      packageManagers: {
        "browser-app": "bun",
        minimal: "npm",
        "webpack-app": "bun",
      },
      installScripts: false,
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `Verified ${packed.name}@${packed.version} in Vite and webpack consumers with Bun and npm. Tarball: ${path.relative(root, packed.file)}`,
);
