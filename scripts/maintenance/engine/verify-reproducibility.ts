import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { reportPath } from "../../lib.ts";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chess-engine-rebuild-"));
fs.cpSync("engine", temp + "/engine", {
  recursive: true,
  filter: (p) => path.basename(p) !== "target",
});
const builder = "scripts/maintenance/engine/build-engine.ts";
fs.mkdirSync(path.dirname(path.join(temp, builder)), { recursive: true });
fs.copyFileSync(builder, path.join(temp, builder));
fs.mkdirSync(temp + "/src/adapters/frozenight", { recursive: true });
fs.mkdirSync(temp + "/assets/frozenight", { recursive: true });
const r = spawnSync("bun", [builder], {
  cwd: temp,
  stdio: "inherit",
  env: process.env,
});
if (r.status !== 0) throw Error("Independent rebuild failed");
const source = JSON.parse(
    fs.readFileSync("assets/frozenight/engine-manifest.json", "utf8"),
  ),
  copy = JSON.parse(
    fs.readFileSync(temp + "/assets/frozenight/engine-manifest.json", "utf8"),
  );
if (
  source.wasmSha256 !== copy.wasmSha256 ||
  source.buildHash !== copy.buildHash
)
  throw Error("Rebuild drift across checkout paths");
fs.writeFileSync(
  reportPath("reproducibility.json"),
  JSON.stringify(
    {
      buildHash: source.buildHash,
      wasmSha256: source.wasmSha256,
      independentCheckout: true,
      independentTargetDirectory: true,
      pathRemapping: true,
      identical: true,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Independent source and target directories produced identical WASM bytes.",
);
