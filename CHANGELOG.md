# Changelog

User-facing changes are recorded here. Version entries become release notes when
that version is published; an entry by itself does not mean it is available on npm.

## [Unreleased]

### Added

- Initial experimental browser chess analysis SDK with a prebuilt Frozenight WASM
  engine and worker supervision.
- Typed analysis requests, move history, MultiPV, progress, cancellation and
  terminal-position handling.
- Content-addressed engine assets, integrity checks and a Node-compatible asset
  copy command.
- A minimal Vite example and package verification in npm and Bun applications.
- Manual GitHub releases with verified artifacts and engine source rebuild checks.

### Limitations

- Experimental analysis quality; native/WASM parity does not establish engine
  strength or certify game-review accuracy.
- Browser deployments require HTTPS, same-origin assets and a policy permitting
  Web Crypto, module workers and WebAssembly compilation.

### Fixed

- Use a canonical Linux x86_64 compiler host for engine assets so macOS/ARM
  maintenance builds match Linux CI without relaxing binary verification.

- Build WASM and generated manifests from source in CI and releases; cache verified
  engine outputs locally and keep compiled artifacts out of Git.
