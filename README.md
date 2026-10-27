# Chess engine runtime

A browser-only, engine-neutral TypeScript analysis API with a prebuilt Frozenight WASM provider. Supports standard chess, full supplied history, MultiPV 1–3, typed White-perspective scores, progress, cancellation, restart and explicit failures. Works without SharedArrayBuffer or cross-origin isolation. There is no analysis server.

This is a standalone local repository extracted from Up a Pawn. The original app is unchanged. Package name `@upapawn/chess-engine-runtime` is provisional; no registry publication or namespace reservation is implied.

## Consume the prebuilt package

Install the supplied `.tgz`, or a registry version after publication. Consumers need no Rust compiler, Bun, engine build scripts or native reference executable:

```sh
npm install /path/to/upapawn-chess-engine-runtime-0.1.0.tgz
npx chess-engine-assets --to public/engines/frozenight
```

For SvelteKit, copy into `static/engines/frozenight`. Put the copy command in the app's normal web build so Capacitor receives the same files. The helper verifies hashes and copies only package assets; it removes only obsolete, unchanged files listed in its previous manifest and preserves unrelated files and modified obsolete files. Use a generated asset directory and serve it from the application's origin.

```ts
import {
  createFrozenight,
  type ChessEngine,
  API_VERSION,
} from "@upapawn/chess-engine-runtime";

const engine: ChessEngine = createFrozenight({
  assetBaseUrl: "/engines/frozenight/",
  hashMiB: 32,
});
const unsubscribe = engine.onEvent((event) => {
  if (event.type === "progress") console.log(event.result.lines);
});
await engine.initialize();
const result = await engine.analyzePosition({
  apiVersion: API_VERSION,
  jobId: "position-1",
  positionId: "opening",
  position: {
    rootFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    movesUci: ["e2e4", "e7e5"],
  },
  limits: { maxNodes: 100000, maxTimeMs: 1500 },
  multiPv: 3,
});
engine.cancel("position-1"); // idempotent acknowledgement
engine.reset(); // stop work; retain verified assets and listeners
unsubscribe();
engine.dispose(); // stop work and release listeners/module references
```

Call initialize in the browser/onMount. Importing the package or creating an uninitialized adapter is SSR-safe. With an app served from a subpath, pass its corresponding asset folder. A relative example suitable for static web and Capacitor is `new URL('./engines/frozenight/', document.baseURI)`.

## Contract and providers

`ChessEngine` is independent of Frozenight, Rust, WASM, Svelte and Vite. `createWorkerEngine(adapter)` provides lifecycle/supervision for adapter authors using the normalized worker protocol. Provider identity and capabilities describe the backend, history support, root restrictions, MultiPV and supported limit ranges. Model-free engines omit `modelHash`; JavaScript providers do not need a WASM memory limit. Unsupported limits are rejected, never approximated silently. The test suite includes a model-free JS provider accepting only a time limit.

At least one search limit is required by the common API. Frozenight additionally requires `maxNodes`, supporting 1,000–10,000,000 nodes, optional 10–30,000 ms and depth 1–40. Hash memory is 16–64 MiB, default 32; maximum WASM linear memory is 256 MiB. Provider-specific initialization options use `engineOptions` (`{hashMiB: 32}` for Frozenight). Capabilities and numeric node budgets do not imply equal strength or equivalent search effort across engines.

Requests use a legal root FEN and UCI history, up to 2,000 plies. Earlier history cannot be inferred from a FEN. Scores are always White's perspective; finite scores are centipawns, mate distance is signed **plies**, and current-root mate has distance zero plus a separate winner. Bounds and completed iterations are explicit. Unknown provider counters are `null`, not fabricated zeros. If a budget interrupts an iteration, only the last complete set is returned, marked limited; completed lifecycle events do not imply the requested depth was reached.

Each accepted job emits one completed/cancelled/failed terminal event. Invalid requests are rejected before replacing active work. Use unique job IDs. One search is active per instance, stale worker events are fenced, and progress is throttled by the adapter to at most 10 Hz. Cancellation terminates the worker and replacement reuses the verified module. Supervision defaults to 5 s initialization and a 32 s watchdog for node-only searches; configure `supervision.nodeOnlyWatchdogMs` for deliberately longer node-only work. Worker outputs must satisfy the normalized validation contract.

Optional asset CacheStorage is isolated from app results. SHA-256 is checked before WASM compilation; corrupted cached bytes are evicted and repaired. Storage failure does not block the session. Content-addressed workers are supplied prebundled, not compiled by the consumer. The deployment helper verifies every shipped asset. The SDK installs no service worker, writes no game/result database, has no telemetry, and owns no visibility policy. The host owns its offline shell, hidden/native pause, review scheduling, classifications and result cache. Cache results by complete position/history, provider build/model/settings and budget, plus application policy version.

## Development and rebuilding

Requires Bun 1.4.3 and Node >=22.12 for SDK development:

```sh
bun install --frozen-lockfile
bun run build          # JS, declarations and prebuilt WASM assets; no Rust
bun run check
bun run test           # contract tests + frozen native/WASM references; no Rust
bun run test:consumer  # npm pack, install tarball, build standalone consumer
bun run test:browser   # production consumer: Chromium / WebKit / Firefox
npm pack               # publishable prebuilt tarball; does not publish it
```

Tests retain 100 independent perft comparisons, 500 raw static evaluations, 200 deterministic searches, 100 cancellation cycles, legal PVs, history, terminal/mate cases and OOM recovery. The tarball excludes Rust, source TS, tests, fixtures, build scripts and node_modules; it includes JS, declarations, worker/WASM assets and notices. There are no install-time compilation hooks. The consumer example builds using npm and Vite rather than importing this source tree.

To modify or independently verify the engine, install Rust 1.90.0 and `wasm32-unknown-unknown`:

```sh
bun run engine:build
bun run engine:reference
bun run engine:notices
bun run test:native
node scripts/verify-reproducibility.mjs
# Explicitly approve changed native expectations after review:
node scripts/freeze-native-fixtures.mjs
bun run build
```

Set `ENGINE_CARGO`, `CARGO_HOME` and `RUSTUP_HOME` for a custom toolchain location. `engine/frozenight/Cargo.lock` pins dependencies. The builder remaps checkout/registry paths to keep WASM bytes independent of checkout location. Source/model/build/binary identities are recorded in the generated manifests. No public registry publishing is enabled in CI.

## Qualification and scope

The engine code/model are pinned at Frozenight `f4d5a00725b2cd5f1c32910d57a84c77b66cc670`; original MIT/Apache notices are retained. This distribution elects MIT. See [notices](THIRD_PARTY_NOTICES.md) and [provenance](docs/PROVENANCE.md).

Packaging does not improve engine strength or certify phone performance. The inherited quick-budget finite-score fidelity target is still unmet, Firefox full-game refinement was slow, and physical-phone/thermal qualification remains open. This 0.1 package is for preliminary analysis and qualification, not a claim that those release gates passed. The standalone consumer verifies package behavior in web browsers and Capacitor; the application retains responsibility for its review quality and mobile support policy.

Application PGN parsing, game scheduling/classification, indexed result storage, UI and app-specific tests intentionally remain in the original repo. [Migration notes](docs/MIGRATION.md) describe a later app integration; this extraction does not change that app.
