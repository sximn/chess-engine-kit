# Engine and runtime notices

Frozenight by Mark Carlson is pinned at `f4d5a00725b2cd5f1c32910d57a84c77b66cc670`. Its code and repository-bundled `model.json.zst` are MIT OR Apache-2.0; this distribution elects MIT. The original notices are retained in `engine/frozenight/` and shipped with the binary. The TypeScript runtime and bridge use MIT. No source from CrispChess, Stockfish, or another considered provider is used.

`engine/frozenight/dependencies.json` lists the 23 locked Cargo dependencies, including build dependencies. Full license texts are shipped in `DEPENDENCY-NOTICES.txt`. Rust 1.90.0 standard-library notices and referenced license texts are shipped as `RUST-COPYRIGHT.html` and `licenses/`; this unmodified broad upstream notice includes unused components and other compilation targets.

The standalone worker bundles chess.js 1.4.0 under BSD-2-Clause. Its full notice ships as `CHESS-JS-LICENSE.txt`. The ESM client declares chess.js as its only npm runtime dependency.

Original generated chess fixtures are retained for verification. `tests/fixtures/tactical-corpus.json` is a frozen CC0 subset of the Lichess puzzle database (`https://database.lichess.org/#puzzles`), with provenance and sampling recorded in the file. Fixtures are not included in the npm artifact.
