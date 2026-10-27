import fs from "node:fs";
import path from "node:path";
import {
  root,
  run,
  packPackage,
  applications,
  installApplication,
  reportPath,
} from "../lib.ts";

run("bun", ["scripts/build-package.ts"]);
const packed = await packPackage();

if (
  packed.files.some((file) =>
    /^(src|engine|scripts|tests|node_modules|artifacts|\.build)\//.test(file),
  )
) {
  throw Error("Development files leaked into the runtime package");
}

for (const required of [
  "dist/index.js",
  "dist/types/index.d.ts",
  "dist/bin/copy-assets.js",
  "docs/API.md",
  "docs/PUBLISHING.md",
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

  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(directory, "dist/engines/frozenight/manifest.json"),
      "utf8",
    ),
  );

  if (manifest.packageVersion !== packed.version) {
    throw Error("Deployed assets do not match the release version");
  }
}

fs.writeFileSync(
  reportPath("package-build.json"),
  JSON.stringify(
    {
      ...packed,
      file: path.relative(root, packed.file),
      applications: Object.keys(applications),
      packageManagers: { "browser-app": "bun", minimal: "npm" },
      installScripts: false,
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `Verified ${packed.name}@${packed.version} in the Bun browser app and npm minimal example. Tarball: ${path.relative(root, packed.file)}`,
);
