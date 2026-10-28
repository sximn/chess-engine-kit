# Development and verification

Use Node >=22.12 and Bun 1.4.4. Ordinary SDK builds use the committed prebuilt
WASM and need no Rust installation.

Bun handles repository tasks, packing and version changes. npm publishes verified
tarballs and provides GitHub trusted publishing. The minimal example also uses npm
as an installation compatibility check. See the [publishing guide](PUBLISHING.md)
for the manual release workflow.

`bun run check` invokes Bun's native `bun check` to validate the SDK, scripts,
asset-copy CLI, unit tests, browser tests and Playwright configuration from source.
Contract tests load the
built SDK at runtime while using its source API for types, so checking works
before `dist/` exists. Standalone applications check their own sources after
installing the packed package: the browser test app uses `bun run check`, and the
minimal npm example uses `tsc --noEmit`.

Repository scripts are TypeScript executed by Bun; unit/engine tests run with
Bun's test runner. `tsconfig.build.json` selects the browser SDK for declaration
generation. The TypeScript compiler remains for emitting `dist/types/` because
Bun's checker does not emit declarations. The asset-copy CLI source in
`bin/copy-assets.ts` is bundled into `dist/bin/copy-assets.js` with a Node shebang
for npm applications. The browser SDK is published as JavaScript with TypeScript
declarations.

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run test:package
bunx playwright install chromium firefox webkit
bun run test:browser
```

`bun run test` builds the SDK and exercises client contracts, asset deployment,
independent move generation, frozen native/WASM parity, history, legal PVs and OOM
recovery. The deterministic reference searches are deliberately shallow; passing
parity checks does not measure engine strength. The tactical fixture test checks
legal reference solutions, not the engine's puzzle solve rate.

`test:package` builds and packs the current version, checks package contents and
documentation links, then installs it into isolated copies of the browser test
app (`tests/integration/browser-app`) and the learning example (`examples/minimal`)
at `.build/apps/`. Bun installs the browser app from its committed `bun.lock`
with `--frozen-lockfile`; npm installs the minimal example with `npm ci` and its
`package-lock.json`. Both disable install scripts, then install the exact tarball
without saving manifest or lockfile changes. Verification reads the packed
archive to check its identity and file list. The source applications and their
lockfiles are never rewritten by verification.

Every installed package file must match the verified tarball's bytes. This checks
that both package managers installed the artifact being released.

Browser checks use those production builds at deployment subpaths in Chromium,
Firefox and WebKit. They cover real analysis, cancellation/replacement, offline
reload in the browser test app, corrupt downloads, and the minimal example's UI.
Run `test:package` first. Install browser binaries separately when setting up a
new machine. `release:prepare` runs the entire package sequence.

`test:versioning` rehearses a patch bump using isolated build inputs. It checks
the rebuilt SDK's exported manifest, deployed asset versions and npm tarball
identity, then removes the temporary copy. It does not install dependencies or
build the applications; `test:package` covers those checks for the release version.

Generated reports belong in `.build/reports/`, tarballs in `.build/`, and browser
traces in `test-results/`. CI uploads reports and the release artifact. Historical
screenshots, timings and extraction proofs are not maintained as source files.
Deterministic fixtures, source/model manifests and license notices remain tracked.

## CI browser setup

The package job uses Ubuntu 24.04 and checks SDK, script and test types before browser
setup. System dependency installation bypasses the Azure Ubuntu mirror in both the hosted runner's
mirror list and direct APT source URLs. This addresses intermittent mirror stalls
reported in [runner-images](https://github.com/actions/runner-images/issues/12949).
System dependencies and browser binaries install in separate steps, each limited
to ten minutes, so logs show which download stage is slow. The next hosted run
must confirm the timing improvement; local browser tests do not measure APT.

## Repository layout

Run commands from the repository root. Scripts are grouped by purpose:

- `scripts/`: package builds, unit tests, example setup and shared helpers.
- `scripts/verification/`: package installation, version checks and the browser
  test server. `bun run test:package` checks the packed npm artifact.
- `scripts/release/`: release preparation and publication.
- `scripts/maintenance/engine/`: Rust/WASM builds and engine verification.
- `scripts/maintenance/fixtures/`: explicit test-data regeneration.

The learning example remains in `examples/minimal/`. The browser test app lives
under `tests/integration/` because it exercises package contracts for automated
tests. Its offline shell belongs to the test app; the SDK does not register a
service worker. See that app's README for manual inspection commands.

## Engine changes

Install Rust 1.90.0 and target `wasm32-unknown-unknown`:

```sh
bun run engine:build
bun run engine:reference
bun run engine:notices
bun run test:native
bun run engine:verify
```

`ENGINE_CARGO`, `CARGO_HOME` and `RUSTUP_HOME` support custom toolchain locations.

`engine:notices` is an explicit maintenance command, not a package-build step.
It reads the installed pinned chess.js package, locked Cargo packages and Rust
1.90.0's standard-library notices, then refreshes the tracked
`assets/frozenight/THIRD-PARTY-NOTICES.txt` and dependency inventory. It converts
the Rust HTML to plain text, shares matching notice texts after normalizing
whitespace, and retains copyright statements and license wording. It also
includes the standalone license texts referenced by Rust's in-tree inventory;
the rest of Rust's generic license directory is not copied. The broad Rust
component inventory (including other targets) is retained. Commit and review
the refreshed files when updating Rust, engine dependencies or chess.js.

Cargo.lock pins dependencies. The builder remaps checkout/registry paths and
records source/model/build/binary identities. Verification rebuilds the engine and notices in a temporary checkout, then
compares committed binary bytes, manifest identities, license notices and dependency
records with that rebuild. Informational gzip/Brotli size estimates may differ
between compression implementations; they are the only manifest fields excluded
from this comparison. It never
overwrites the originals, so stale WASM or license notices fail CI. The report
binds the verified assets to the source commit and release input fingerprint.
Temporary build files are removed on success and failure. The build comparison
also exercises independent checkout paths; it does not establish reproducibility
across every supported OS/toolchain combination.

When intentionally changing engine behavior, review changes against the pinned
upstream, update source/model pins and notices, run native checks, and explicitly
refresh frozen expectations with
`bun scripts/maintenance/fixtures/freeze-native-fixtures.ts`.
Review fixture diffs before accepting them, then rerun package verification.

The other fixture generators are occasional maintenance tools:

- `bun scripts/maintenance/fixtures/create-engine-corpus.ts` regenerates the
  deterministic game/position corpus. Refresh native expectations afterward.
- `python3 scripts/maintenance/fixtures/import-puzzle-corpus.py <puzzles.csv>`
  imports the tactical corpus from a supplied CSV prefix. The script documents
  how to obtain that input; it does not download it.
