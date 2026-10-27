import fs from "node:fs";
import { spawnSync } from "node:child_process";
const sdk = spawnSync("bun", ["scripts/build-package.ts"], {
  stdio: "inherit",
});
if (sdk.status !== 0) process.exit(sdk.status ?? 1);
// Explicit files keep Playwright specs out of the unit/engine test runner.
const files = fs
  .readdirSync("tests")
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => "./tests/" + name);
const tested = spawnSync("bun", ["test", "--timeout", "180000", ...files], {
  stdio: "inherit",
  env: process.env,
});
process.exit(tested.status ?? 1);
