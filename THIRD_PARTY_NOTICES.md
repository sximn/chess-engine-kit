# Engine and runtime notices

Frozenight by Mark Carlson is pinned at `f4d5a00725b2cd5f1c32910d57a84c77b66cc670`. Its code and repository-bundled `model.json.zst` are MIT OR Apache-2.0; this distribution elects MIT. The original notices are retained in `engine/frozenight/` and shipped with the binary. The TypeScript runtime and bridge use MIT. No source from CrispChess, Stockfish, or another considered provider is used.

The asset folder ships three tracked notice files: Frozenight's original `LICENSE-MIT.txt` and `LICENSE-APACHE.txt`, plus `THIRD-PARTY-NOTICES.txt` for chess.js, Cargo dependencies and the Rust standard library. Keep these files with the worker and WASM when redistributing or deploying the assets; the asset-copy CLI includes them automatically.

`engine/frozenight/dependencies.json` lists the 23 locked Cargo dependencies, including build dependencies. Their notices and Rust 1.90.0's standard-library notices are consolidated as plain text in `THIRD-PARTY-NOTICES.txt`. Component entries reference complete license/notice texts, with matching texts printed once after normalizing whitespace. Copyright statements and license wording are retained. The Rust inventory still includes unused components and other compilation targets; it is not a list of code present in this WASM. Only the standalone Rust license texts referenced by its in-tree inventory are included, together with the notices embedded in the upstream HTML.

The standalone worker bundles chess.js 1.4.0 under BSD-2-Clause; its full notice is included in the same consolidated file. The ESM client declares chess.js as its only npm runtime dependency.

Reviewed notices are committed with the engine source and copied into the prebuilt package. Package builds reuse a verified engine cache or compile with local Rust; notice generation is explicit. Maintainers refresh notices with `bun run engine:notices` when changing engine dependencies, the Rust toolchain or chess.js; see the [development guide](https://github.com/sximn/chess-engine-kit/blob/main/docs/DEVELOPMENT.md).

Original generated chess fixtures are retained for verification. `tests/fixtures/tactical-corpus.json` is a frozen CC0 subset of the Lichess puzzle database (`https://database.lichess.org/#puzzles`), with provenance and sampling recorded in the file. Fixtures are not included in the npm artifact.
