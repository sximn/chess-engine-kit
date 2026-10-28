import { spawnSync } from "node:child_process";
import path from "node:path";
const cargo = process.env.ENGINE_CARGO || "cargo";
const result = spawnSync(
  cargo,
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
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RUSTUP_TOOLCHAIN: "1.90.0",
      RUSTC: process.env.ENGINE_CARGO
        ? path.join(path.dirname(cargo), "rustc")
        : process.env.RUSTC || "rustc",
    },
  },
);
process.exit(result.status ?? 1);
