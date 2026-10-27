# Extraction verification — 27 October 2026

The app repository is unchanged. `artifacts/app-preserved.json` records a before/after SHA-256 comparison of every tracked and non-ignored untracked app file, including its previous requirements/evidence and engine sources. This extraction neither installs the package into that app nor removes its existing engine implementation.

Delivered package: `@upapawn/chess-engine-runtime@0.1.0`, local prebuilt npm tarball. No remote repository or registry publication is created. The ESM client has one runtime npm dependency (chess.js); it has no framework, Capacitor or Rust dependency. Source Rust, tests, fixtures and build scripts are excluded from the tarball. All worker/WASM bytes, declarations and notices are included.

## Completed checks

- TypeScript check passes; standalone installed consumer also passes strict TypeScript and production Vite build using npm with install scripts disabled. Consuming the tarball requires no Rust or Bun.
- 21 unit/contract tests pass. These include a model-free JavaScript provider with time-only limits, SSR-safe import, 100 stale/cancellation cycles, one terminal per accepted job, crash recovery, malformed-message normalization, options validation and safe asset upgrades.
- Engine tests retain 100 independent perft comparisons, 500 exact static native/WASM cases, 200 exact depth-three searches including MultiPV, full history, terminal/mate/promotion/castling/en-passant cases and typed OOM plus fresh-instance recovery. Both frozen native fixtures and a freshly built native reference were exercised; see parity JSON artifacts.
- Clean WASM build from another checkout and target directory is byte-for-byte identical after path remapping. `artifacts/reproducibility.json` records the hash and build fingerprint. This is a same-host cross-directory check, not an unperformed cross-OS assertion.
- Nine production browser tests pass across Chromium, Firefox and WebKit. They use the installed tarball, a `/review/` deployment subpath, real MultiPV/history and 100 cancel/replacement cycles per browser, offline reload and corrupt-download retry. The consumer owns its service worker; the SDK installs none. WebKit offline verification stops an isolated origin because Playwright's offline flag rejects SW-served requests.
- The standalone tarball consumer builds as an Android Debug APK and iOS Simulator Debug app through Capacitor 8.5.3. Every built web asset is checked against both native packages (`artifacts/capacitor-assets.json`).
- The iOS app was installed and run in iPhone 17 Pro / iOS 26.3 Simulator. It reports **All checks passed** for real MultiPV, repetition, cancellation and replacement (`artifacts/capacitor-ios.png`). It is a separate test app and does not replace the original application's bundle.

## Reproduction

```sh
bun install --frozen-lockfile
bun run build && bun run check && bun run test
bun run test:consumer
bunx playwright install chromium firefox webkit
bun run test:browser
```

Engine-development checks additionally require the pinned Rust toolchain:

```sh
bun run engine:build && bun run engine:reference && bun run engine:notices
bun run test:native
node scripts/verify-reproducibility.mjs
```

Capacitor projects are generated and ignored to keep the SDK repository small. After `test:consumer`, from `examples/consumer` run `npx cap add ios`, `npx cap add android`, and `npx cap sync`. Use the normal platform build tools, then run `scripts/verify-capacitor-assets.mjs` from the repository root with built APK/`.app` paths. CI separates ordinary package builds from Rust engine qualification; it uploads artifacts without publishing npm versions.

## Limits retained

This extraction changes ownership and packaging, not engine strength. Prior finite-score quality targets remain unmet; full-game Firefox refinement was slow in the application; real-device performance, Android runtime and thermal/energy qualification are still open. The iOS Simulator is not a physical-phone performance measurement. See PROVENANCE.md for inherited qualification numbers. Only Frozenight is implemented; other engines can implement the same contract but are not claimed to be supported adapters yet.
