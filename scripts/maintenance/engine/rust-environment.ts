import path from "node:path";
import { rustVersion } from "./engine-inputs.ts";

// Compiler/model overrides are not engine inputs. Keep host caches and network
// configuration, but take build settings from the reviewed recipe and sources.
export function rustEnvironment(
  engineRoot: string,
  inherited = process.env,
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  for (const name of Object.keys(env))
    if (
      /^CARGO_(PROFILE|BUILD|TARGET)_/.test(name) ||
      [
        "RUSTC",
        "RUSTC_WRAPPER",
        "RUSTC_WORKSPACE_WRAPPER",
        "RUSTFLAGS",
        "CARGO_ENCODED_RUSTFLAGS",
      ].includes(name)
    )
      delete env[name];
  return {
    ...env,
    EVALFILE: path.resolve(engineRoot, "core/model.json.zst"),
    RUSTUP_TOOLCHAIN: rustVersion,
    RUSTC: inherited.ENGINE_CARGO
      ? path.resolve(path.dirname(inherited.ENGINE_CARGO), "rustc")
      : "rustc",
    CARGO_INCREMENTAL: "0",
    CARGO_TARGET_DIR: path.resolve(engineRoot, "target"),
  };
}
