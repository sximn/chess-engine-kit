# Vendored Frozenight fork

Pinned source, bundled model and licenses are described in ../../docs/PROVENANCE.md. This directory is the engine-development workspace, excluded from the published npm package.

Use the repository-root scripts `engine:build`, `engine:reference`, `engine:notices` and `test:native`; see the root README. Rust 1.90.0 and the wasm32-unknown-unknown target are pinned. The first source build needs the pinned local compiler; SDK/package builds then reuse a verified cache under .build/. Published npm packages include the prebuilt WASM.

Engine builds use the local Rust 1.90.0 compiler and record its host in the
manifest. Independent rebuilds compare bytes on the same compiler host; release
artifacts are built and verified on Linux x86_64 in CI.
