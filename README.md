# Chess engine kit

Run chess analysis in a browser worker with a prebuilt Frozenight WebAssembly
engine. TypeScript API, move history, up to three candidate lines, progress and
cancellation. No analysis server, Rust installation or SharedArrayBuffer required.

The package is experimental. See [engine provenance and limitations](docs/PROVENANCE.md).

## Try the example locally

From this repository, use Node >=22.12 and Bun 1.4.4. The first source build also
needs the [engine compiler setup](https://github.com/sximn/chess-engine-kit/blob/main/docs/DEVELOPMENT.md#first-source-build): Rust
1.90.0 with the `wasm32-unknown-unknown` target on your local machine.
Later SDK builds reuse the verified local engine cache.

```sh
bun install --frozen-lockfile
bun run example:setup
npm --prefix examples/minimal run dev
```

Open the URL Vite prints. Enter a FEN and optional moves, then analyze or cancel.
The [minimal example](https://github.com/sximn/chess-engine-kit/blob/main/examples/minimal/README.md) uses the packed npm package and
shows scores, candidate lines, progress, terminal positions and errors.

## Install in your project

Once published, install the experimental release:

```sh
bun add --exact chess-engine-kit@next
```

The worker, WASM and licenses are included in the package. Bundlers that support
`new URL("./asset", import.meta.url)` discover them directly in `node_modules`,
serve them in development and emit them into the production build. No copy
command, extra package scripts or generated files in your source tree are needed.
Package tests verify this with Vite 8 and webpack 5. See the
[API guide](docs/API.md#assets-offline-use-and-result-caches) for
custom URLs, older tooling and deployments without an asset-aware bundler.

Use `chess-engine-kit/core` for shared types, constants, errors and the generic
worker client. The package root exposes the same core API. Import Frozenight
from `chess-engine-kit/frozenight` to include its packaged assets, or use
`chess-engine-kit/frozenight/manual` when your app supplies its own asset URLs.
Core and manual imports emit no packaged engine assets.

## Analyze a position

Run this in the browser, such as a component's mount hook:

```ts
import { API_VERSION } from "chess-engine-kit/core";
import { createFrozenight } from "chess-engine-kit/frozenight";

const engine = createFrozenight();

try {
  await engine.initialize();
  const result = await engine.analyzePosition({
    apiVersion: API_VERSION,
    jobId: crypto.randomUUID(),
    positionId: "opening",
    position: {
      rootFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      movesUci: ["e2e4", "e7e5"],
    },
    limits: { maxNodes: 100_000, maxTimeMs: 1500 },
    multiPv: 3,
  });
  console.log(result.outcome ?? result.lines);
} catch (error) {
  console.error("Analysis failed", error);
} finally {
  engine.dispose();
}
```

Positive scores favor White. Centipawn scores use `kind: "cp"`; mate scores use
signed plies. Frozenight requires `maxNodes`, including when you set a time limit.
A budget-limited result contains the last complete iteration and can have no
lines. Preserve the root FEN plus moves for repetition history.

Importing the package is SSR-safe; initialize it in a browser. Production hosting
needs HTTPS for Web Crypto and a policy allowing same-origin module workers and
WebAssembly compilation. The host app owns its board, PGN parsing and offline shell.

See the [API guide](docs/API.md) for cancellation, lifecycle and adapter contracts,
[development guide](https://github.com/sximn/chess-engine-kit/blob/main/docs/DEVELOPMENT.md) for tests and engine rebuilds, and
[publishing guide](https://github.com/sximn/chess-engine-kit/blob/main/docs/PUBLISHING.md) for the manual release workflow.
User-facing changes are recorded in the [changelog](https://github.com/sximn/chess-engine-kit/blob/main/CHANGELOG.md).
