import { Chess } from "chess.js";
import fs from "node:fs";
import crypto from "node:crypto";
let seed = 9022026;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}
const games = [],
  positions = [],
  seen = new Set();
for (let g = 0; g < 50; g++) {
  const chess = new Chess(),
    moves = [];
  for (let ply = 0; ply < 80 && !chess.isGameOver(); ply++) {
    const legal = chess.moves({ verbose: true });
    const chosen = legal[Math.floor(random() * legal.length)];
    chess.move(chosen.lan);
    moves.push(chosen.lan);
    if (!chess.isGameOver() && !seen.has(chess.fen())) {
      seen.add(chess.fen());
      positions.push({
        id: `self-${g}-${ply + 1}`,
        partition: g < 20 ? "development" : "held-out",
        rootFen: new Chess().fen(),
        movesUci: [...moves],
        fen: chess.fen(),
      });
    }
  }
  games.push({
    id: `self-${g}`,
    partition: g < 20 ? "development" : "held-out",
    pgn: chess.pgn(),
    plies: moves.length,
  });
}
const corpus = {
  version: 1,
  seed: 9022026,
  rights:
    "Original deterministic self-generated legal positions and games. No third-party game corpus.",
  purpose:
    "Port fidelity and legal edge cases; not an independently annotated tactical-quality corpus.",
  positions: [
    ...positions.filter((p) => p.partition === "development").slice(0, 250),
    ...positions.filter((p) => p.partition === "held-out").slice(0, 250),
  ],
  games,
};
const text = JSON.stringify(corpus, null, 2) + "\n";
fs.writeFileSync("tests/fixtures/engine-corpus.json", text);
console.log(crypto.createHash("sha256").update(text).digest("hex"));
