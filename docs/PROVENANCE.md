# Engine provenance and limitations

Frozenight upstream: [MinusKelvin/frozenight](https://github.com/MinusKelvin/frozenight),
pinned at `f4d5a00725b2cd5f1c32910d57a84c77b66cc670`.
The vendored library lives in `engine/frozenight/core`; the JSON/native/WASM bridge
lives in `engine/frozenight/bridge`.

The bundled upstream `model.json.zst` has SHA-256
`3b2ed542427de7de8ddb7b3eff6f47a40c682fd82b0cd8f9f5e2c5a793e58cac`.
Original MIT/Apache notices are retained; this distribution elects MIT. See
[third-party notices](../THIRD_PARTY_NOTICES.md) and the licenses shipped with assets.
`THIRD-PARTY-NOTICES.txt` consolidates chess.js, Cargo and Rust standard-library
notices as plain text, with matching texts shared between component entries.
It ships alongside Frozenight's original `LICENSE-MIT.txt` and `LICENSE-APACHE.txt`.

The browser port adds same-root MultiPV/root restrictions, preservation of
completed iterations, browser clock imports, native-thread exclusion, search
deadline/node/max-ply safeguards, legal PV reconstruction, terminal/history
handling, standard UCI castling normalization and typed allocation-failure errors.
The TypeScript adapter adds deployment, integrity checking and worker supervision.

The authored pins are in `engine/frozenight/source.json`. The compressed model is
an upstream build input retained in Git. Compiled WASM and generated manifests
are built from these inputs during CI/release preparation and included in the
npm package, rather than committed. Local builds cache validated outputs by engine
input fingerprint; release preparation always builds and independently verifies
fresh outputs with the canonical Linux x86_64 Rust toolchain.

Engine/model updates must revise the authored pins, reviewed notices and native
reference fixtures together. Runtime users consume immutable package versions and
content-addressed assets rather than a moving upstream branch.

This remains an experimental analysis engine. Earlier exploratory quick-budget
quality targets were not met; native/WASM parity does not resolve that gap.
Full-game review scheduling, classification thresholds, phone performance and
thermal/energy qualification belong to the consuming application's validation.
The SDK supplies analysis, not a certified game-review accuracy level.
