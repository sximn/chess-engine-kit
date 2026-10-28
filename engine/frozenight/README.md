# Vendored Frozenight fork

Pinned source, bundled model and licenses are described in ../../docs/PROVENANCE.md. This directory is the engine-development workspace, excluded from the published npm package.

Use the repository-root scripts `engine:build`, `engine:reference`, `engine:notices` and `test:native`; see the root README. Rust 1.90.0 and the wasm32-unknown-unknown target are pinned. The first source build needs the canonical compiler; SDK/package builds then reuse a verified cache under .build/. Published npm packages include the prebuilt WASM.

Distributable WASM uses the Linux x86_64 Rust 1.90.0 compiler host. The root
`engine:build` script uses a digest-pinned Docker image on macOS and other hosts;
start Docker/Colima with linux/amd64 support before engine maintenance there.
