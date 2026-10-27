# Development and verification

Use Node >=22.12 and Bun 1.4.3. Ordinary SDK builds use the committed prebuilt
WASM and need no Rust installation.

```sh
bun install --frozen-lockfile
npm run check
npm test
npm run test:consumer
bunx playwright install chromium firefox webkit
npm run test:browser
```

`npm test` builds the SDK and exercises client contracts, asset deployment,
independent move generation, frozen native/WASM parity, history, legal PVs and OOM
recovery. The deterministic reference searches are deliberately shallow; passing
parity checks does not measure engine strength. The tactical fixture test checks
legal reference solutions, not the engine's puzzle solve rate.

`test:consumer` builds and packs the current version, checks package contents and
documentation links, then installs it into isolated copies of both examples at
`.build/consumers/`. Their committed npm lockfiles pin tooling; `npm ci` runs with
install scripts disabled, followed by an unsaved installation of the exact tarball.
The source examples and their lockfiles are never rewritten by verification.

Browser checks use those production builds at deployment subpaths in Chromium,
Firefox and WebKit. They cover real analysis, cancellation/replacement, offline
reload in the consumer harness, corrupt downloads, and the minimal example's UI.
Run `test:consumer` first. Install browser binaries separately when setting up a
new machine. `release:prepare` runs the entire package sequence.

Generated reports belong in `.build/reports/`, tarballs in `.build/`, and browser
traces in `test-results/`. CI uploads reports and the release artifact. Historical
screenshots, timings and extraction proofs are not maintained as source files.
Deterministic fixtures, source/model manifests and license notices remain tracked.

## Engine changes

Install Rust 1.90.0 and target `wasm32-unknown-unknown`:

```sh
npm run engine:build
npm run engine:reference
npm run engine:notices
npm run test:native
node scripts/verify-reproducibility.mjs
```

`ENGINE_CARGO`, `CARGO_HOME` and `RUSTUP_HOME` support custom toolchain locations.
Cargo.lock pins dependencies. The builder remaps checkout/registry paths and
records source/model/build/binary identities. Reproducibility checks compare
independent checkout paths on the same host; they do not assert cross-OS identity.

When intentionally changing engine behavior, review changes against the pinned
upstream, update source/model pins and notices, run native checks, and explicitly
refresh frozen expectations with `node scripts/freeze-native-fixtures.mjs`.
Review fixture diffs before accepting them, then rerun package verification.

## Capacitor qualification

`examples/consumer` is an integration harness, separate from the learning example.
After `test:consumer`, work in `.build/consumers/consumer`, use `npx cap add ios`
and/or `npx cap add android`, then `npx cap sync` and the platform build tools.
`scripts/verify-capacitor-assets.mjs --android <apk> --ios <app>` compares the
native packages against that harness's built web assets.

Building or running a simulator is not physical-device, thermal or energy
qualification. Test the devices and budgets required by your consuming app.
