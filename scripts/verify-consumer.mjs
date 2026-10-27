import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const run = (command, args, cwd = process.cwd()) => {
  const r = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, npm_config_cache: path.resolve(".build/npm-cache") },
  });
  if (r.status !== 0) throw Error(command + " failed");
};
fs.mkdirSync(".build", { recursive: true });
run("npm", ["pack", "--ignore-scripts", "--pack-destination", ".build"]);
const tar = path.resolve(".build/upapawn-chess-engine-runtime-0.1.0.tgz");
const listing = spawnSync("tar", ["-tzf", tar], { encoding: "utf8" });
if (listing.status !== 0) throw Error("Cannot inspect packed artifact");
const files = listing.stdout.trim().split("\n");
if (
  files.some((f) =>
    /^package\/(src|engine|scripts|tests|node_modules)\//.test(f),
  )
)
  throw Error("Development source leaked into runtime package");
if (
  !files.some((f) => f.endsWith(".wasm")) ||
  !files.some((f) => /worker-.*\.js$/.test(f)) ||
  !files.includes("package/dist/types/index.d.ts")
)
  throw Error("Missing runtime assets or declarations");
fs.rmSync("examples/consumer/package-lock.json", { force: true });
fs.rmSync("examples/consumer/node_modules/@upapawn/chess-engine-runtime", {
  recursive: true,
  force: true,
});
run(
  "npm",
  ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
  path.resolve("examples/consumer"),
);
fs.rmSync("examples/consumer/public/engines/frozenight",{recursive:true,force:true});
run("npm", ["run", "build"], path.resolve("examples/consumer"));
const manifest = JSON.parse(
  fs.readFileSync(
    "examples/consumer/dist/engines/frozenight/manifest.json",
    "utf8",
  ),
);
fs.writeFileSync(
  "artifacts/consumer-build.json",
  JSON.stringify(
    {
      tarball: path.basename(tar),
      packedFiles: files,
      sourceIncluded: false,
      rustRequired: false,
      manifest,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Installed tarball and built a standalone Vite/TypeScript consumer without Rust or install scripts.",
);
