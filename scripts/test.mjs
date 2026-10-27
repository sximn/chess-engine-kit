import fs from "node:fs";
import { spawnSync } from "node:child_process";
fs.mkdirSync(".build", { recursive: true });
const sdk = spawnSync(process.execPath, ["scripts/build-package.mjs"], {
  stdio: "inherit",
});
if (sdk.status !== 0) process.exit(sdk.status ?? 1);
const built = spawnSync(
  "bun",
  [
    "build",
    "tests/helpers.ts",
    "--target",
    "node",
    "--format",
    "esm",
    "--external",
    "chess.js",
    "--outfile",
    ".build/test-helpers.js",
  ],
  { stdio: "inherit" },
);
if (built.status !== 0) process.exit(built.status ?? 1);
const files = fs
  .readdirSync("tests")
  .filter((n) => n.endsWith(".test.ts"))
  .map((n) => "tests/" + n);
const tested = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", ...files],
  { stdio: "inherit", env: process.env },
);
process.exit(tested.status ?? 1);
