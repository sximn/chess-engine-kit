# Engine and runtime notices

Frozenight by Mark Carlson is pinned at `f4d5a00725b2cd5f1c32910d57a84c77b66cc670`. Its code and repository-bundled `model.json.zst` are MIT OR Apache-2.0; this distribution elects MIT. The original notices are retained in `engine/frozenight/` and shipped with the binary. The TypeScript runtime and bridge use MIT. No source from CrispChess, Stockfish, or another considered provider is used.

The asset folder ships three tracked notice files: Frozenight's original `LICENSE-MIT.txt` and `LICENSE-APACHE.txt`, plus `THIRD-PARTY-NOTICES.txt` for chess.js, Cargo dependencies and the Rust standard library. Keep these files with the worker and WASM when redistributing or deploying the assets; the package's module-relative URL references and optional asset-copy CLI include them automatically.

The generated `THIRD-PARTY-NOTICES.txt` is the component inventory and notice bundle. Its inputs are the engine's `Cargo.toml`/`Cargo.lock`, `rust-toolchain.toml`, and the selected toolchain's source lockfile and license files. It is a report of those inputs, not a separate dependency definition. Maintainers do not edit component lists by hand.

Cargo entries distinguish WASM compilation from host build scripts and procedural macros. Host build notices are retained conservatively for generated code and data. Rust standard-library dependencies are selected from the actual WASM link inputs and matched to exact versions in the pinned toolchain's source lockfile. Link inputs precede dead-code elimination; Rust's in-tree attributions remain conservative. Complete upstream texts, copyright notices and applicable exceptions are retained, including `compiler_builtins`' LLVM exception.

The standalone worker bundles chess.js 1.4.0 under BSD-2-Clause; its full notice is included in the same consolidated file. The ESM client declares chess.js as its only npm runtime dependency.

Reviewed notices are committed with the engine source and copied into the prebuilt package. Package builds reuse a verified engine cache or compile with local Rust; notice generation is explicit. Maintainers refresh notices with `bun run engine:notices` when changing engine dependencies, the Rust toolchain or chess.js; see the [development guide](https://github.com/sximn/chess-engine-kit/blob/main/docs/DEVELOPMENT.md).

Original generated chess fixtures are retained for verification. `tests/fixtures/tactical-corpus.json` is a frozen CC0 subset of the Lichess puzzle database (`https://database.lichess.org/#puzzles`), with provenance and sampling recorded in the file. Fixtures are not included in the npm artifact.
