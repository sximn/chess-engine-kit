import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run } from "../lib.ts";

// Reuse the exact installed tarball and pinned consumer tooling. These builds
// check deployment output, since JS tree shaking alone cannot detect leaked assets.
export function verifyEntrypoints(
  directory: string,
  bundler: "vite" | "webpack",
) {
  const probe = path.join(directory, "entrypoint-checks");
  fs.mkdirSync(probe, { recursive: true });
  fs.writeFileSync(
    path.join(probe, "index.html"),
    '<!doctype html><script type="module" src="./main.js"></script>',
  );
  fs.writeFileSync(path.join(probe, "vite.config.js"), "export default {};\n");
  fs.writeFileSync(
    path.join(probe, "webpack.config.js"),
    `export default {
      entry: ${JSON.stringify(path.join(probe, "main.js"))},
      output: { path: ${JSON.stringify(path.join(probe, "dist"))}, clean: true },
    };\n`,
  );

  const cases = {
    root: 'import { API_VERSION } from "chess-engine-kit"; console.log(API_VERSION);',
    core: 'import { API_VERSION, createWorkerEngine } from "chess-engine-kit/core"; window.sdk = { API_VERSION, createWorkerEngine };',
    manual:
      'import { createFrozenight } from "chess-engine-kit/frozenight/manual"; window.engine = createFrozenight({ assetUrls: { wasm: "/custom.wasm", worker: "/custom.js" } });',
    folder:
      'import { createFrozenight } from "chess-engine-kit/frozenight/manual"; window.engine = createFrozenight({ assetBaseUrl: "/custom/" });',
  };
  for (const [name, source] of Object.entries(cases)) {
    fs.writeFileSync(path.join(probe, "main.js"), source + "\n");
    if (bundler === "vite")
      run(
        "bun",
        ["x", "--no-install", "vite", "build", "--config", "vite.config.js"],
        {
          cwd: probe,
        },
      );
    else
      run(
        "bun",
        [
          "x",
          "--no-install",
          "webpack",
          "--mode",
          "production",
          "--config",
          "webpack.config.js",
        ],
        {
          cwd: probe,
        },
      );
    const files = fs
      .readdirSync(path.join(probe, "dist"), {
        recursive: true,
        withFileTypes: true,
      })
      .filter((file) => file.isFile());
    assert.equal(
      files.filter((file) => file.name.endsWith(".js")).length,
      1,
      `${bundler}/${name} must emit only its application JS, without a worker`,
    );
    for (const file of files)
      assert.match(
        file.name,
        /\.(?:js|html|map|LICENSE\.txt)$/,
        `${bundler}/${name} emitted an unwanted asset: ${file.name}`,
      );
  }
}
