import { spawnSync } from "node:child_process";
let r = spawnSync("bun", ["scripts/maintenance/engine/build-reference.ts"], {
  stdio: "inherit",
});
if (r.status !== 0) process.exit(r.status ?? 1);
r = spawnSync("bun", ["scripts/test.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ENGINE_TEST_REFERENCE:
      "engine/frozenight/target/release/frozenight-reference",
  },
});
process.exit(r.status ?? 1);
