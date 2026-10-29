# Changelog

User-facing changes are recorded here. Version entries become release notes when
that version is published; an entry by itself does not mean it is available on npm.

## [Unreleased]

## [0.0.2] - 2026-10-29

### Security

- Pin all GitHub Actions in verification and publishing workflows to full commit
  hashes, including the Rust toolchain action, to prevent upstream tag or branch
  changes from silently changing CI and release code
  - https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions

### Bug Fixes

- Add extra polling time when checking registry during publishing to avoid action failures that lead to published packaged without a github release

### Miscellaneous Chores

- Remove unused dependency `vite`
- Bump dependency `@playwright/test` to 1.64.1
- Clean up what gets published within the package
  - Remove examples
  - Remove unnecessary docs


## [0.0.1] - 2026-10-28

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

- Exclude Finder metadata from engine cache keys and release fingerprints so
  opening a folder cannot invalidate a verified build.
- Pin native engine builds to the reviewed model and compiler settings, including
  when the developer shell contains Cargo overrides.
- Make manual-release tests independent of runner credentials and npm versions,
  with explicit checks for trusted-publishing and first-publication requirements.
- Use a canonical Linux x86_64 compiler host for engine assets so macOS/ARM
  maintenance builds match Linux CI without relaxing binary verification.
- Build WASM and generated manifests from source in CI and releases; cache verified
  engine outputs locally and keep compiled artifacts out of Git.
