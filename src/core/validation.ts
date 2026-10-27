import { Chess, validateFen } from "chess.js";
import {
  API_VERSION,
  EngineError,
  type AnalyzeRequest,
  type Position,
  type EngineCapabilities,
  type RawResult,
  type Score,
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
  phase: "progress" | "completed" = "completed",
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
    typeof result.completedIteration !== "boolean" ||
    result.error !== undefined ||
    (result.reason !== undefined &&
      !["time", "nodes", "depth", "terminal"].includes(result.reason)) ||
    (phase === "completed" && result.reason === undefined) ||
    (!result.completedIteration && result.lines.length > 0) ||
    (result.reason === "depth" && !result.completedIteration)
  )
    throw new EngineError(
      "ENGINE_CRASHED",
      "The engine returned an invalid result.",
      true,
    );
  const roots = new Set<string>();
  const root = replay(position);
  const expected = terminalResultFromGame(root);
  if (
    result.reason === "terminal" ||
    result.outcome !== undefined ||
    result.winner !== undefined ||
    result.terminalScore !== undefined ||
    expected
  ) {
    const score = result.terminalScore;
    if (
      phase !== "completed" ||
      result.reason !== "terminal" ||
      !result.completedIteration ||
      result.lines.length ||
      !expected ||
      expected.outcome !== result.outcome ||
      expected.winner !== result.winner ||
      !validScore(score) ||
      score.kind !== expected.terminalScore!.kind ||
      score.value !== expected.terminalScore!.value ||
      score.bound !== "exact"
    ) {
      throw new EngineError("ENGINE_CRASHED", "Invalid terminal result.", true);
    }
  } else if (result.completedIteration && result.lines.length === 0) {
    throw new EngineError(
      "ENGINE_CRASHED",
      "A complete iteration must contain a line.",
      true,
    );
  }
  result.lines.forEach((line, index) => {
    if (
      !line ||
      line.rank !== index + 1 ||
      typeof line.rootMove !== "string" ||
      !Array.isArray(line.pv) ||
      roots.has(line.rootMove) ||
      line.rootMove !== line.pv?.[0] ||
      (rootMoves && !rootMoves.includes(line.rootMove)) ||
      line.pv.length > 256 ||
      !validScore(line.score) ||
      (line.score.kind === "mate" && line.score.value === 0)
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
}
function validScore(score: Score | undefined): score is Score {
  return (
    !!score &&
    score.perspective === "white" &&
    ["cp", "mate"].includes(score.kind) &&
    ["exact", "lower", "upper"].includes(score.bound) &&
    Number.isSafeInteger(score.value) &&
    (score.kind !== "mate" || score.unit === "plies")
  );
}
export function terminalResult(position: Position): RawResult | null {
  return terminalResultFromGame(replay(position));
}
function terminalResultFromGame(game: Chess): RawResult | null {
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
