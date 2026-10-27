import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Chess } from "chess.js";
import { instantiateEngine } from "./helpers.ts";
import path from "node:path";
import { reportPath } from "../scripts/lib.ts";
import {
  validateResult,
  terminalResult,
  validateRequest,
  replay,
} from "./helpers.ts";
import type { AnalysisResult, RawResult, Position } from "../src/core/types.ts";
const manifest = JSON.parse(
  fs.readFileSync("assets/frozenight/engine-manifest.json", "utf8"),
);
const bytes = fs.readFileSync("assets/frozenight/" + manifest.wasmFile);
const compiled = await WebAssembly.compile(bytes);
const engine = await instantiateEngine(compiled, () => {});
const corpus = JSON.parse(
  fs.readFileSync("tests/fixtures/engine-corpus.json", "utf8"),
);
const root = new Chess().fen();
const request = (position: Position, multiPv = 1, depth = 3) => ({
  position,
  limits: { maxNodes: 1_000_000, maxDepth: depth },
  multiPv,
  hashMiB: 16,
});
const run = (fen = root, movesUci: string[] = [], multiPv = 1, depth = 3) =>
  engine.run(request({ rootFen: fen, movesUci }, multiPv, depth));
function legal(result: RawResult, position: Position, multiPv = 1) {
  assert.equal(result.error, undefined);
  validateResult(result, position, multiPv);
}
function perft(chess: Chess, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of chess.moves()) {
    chess.move(m);
    n += perft(chess, depth - 1);
    chess.undo();
  }
  return n;
}

test("scalar WASM has only explicit browser imports and no shared memory", () => {
  assert.deepEqual(
    WebAssembly.Module.imports(compiled)
      .map((i) => i.name)
      .sort(),
    ["emit_progress", "now_ms", "out_of_memory"],
  );
  assert.equal(
    engine.exports.memory.buffer instanceof SharedArrayBuffer,
    false,
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    manifest.wasmSha256,
  );
  assert.equal(
    JSON.parse(fs.readFileSync("tests/fixtures/native-golden.json", "utf8"))
      .engineBuild,
    manifest.buildHash,
  );
  assert.ok(manifest.rawBytes < 12 * 1024 * 1024);
});
test("100 move-generation positions match independent chess.js perft plus initial depth four", () => {
  assert.equal(
    (
      engine.run({
        ...request({ rootFen: root, movesUci: [] }, 1, 4),
        operation: "perft",
      }) as unknown as { nodes: number }
    ).nodes,
    197281,
  );
  for (const p of corpus.positions.slice(0, 100)) {
    const result = engine.run({ ...request(p, 1, 2), operation: "perft" });
    assert.equal(result.nodes, perft(new Chess(p.fen), 2), p.id);
  }
});
test("500 static evaluations and 200 deterministic searches match the portable native reference", () => {
  const inputs = [
    ...corpus.positions.map((p: Position) => ({
      ...request(p),
      operation: "eval",
    })),
    ...corpus.positions
      .slice(250, 450)
      .map((p: Position, i: number) => request(p, i % 4 === 0 ? 3 : 1, 3)),
  ];
  const native = process.env.ENGINE_TEST_REFERENCE
    ? spawnSync(process.env.ENGINE_TEST_REFERENCE, [], {
        input: inputs.map((i) => JSON.stringify(i)).join("\n") + "\n",
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 180000,
      })
    : {
        status: 0,
        stderr: "",
        stdout: JSON.parse(
          fs.readFileSync("tests/fixtures/native-golden.json", "utf8"),
        )
          .results.map((r: unknown) => JSON.stringify(r))
          .join("\n"),
      };
  assert.equal(native.status, 0, native.stderr);
  const expected = native.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const started = performance.now();
  let maxMemory = 0;
  inputs.forEach((input, index) => {
    const result = engine.run(input);
    assert.deepEqual(result, expected[index], `native/WASM drift ${index}`);
    if (index >= 500) legal(result, input.position, input.multiPv);
    maxMemory = Math.max(maxMemory, engine.exports.memory.buffer.byteLength);
  });
  fs.writeFileSync(
    reportPath(
      process.env.ENGINE_TEST_REFERENCE ? "native-parity.json" : "parity.json",
    ),
    JSON.stringify(
      {
        reference: process.env.ENGINE_TEST_REFERENCE
          ? "fresh-native"
          : "frozen-native-fixture",
        build: manifest.buildHash,
        network: manifest.networkHash,
        corpusSha256: createHash("sha256")
          .update(fs.readFileSync("tests/fixtures/engine-corpus.json"))
          .digest("hex"),
        staticPositions: 500,
        searchPositions: 200,
        searchDepth: 3,
        multiPvPositions: 50,
        unexplainedDifferences: 0,
        elapsedMs: performance.now() - started,
        maximumObservedLinearMemoryBytes: maxMemory,
        limitations:
          "Desktop deterministic fidelity test, not held-out tactical quality or phone performance.",
      },
      null,
      2,
    ),
  );
});
test("MultiPV has distinct legal root moves, exact tagged scores and legal PVs", () => {
  const p = { rootFen: root, movesUci: ["e2e4", "e7e5", "g1f3", "b8c6"] };
  const r = engine.run(request(p, 3, 4));
  legal(r, p, 3);
  assert.equal(r.lines.length, 3);
  assert.equal(new Set(r.lines.map((l) => l.rootMove)).size, 3);
  assert.ok(
    r.lines.every(
      (l) => l.score.bound === "exact" && l.score.perspective === "white",
    ),
  );
  assert.equal(r.reason, "depth");
  const restricted = engine.run({ ...request(p, 1, 3), rootMoves: ["f1b5"] });
  assert.equal(restricted.lines[0].rootMove, "f1b5");
  legal(restricted, p);
});
test("full history matters for repetition and a lone FEN is not complete history", () => {
  const moves = [
    "g1f3",
    "g8f6",
    "f3g1",
    "f6g8",
    "g1f3",
    "g8f6",
    "f3g1",
    "f6g8",
  ];
  assert.equal(run(root, moves).outcome, "repetition");
  const board = new Chess();
  moves.forEach((m) => board.move(m));
  assert.equal(run(board.fen()).outcome, undefined);
  assert.equal(
    terminalResult({ rootFen: root, movesUci: moves })?.outcome,
    "repetition",
  );
});
test("terminal mate, stalemate, fifty moves and insufficient material have no fabricated move", () => {
  for (const [fen, outcome] of [
    ["7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", "checkmate"],
    ["7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "stalemate"],
    ["7k/8/6K1/8/8/8/8/R7 w - - 100 1", "fifty-move"],
    ["7k/8/6K1/8/8/8/8/8 w - - 0 1", "insufficient-material"],
  ]) {
    const r = run(fen);
    assert.equal(r.outcome, outcome);
    assert.deepEqual(r.lines, []);
  }
});
test("mate distance is signed White-perspective plies, not centipawns", () => {
  const white = run("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1", [], 1, 3);
  assert.equal(white.lines[0].score.kind, "mate");
  assert.equal(white.lines[0].score.value, 1);
  const black = run("8/8/8/8/8/6k1/5q2/7K b - - 0 1", [], 1, 3);
  assert.equal(black.lines[0].score.value, -1);
});
test("castling, en passant and promotion roots are accepted and PVs replay legally", () => {
  for (const [fen, move] of [
    ["r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1"],
    ["7k/8/8/3pP3/8/8/8/6K1 w - d6 0 1", "e5d6"],
    ["7k/P7/6K1/8/8/8/8/8 w - - 0 1", "a7a8q"],
  ]) {
    const p = { rootFen: fen, movesUci: [] };
    const result = engine.run({ ...request(p), rootMoves: [move] });
    assert.equal(result.lines[0].rootMove, move);
    legal(result, p);
  }
});
test("limits retain only completed iterations and malformed input fails predictably", () => {
  const r = engine.run({
    ...request({ rootFen: root, movesUci: [] }, 3, 40),
    limits: { maxNodes: 1000, maxTimeMs: 100 },
  });
  assert.ok(["nodes", "time"].includes(r.reason!));
  assert.ok(r.nodes <= 1001);
  legal(r, { rootFen: root, movesUci: [] }, 3);
  assert.equal(run("not a FEN").error, "INVALID_POSITION");
  assert.equal(run(root, ["e2e5"]).error, "INVALID_POSITION");
  assert.throws(
    () =>
      validateRequest({
        apiVersion: 1,
        jobId: "x",
        positionId: "x",
        position: { rootFen: root, movesUci: [] },
        limits: { maxNodes: 1 },
        multiPv: 4,
      }),
    /limit/i,
  );
});
test("WASM memory exhaustion is a typed error and a fresh instance recovers", async () => {
  const isolated = await instantiateEngine(compiled, () => {});
  assert.throws(
    () => isolated.exports.engine_alloc(300 * 1024 * 1024),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "OUT_OF_MEMORY",
  );
  const recovered = await instantiateEngine(compiled, () => {});
  const result = recovered.run(request({ rootFen: root, movesUci: [] }, 1, 1));
  assert.ok(result.lines.length);
});

test("impossible check and castling FENs are rejected before invoking WASM", () => {
  for (const rootFen of [
    "8/8/8/8/8/8/4k3/4K3 w - - 0 1",
    "4k3/8/8/8/8/8/8/4K3 w K - 0 1",
    "4k3/8/8/8/8/8/8/4R1K1 w - - 0 1",
  ]) {
    assert.throws(() => replay({ rootFen, movesUci: [] }), /invalid/);
  }
});

test("independent CC0 tactical corpus has 100 frozen held-out legal solution sequences", () => {
  const tactical = JSON.parse(
    fs.readFileSync("tests/fixtures/tactical-corpus.json", "utf8"),
  );
  assert.equal(
    tactical.positions.filter(
      (p: { partition: string }) => p.partition === "held-out",
    ).length,
    100,
  );
  for (const p of tactical.positions)
    replay({ rootFen: p.rootFen, movesUci: [...p.movesUci, ...p.solution] });
});
