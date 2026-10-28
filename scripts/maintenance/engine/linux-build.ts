import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

function execute(args: string[]) {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw Error(
      "The canonical Linux x86_64 engine build failed. Start Docker or Colima with linux/amd64 support and retry. See docs/DEVELOPMENT.md#engine-changes.",
      { cause: result.error },
    );
  }
}

// Keep the host's native Rust outputs separate from the Linux compiler cache.
// Only engine sources and build caches enter the container; no registry tokens
// or other caller environment variables are forwarded.
export function buildInLinuxContainer(
  engineRoot: string,
  canonicalFlags: string[],
  invoke: (args: string[]) => void = execute,
): Buffer {
  const directory = import.meta.dir;
  const dockerfile = path.join(directory, "Dockerfile");
  const image =
    "chess-engine-kit-wasm:" +
    createHash("sha256")
      .update(fs.readFileSync(dockerfile))
      .digest("hex")
      .slice(0, 16);
  const cache = path.join(engineRoot, "target/linux-x64");
  const target = path.join(cache, "target");
  const cargo = path.join(cache, "cargo");
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(cargo, { recursive: true });
  const flags = canonicalFlags.map((flag) =>
    flag
      .replace("<engine-root>", "/engine/frozenight")
      .replace("<cargo-home>", "/cargo"),
  );
  invoke([
    "build",
    "--platform",
    "linux/amd64",
    "--file",
    dockerfile,
    "--tag",
    image,
    directory,
  ]);
  invoke([
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--user",
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "--volume",
    `${engineRoot}:/engine/frozenight:ro`,
    "--volume",
    `${target}:/engine/frozenight/target`,
    "--volume",
    `${cargo}:/cargo`,
    "--workdir",
    "/engine/frozenight",
    "--env",
    "CARGO_HOME=/cargo",
    "--env",
    "CARGO_TARGET_DIR=/engine/frozenight/target",
    "--env",
    "CARGO_INCREMENTAL=0",
    "--env",
    `CARGO_ENCODED_RUSTFLAGS=${flags.join("\x1f")}`,
    image,
    "cargo",
    "build",
    "--manifest-path",
    "/engine/frozenight/Cargo.toml",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "-p",
    "upapawn-engine",
    "--lib",
  ]);
  return fs.readFileSync(
    path.join(target, "wasm32-unknown-unknown/release/upapawn_engine.wasm"),
  );
}
