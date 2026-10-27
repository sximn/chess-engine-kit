// Explicitly regenerate reference data after reviewing an engine change; normal tests never bless it.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Position } from "../../../src/core/types.ts";
const corpus = JSON.parse(
  fs.readFileSync("tests/fixtures/engine-corpus.json", "utf8"),
) as { positions: Position[] };
const manifest = JSON.parse(
  fs.readFileSync("assets/frozenight/engine-manifest.json", "utf8"),
);
const request = (position: Position, multiPv = 1) => ({
  position,
  limits: { maxNodes: 1000000, maxDepth: 3 },
  multiPv,
  hashMiB: 16,
});
const inputs = [
  ...corpus.positions.map((p) => ({ ...request(p), operation: "eval" })),
  ...corpus.positions
    .slice(250, 450)
    .map((p, i) => request(p, i % 4 === 0 ? 3 : 1)),
];
const binary =
  process.env.ENGINE_TEST_REFERENCE ||
  "engine/frozenight/target/release/frozenight-reference";
const result = spawnSync(binary, [], {
  input: inputs.map((r) => JSON.stringify(r)).join("\n") + "\n",
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (result.status !== 0) throw Error(result.stderr);
fs.writeFileSync(
  "tests/fixtures/native-golden.json",
  JSON.stringify(
    {
      engineBuild: manifest.buildHash,
      modelHash: manifest.networkHash,
      sourceRevision: manifest.upstreamCommit,
      nativeBinarySha256: createHash("sha256")
        .update(fs.readFileSync(binary))
        .digest("hex"),
      results: result.stdout
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l)),
    },
    null,
    2,
  ) + "\n",
);
