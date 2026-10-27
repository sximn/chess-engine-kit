import fs from "node:fs";
import path from "node:path";
import { root, readPackage, run, reportPath } from "./lib.mjs";

const original = readPackage();
const directory = path.join(root, ".build/version-rehearsal");
fs.rmSync(directory, { recursive: true, force: true });
fs.mkdirSync(directory, { recursive: true });
for (const name of [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "tsconfig.build.json",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "src",
  "bin",
  "scripts",
  "docs",
  "examples",
  "assets",
]) {
  fs.cpSync(path.join(root, name), path.join(directory, name), {
    recursive: true,
    filter: (file) =>
      ![
        "node_modules",
        "dist",
        "public",
        "ios",
        "android",
        "capacitor",
      ].includes(path.basename(file)),
  });
}
fs.symlinkSync(
  path.join(root, "node_modules"),
  path.join(directory, "node_modules"),
  "dir",
);
run("npm", ["run", "version:patch"], { cwd: directory });
const bumped = JSON.parse(
  fs.readFileSync(path.join(directory, "package.json"), "utf8"),
);
if (bumped.version === original.version)
  throw Error("Version bump did not change the version");
run(process.execPath, ["scripts/verify-consumer.mjs"], {
  cwd: directory,
  env: { npm_config_cache: path.join(root, ".build/npm-cache") },
});
const report = JSON.parse(
  fs.readFileSync(
    path.join(directory, ".build/reports/consumer-build.json"),
    "utf8",
  ),
);
if (
  report.version !== bumped.version ||
  readPackage().version !== original.version
)
  throw Error("Version rehearsal did not stay isolated");
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(directory, "dist/assets/frozenight/manifest.json"),
    "utf8",
  ),
);
if (
  manifest.packageVersion !== bumped.version ||
  !manifest.descriptor.engineVersion.startsWith(bumped.version + "+")
)
  throw Error("Engine metadata did not follow the bumped package version");
fs.writeFileSync(
  reportPath("versioning.json"),
  JSON.stringify(
    {
      sourceVersion: original.version,
      rehearsedVersion: bumped.version,
      installedVersion: report.version,
      examples: report.examples,
      sourceUnchanged: true,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Version rehearsal passed: ${original.version} -> ${bumped.version}; source version unchanged.`,
);
