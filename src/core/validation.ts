import { Chess, validateFen } from "chess.js";
import {
  API_VERSION,
  EngineError,
  type AnalyzeRequest,
  type Position,
  type EngineCapabilities,
  type RawResult,
} from "./types.js";

export function replay(position: Position) {
  try {
    if (
      !position ||
      typeof position.rootFen !== "string" ||
      position.rootFen.length > 128 ||
      !validateFen(position.rootFen).ok ||
      !Array.isArray(position.movesUci) ||
      position.movesUci.length > 2000
    )
      throw new Error();
    const game = new Chess(position.rootFen);
    // Syntactic FEN validation alone permits an impossible previous move.
    const inactive = game.turn() === "w" ? "b" : "w";
    if (
      game.isAttacked(
        game.findPiece({ type: "k", color: inactive })[0],
        game.turn(),
      )
    )
      throw new Error();
    const rights = position.rootFen.split(/\s+/)[2];
    for (const [flag, king, rook, color] of [
      ["K", "e1", "h1", "w"],
      ["Q", "e1", "a1", "w"],
      ["k", "e8", "h8", "b"],
      ["q", "e8", "a8", "b"],
    ] as const) {
      if (
        rights.includes(flag) &&
        (game.get(king)?.type !== "k" ||
          game.get(king)?.color !== color ||
          game.get(rook)?.type !== "r" ||
          game.get(rook)?.color !== color)
      )
        throw new Error();
    }
    for (const move of position.movesUci) {
      if (
        typeof move !== "string" ||
        !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)
      )
        throw new Error();
      game.move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        promotion: move[4],
      });
    }
    return game;
  } catch {
    throw new EngineError(
      "INVALID_POSITION",
      "The position or its move history is invalid.",
    );
  }
}
export function validateRequest(
  request: AnalyzeRequest,
  capabilities?: EngineCapabilities,
) {
  if (
    !request ||
    request.apiVersion !== API_VERSION ||
    typeof request.jobId !== "string" ||
    !request.jobId.length ||
    request.jobId.length > 128 ||
    typeof request.positionId !== "string" ||
    !request.positionId.length ||
    request.positionId.length > 128
  )
    throw new EngineError(
      "INVALID_OPTIONS",
      "Invalid analysis request identity.",
    );
  const limits = request.limits;
  if (
    !limits ||
    !Number.isInteger(request.multiPv) ||
    request.multiPv < 1 ||
    request.multiPv > (capabilities?.maxMultiPv ?? 256)
  )
    throw new EngineError("INVALID_OPTIONS", "Invalid MultiPV or limits.");
  const fields = [
    ["maxNodes", "nodes"],
    ["maxTimeMs", "timeMs"],
    ["maxDepth", "depth"],
  ] as const;
  if (Object.keys(limits).some((key) => !fields.some(([name]) => name === key)))
    throw new EngineError("INVALID_OPTIONS", "Unknown search limit.");
  let supplied = 0;
  for (const [name, capability] of fields) {
    const value = limits[name];
    if (value === undefined) continue;
    supplied++;
    const range = capabilities?.limits[capability];
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      (capabilities && !range) ||
      (range && (value < range.min || value > range.max))
    )
      throw new EngineError(
        "INVALID_OPTIONS",
        `Unsupported search limit: ${name}.`,
      );
  }
  if (!supplied)
    throw new EngineError(
      "INVALID_OPTIONS",
      "At least one search limit is required.",
    );
  if (
    capabilities?.history === "fen-only" &&
    request.position?.movesUci?.length
  )
    throw new EngineError(
      "INVALID_OPTIONS",
      "This provider cannot preserve supplied history.",
    );
  if (
    request.rootMoves !== undefined &&
    capabilities &&
    !capabilities.rootMoves
  )
    throw new EngineError(
      "INVALID_OPTIONS",
      "Root-move restriction is unsupported.",
    );
  const game = replay(request.position);
  if (
    request.rootMoves !== undefined &&
    (!Array.isArray(request.rootMoves) ||
      request.rootMoves.length === 0 ||
      request.rootMoves.length > 256 ||
      request.rootMoves.some(
        (move) => !game.moves({ verbose: true }).some((m) => m.lan === move),
      ))
  )
    throw new EngineError(
      "INVALID_OPTIONS",
      "The requested root move is not legal.",
    );
  return game;
}
export function validateResult(
  result: RawResult,
  position: Position,
  multiPv: number,
  rootMoves?: string[],
) {
  if (
    !result ||
    !Array.isArray(result.lines) ||
    result.lines.length > multiPv ||
    (result.depth !== null &&
      (!Number.isInteger(result.depth) || result.depth < 0)) ||
    (result.nodes !== null &&
      (!Number.isSafeInteger(result.nodes) || result.nodes < 0)) ||
    (result.iterationNodes !== undefined &&
      result.iterationNodes !== null &&
      (!Number.isSafeInteger(result.iterationNodes) ||
        result.iterationNodes < 0 ||
        (result.nodes !== null && result.iterationNodes > result.nodes))) ||
    typeof result.completedIteration !== "boolean"
  )
    throw new EngineError(
      "ENGINE_CRASHED",
      "The engine returned an invalid result.",
      true,
    );
  const roots = new Set<string>();
  const root = replay(position);
  result.lines.forEach((line, index) => {
    if (
      line.rank !== index + 1 ||
      roots.has(line.rootMove) ||
      line.rootMove !== line.pv?.[0] ||
      (rootMoves && !rootMoves.includes(line.rootMove)) ||
      line.pv.length > 256 ||
      !line.score ||
      line.score.perspective !== "white" ||
      !["cp", "mate"].includes(line.score.kind) ||
      !["exact", "lower", "upper"].includes(line.score.bound) ||
      !Number.isInteger(line.score.value) ||
      (line.score.kind === "mate" && line.score.unit !== "plies")
    )
      throw new EngineError(
        "ENGINE_CRASHED",
        "The engine returned an invalid line.",
        true,
      );
    roots.add(line.rootMove);
    const game = new Chess(root.fen());
    try {
      for (const move of line.pv) {
        if (
          typeof move !== "string" ||
          !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)
        )
          throw new Error();
        game.move({
          from: move.slice(0, 2),
          to: move.slice(2, 4),
          promotion: move[4],
        });
      }
    } catch {
      throw new EngineError(
        "ENGINE_CRASHED",
        "The engine returned an illegal continuation.",
        true,
      );
    }
  });
  if (result.outcome) {
    const expected = terminalResult(position);
    if (
      result.lines.length ||
      !expected ||
      expected.outcome !== result.outcome ||
      expected.winner !== result.winner ||
      expected.terminalScore?.kind !== result.terminalScore?.kind ||
      expected.terminalScore?.value !== result.terminalScore?.value ||
      result.terminalScore?.perspective !== "white" ||
      result.terminalScore?.bound !== "exact"
    )
      throw new EngineError("ENGINE_CRASHED", "Invalid terminal result.", true);
  }
}
export function terminalResult(position: Position): RawResult | null {
  const game = replay(position);
  let outcome: RawResult["outcome"];
  if (game.isCheckmate()) outcome = "checkmate";
  else if (game.isStalemate()) outcome = "stalemate";
  else if (game.isThreefoldRepetition()) outcome = "repetition";
  else if (game.isDrawByFiftyMoves()) outcome = "fifty-move";
  else if (game.isInsufficientMaterial()) outcome = "insufficient-material";
  if (!outcome) return null;
  return {
    lines: [],
    depth: 0,
    nodes: 0,
    iterationNodes: 0,
    completedIteration: true,
    reason: "terminal",
    outcome,
    winner:
      outcome === "checkmate"
        ? game.turn() === "w"
          ? "black"
          : "white"
        : null,
    terminalScore:
      outcome === "checkmate"
        ? {
            perspective: "white",
            kind: "mate",
            value: 0,
            bound: "exact",
            unit: "plies",
          }
        : { perspective: "white", kind: "cp", value: 0, bound: "exact" },
  };
}
