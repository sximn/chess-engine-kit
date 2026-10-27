import { spawnSync } from "node:child_process";
let r = spawnSync(process.execPath, ["scripts/build-reference.mjs"], {
  stdio: "inherit",
});
if (r.status !== 0) process.exit(r.status ?? 1);
r = spawnSync(process.execPath, ["scripts/test.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ENGINE_TEST_REFERENCE:
      "engine/frozenight/target/release/frozenight-reference",
  },
});
process.exit(r.status ?? 1);
