# Development and verification

Use Node >=22.12 and Bun 1.4.4. Git contains source, the pinned model input,
lockfiles, reviewed licensing records and intentional test fixtures. Compiled
WASM, generated manifests, SDK bundles and tarballs are build outputs under
`.build/` and `dist/`; they are never committed.

The published npm package includes the compiled engine. Applications installing
it do not need Rust. Working from this repository requires a local Rust
compiler on the first build, as described below.

## First source build

On macOS, Linux and other supported Rust hosts, install Rust 1.90.0 with target
`wasm32-unknown-unknown`. Engine builds run directly with the local compiler.
With rustup installed, prepare the toolchain with:

```sh
rustup toolchain install 1.90.0 --profile minimal
rustup target add --toolchain 1.90.0 wasm32-unknown-unknown
```

The manifest records the actual compiler host. Different hosts can order WASM
functions differently even with the same Rust version and target, so byte-for-byte
reproducibility is checked with the same compiler host. CI release artifacts are
built and independently verified on Linux x86_64.

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun run test
```

`build`, `test`, `test:package` and `example:setup` automatically ensure a valid
engine build exists. There is no separate generated-file setup step to remember.
`bun run check` works before generated outputs exist: the SDK's authored manifest
bridge is typed from source, and its generated value is injected while bundling.
Builds never rewrite tracked TypeScript or licensing records.

## Local engine cache

Engine outputs are stored in immutable directories under `.build/engine/objects/`.
A small index per input key selects a complete build. The key covers the vendored
engine/model, source pins, lockfiles and engine tooling,
reviewed notices, the Bun pin and the chess.js dependency version.

SDK TypeScript edits and package version bumps reuse the engine. Engine inputs
changing cause a rebuild. Every cache hit checks the complete file inventory and
SHA-256 hashes, the model/source pins, and the WASM manifest. Missing, partial or
corrupt entries are rebuilt. A failed build cannot replace the last good entry.
The cache index is published atomically after successful validation; concurrent
readers continue using an immutable, complete build directory.

```sh
bun run engine:build          # build only if missing or invalid
bun run engine:build --force  # compile even with a valid cache
```

Deleting `.build/engine/` clears the generated asset cache. Rust compiler caches
are separate under `engine/frozenight/target/`. Builds use the local Cargo and
Rust compiler; `ENGINE_CARGO`, `CARGO_HOME` and `RUSTUP_HOME` support custom
installation and cache locations.

## Package and browser checks

Bun runs repository scripts, tests, packing and version changes. npm installs the
minimal example for compatibility and publishes the verified tarball. The SDK
publishes separate ESM entries with shared chunks and TypeScript declarations;
its asset-copy CLI runs on Node.
TypeScript emits declarations, while `bun check` checks SDK, CLI, script and test
sources before building.

```sh
bun run test
bun run test:versioning
bun run test:package
bunx playwright install chromium firefox webkit
bun run test:browser
```

`test` builds the SDK and checks client contracts, asset deployment, independent
move generation, frozen native/WASM parity, history, legal PVs and OOM recovery.
Parity is a deterministic fidelity check, not a measure of engine strength.

`test:package` packs the SDK, validates the engine and deployment manifests inside
the archive, then installs that exact tarball into isolated copies of the browser
app, minimal example and webpack consumer under `.build/apps/`. Bun and npm disable install scripts;
every installed package file must match the archive. Their production builds are
served at subpaths for Chromium, Firefox and WebKit tests, including real analysis,
cancellation, corrupt assets, offline reload and the minimal UI. A Vite development
server also verifies optimized dependencies resolve directly to `node_modules`.
Production builds of the automatic `/frozenight` entry must emit the packaged
WASM and notices without writing a public asset folder; webpack uses its standard
URL asset handling. Additional builds of the root, `/core` and
`/frozenight/manual` entries must emit no engine assets in either Vite or webpack.
The browser suite also exercises manual URLs and a folder deployed with the Node
CLI. Run `test:package` before `test:browser`.

`test:versioning` rehearses a patch bump in an isolated source copy. It transports
the already-verified engine cache, checks SDK/deployment metadata and tarball
identity, and removes the copy. A version-only change must not compile the engine
again. No source manifests or application lockfiles are rewritten.

## Reproducibility and releases

```sh
bun run engine:verify
bun run release:prepare
bun run release:dry-run
```

`engine:verify` compares the current validated build with a fresh compilation in
an independent source/target directory. It also regenerates notices and compares
them with the reviewed records. WASM bytes, manifest identities, license text and
dependency records must match. Only informational gzip/Brotli size estimates may
vary between compression implementations. Temporary work stays under `.build/`
and is removed after success or failure.

`release:prepare` always forces a source build, independently rebuilds it, runs
live native parity/unit checks, rehearses a version bump, tests npm/Bun consumers,
and runs the browser suite. The final tarball's embedded engine inventory must
match the independently verified build. A receipt binds the source commit,
source fingerprint, tarball SHA-256 and engine-verification record. Source inputs
changing during the process cause preparation to fail.

PR and push CI runs `check`, `test:native` (including the full unit suite),
`test:versioning`, `test:package` and `test:browser` from a fresh checkout. A second
Linux job rebuilds independently and compares against the engine extracted from
that run's tested npm tarball using `engine:verify --package <tarball>`. This is
the PR's reproducibility check; the package job does not repeat it or create a
release receipt. Generated engine outputs are not restored from a shared CI cache.

The separate manual release workflow runs full `release:prepare`, then validates
the receipt and rehearses npm publication with `release:dry-run`. This can contact
the registry and rejects an already-published release candidate. PR checks
validate the current package version even if it is already published. Registry
identity, channel and upload checks also run during real publication. See the
[publishing guide](PUBLISHING.md).

Reports and tarballs are under `.build/`, browser traces under `test-results/`.
Intermediate CI artifacts expire; successful GitHub releases retain the tested
tarball, receipt, engine proof and publication evidence as release attachments.

## CI browser setup

The package job uses Ubuntu 24.04. Browser system dependency installation bypasses
the Azure Ubuntu mirror in both hosted runner mirror lists and APT source URLs,
addressing the intermittent stalls described in
[runner-images](https://github.com/actions/runner-images/issues/12949).
System dependencies and browser binaries install separately with ten-minute
limits so failed downloads can be diagnosed independently.

## Engine changes

Native reference checks and notice regeneration also require Rust 1.90.0 on the
host. `ENGINE_CARGO`, `CARGO_HOME` and `RUSTUP_HOME` support custom locations. When
`ENGINE_CARGO` is set, its companion `rustc` is used consistently. Missing locked
Cargo sources are fetched automatically for notices.

Native builds always select the reviewed model and Rust toolchain. Ambient
`EVALFILE`, compiler wrappers, Rust flags and Cargo profile/target/build overrides
cannot silently change the compiled engine or redirect the native reference.
Keep intentional compiler settings in the reviewed build recipe.

Review engine/model changes against the pinned upstream. Update
`engine/frozenight/source.json` when changing the upstream revision or model hash;
keep the vendored input model in Git. Update Rust toolchain pins together
when changing compilers. Then refresh reviewed notices and native expectations:

```sh
bun run engine:notices
bun run engine:build
bun run engine:reference
# Only after reviewing intentional behavior changes:
bun scripts/maintenance/fixtures/freeze-native-fixtures.ts
bun run release:prepare
```

`engine:notices` updates the reviewed text files in `assets/frozenight/` and
`engine/frozenight/dependencies.json`. It retains original Frozenight licenses
and consolidates chess.js, locked Cargo and Rust standard-library notices as
plain text. Matching texts are shared after whitespace normalization; copyright
statements and license wording are retained. The broad Rust component inventory,
including other targets, is retained. Review and commit these records; generated
WASM, manifests and build reports remain ignored.

The fixture tools never run automatically to bless changed output. The other
occasional commands are `scripts/maintenance/fixtures/create-engine-corpus.ts`
and `scripts/maintenance/fixtures/import-puzzle-corpus.py`. Refresh and review
native expectations after intentionally changing the deterministic corpus.

## Repository layout

- `src/`, `bin/`: SDK and asset-copy CLI sources.
- `engine/`: pinned Rust/model inputs, upstream licenses and dependency inventory.
- `assets/frozenight/`: reviewed licensing records only.
- `scripts/maintenance/engine/`: compiler, cache and independent verification.
- `scripts/verification/`: package, version and browser application checks.
- `scripts/release/`: release preparation, sealed-artifact publication and records.
- `examples/minimal/`: learning example; `tests/integration/`: contract applications.
