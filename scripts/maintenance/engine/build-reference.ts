import { spawnSync } from "node:child_process";
import path from "node:path";
import { rustEnvironment } from "./rust-environment.ts";
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
    env: rustEnvironment(path.resolve("engine/frozenight")),
  },
);
process.exit(result.status ?? 1);
