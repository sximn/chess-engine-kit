# Source provenance

This local repository is an additive extraction from Up a Pawn on 27 October 2026; the app's files are retained unchanged. It is not a GitHub-created fork and no remote has been created. It owns a pinned, modified source snapshot suitable for independent maintenance.

Upstream: https://github.com/MinusKelvin/frozenight
Revision: `f4d5a00725b2cd5f1c32910d57a84c77b66cc670`.
Upstream `frozenight/` library maps to `engine/frozenight/core/`. `bridge/` contains the browser JSON ABI and portable native reference. The original license texts remain at the vendored workspace root. `core/model.json.zst` is the original bundled model; SHA-256 `3b2ed542427de7de8ddb7b3eff6f47a40c682fd82b0cd8f9f5e2c5a793e58cac`.

Port modifications: same-root MultiPV/root exclusions, optional root restrictions, completed-iteration preservation, browser clock imports, native-thread exclusion, qsearch deadline/node/max-ply safeguards, legal PV reconstruction, terminal/history handling, standard UCI castling normalization and typed allocation-failure reporting. The Rust fork is copied unchanged from the app extraction; the new TypeScript adapter/client boundary and deployment tooling are maintained here.

Review upstream changes against the original pinned library before replacing the snapshot. Update the pin, lockfile, model identity, notices, native expectations and tests as one reviewed engine release. Runtime clients consume immutable package versions and content-addressed binaries, not a moving upstream branch.

Prior engine qualification remains preliminary: 30k-node/750ms desktop puzzle test solved 90/100 full held-out Lichess puzzles; finite-score agreement within 50cp was only 41/55 stable finite comparisons at that exploratory budget. Stable-reference sample size and phone/thermal gates remain insufficient for release qualification. No extra engine is implemented by this extraction.
