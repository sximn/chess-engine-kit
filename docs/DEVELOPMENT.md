# Development and verification

Use Node >=22.12 and Bun 1.4.3. Ordinary SDK builds use the committed prebuilt
WASM and need no Rust installation.

```sh
bun install --frozen-lockfile
npm run check
npm test
npm run test:package
bunx playwright install chromium firefox webkit
npm run test:browser
```

`npm test` builds the SDK and exercises client contracts, asset deployment,
independent move generation, frozen native/WASM parity, history, legal PVs and OOM
recovery. The deterministic reference searches are deliberately shallow; passing
parity checks does not measure engine strength. The tactical fixture test checks
legal reference solutions, not the engine's puzzle solve rate.

`test:package` builds and packs the current version, checks package contents and
documentation links, then installs it into isolated copies of the browser test
app (`tests/integration/browser-app`) and the learning example (`examples/minimal`)
at `.build/apps/`. Their committed npm lockfiles pin tooling; `npm ci` runs with
install scripts disabled, followed by an unsaved installation of the exact tarball.
The source applications and their lockfiles are never rewritten by verification.

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

## Repository layout

Run commands from the repository root. Scripts are grouped by purpose:

- `scripts/`: package builds, unit tests, example setup and shared helpers.
- `scripts/verification/`: package installation, version checks and the browser
  test server. `npm run test:package` checks the packed npm artifact.
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
npm run engine:build
npm run engine:reference
npm run engine:notices
npm run test:native
node scripts/maintenance/engine/verify-reproducibility.mjs
```

`ENGINE_CARGO`, `CARGO_HOME` and `RUSTUP_HOME` support custom toolchain locations.
Cargo.lock pins dependencies. The builder remaps checkout/registry paths and
records source/model/build/binary identities. Reproducibility checks compare
independent checkout paths on the same host; they do not assert cross-OS identity.

When intentionally changing engine behavior, review changes against the pinned
upstream, update source/model pins and notices, run native checks, and explicitly
refresh frozen expectations with
`node scripts/maintenance/fixtures/freeze-native-fixtures.mjs`.
Review fixture diffs before accepting them, then rerun package verification.

The other fixture generators are occasional maintenance tools:

- `node scripts/maintenance/fixtures/create-engine-corpus.mjs` regenerates the
  deterministic game/position corpus. Refresh native expectations afterward.
- `python3 scripts/maintenance/fixtures/import-puzzle-corpus.py <puzzles.csv>`
  imports the tactical corpus from a supplied CSV prefix. The script documents
  how to obtain that input; it does not download it.
