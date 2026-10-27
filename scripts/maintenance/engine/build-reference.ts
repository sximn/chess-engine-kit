import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.env.ENGINE_CARGO || "cargo",
  [
    "build",
    "--manifest-path",
    "engine/frozenight/Cargo.toml",
    "--locked",
    "--release",
    "-p",
    "upapawn-engine",
    "--bin",
    "frozenight-reference",
  ],
  { stdio: "inherit", env: { ...process.env, RUSTUP_TOOLCHAIN: "1.90.0" } },
);
process.exit(result.status ?? 1);
