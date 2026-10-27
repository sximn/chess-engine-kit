# API guide

## Positions, limits and scores

`position.rootFen` is the starting position; `movesUci` is the legal move sequence
from it to the position to analyze (at most 2,000 plies). Use an empty array for a
standalone FEN. The engine cannot reconstruct history preceding that FEN.
Only standard chess is supported.

Frozenight supports:

| Option      | Range/default              |
| ----------- | -------------------------- |
| `maxNodes`  | Required, 1,000–10,000,000 |
| `maxTimeMs` | Optional, 10–30,000 ms     |
| `maxDepth`  | Optional, 1–40             |
| `multiPv`   | 1–3 candidate moves        |
| `hashMiB`   | 16–64 MiB, default 32      |
| WASM memory | Maximum 256 MiB            |

The first search limit reached stops analysis. `completion: "limited"` is a
successful budget-limited result, preserving the last complete iteration.
`completedIteration` tells you whether any full iteration finished; otherwise
`lines` is empty. `completion: "completed"` means a depth target or terminal
position was reached. Unknown counters from other providers are `null`.

Lines have rank, root move, UCI principal variation (`pv`) and score. All scores
are from White's perspective, regardless of whose turn it is:

- `{kind: "cp", value: 35}` means +0.35 pawns for White.
- `{kind: "cp", value: -120}` means 1.20 pawns for Black.
- `{kind: "mate", value: 3, unit: "plies"}` means White mates in three plies.
- A negative mate value means Black mates. Mate units are not full moves.

`bound` is `exact`, `lower` or `upper`; preserve it when presenting uncertain
scores. Terminal results have an `outcome`, no candidate lines, and a
`terminalScore`. A root checkmate has mate value zero plus a separate `winner`.
Draw outcomes include stalemate, repetition, fifty-move and insufficient material.

## Progress and cancellation

```ts
const unsubscribe = engine.onEvent((event) => {
  if (event.type === "progress") render(event.result.lines);
});
const jobId = crypto.randomUUID();
const pending = engine.analyzePosition({ ...request, jobId });
// Call from a Cancel button while the promise is pending:
engine.cancel(jobId);
try {
  await pending;
} catch (error) {
  if (!(error instanceof EngineError && error.code === "CANCELLED"))
    throw error;
}
unsubscribe();
```

Import `EngineError` from the package. Each accepted job has one terminal event:
`completed`, `cancelled` or `failed`. Invalid requests reject before replacing
active work and do not emit an accepted-job terminal event. Use unique job IDs.
Only one job is active per engine instance; a valid new request cancels the old
one, rejecting the old promise with `CANCELLED`. Always handle that rejection.

State transitions finish before listeners run, including replacement, reset and
disposal. A listener may start another job; normal replacement rules still apply.
Listeners receive isolated result snapshots, and listener exceptions are ignored.
For progress/completed events, `event.result` is the canonical result; top-level
copies of its fields remain for compatibility. Progress is throttled to 10 Hz.

`cancel` returns `stopped`, `already-finished` or `unknown`. Finished IDs are kept
for the last 128 jobs, cleared by reset/disposal. Cancellation terminates the
worker; the next job reuses an already verified module.

## Lifecycle and errors

- `createFrozenight(options)` is safe during SSR and performs no downloads.
- `initialize()` loads assets, verifies WASM and starts a worker. It returns
  identity, capabilities, normalized settings and asset-cache status. Analysis
  can initialize automatically, but explicit initialization lets the UI show loading.
- `reset()` cancels active work and stops startup/worker execution, retaining
  verified assets and listeners. Pending downloads are aborted when possible.
- `dispose()` also releases assets and listeners. Further analysis rejects until
  `initialize()` explicitly reopens the instance; re-register listeners afterward.

Configure hash memory at creation or with
`initialize({engineOptions: {hashMiB: 16}})`. Changing settings cancels active work.
Optional `initialize({expected: {engineId, buildHash, modelHash}})` checks identity.

`supervision.initializationTimeoutMs` bounds the full startup, including asset
loading, cache access, compilation and worker handshake; default 30,000 ms.
`supervision.nodeOnlyWatchdogMs` defaults to 30,000 ms, with an additional 2,000 ms
response allowance. It also supervises depth searches without a time limit.
A startup timeout rejects even when an adapter ignores its abort signal.

Public failures use `EngineError` with `code` and `retryable`. Codes cover invalid
position/options, failed asset fetch, model mismatch, integrity failure,
unsupported browser, OOM, worker crash and cancellation. A fresh request can
restart the worker after a failure; decide retries in your application.

## Assets, offline use and result caches

Use `chess-engine-assets --to <public-folder>/engines/frozenight` before serving
the app. The CLI verifies shipped assets, removes unchanged obsolete owned files,
and preserves unrelated/modified obsolete files. Use a generated directory.
Subpath deployments should resolve the asset URL against the application base.
Workers and assets must come from the application's origin.

Frozenight's optional CacheStorage caches verified WASM bytes. `offlineAssets`
reports that WASM cache status; it does not prove the worker or page is available
offline. The host owns service workers, offline shell, visibility/native pause
handling, UI and application result storage. Cache failures do not block analysis.

Cache results using the complete root/history, engine identity (including
`engineVersion`, `buildHash`, `adapterHash`, `modelHash` and settings fingerprint),
budget and your application policy version. Budgets across providers do not imply
equivalent strength or search effort.

## Additional providers

`ChessEngine` is independent of Frozenight. `createWorkerEngine(adapter, options)`
provides supervision for implementations of `WorkerEngineAdapter`:

1. Supply descriptor/capabilities and normalize options with `configure`.
2. `loadAssets(signal)` returns `{initialization, offlineAssets}`. Respect its
   optional abort signal. The client posts `initialization` to a fresh worker.
3. Emit `{type: "ready", apiVersion: API_VERSION}` after worker setup.
4. `analysisMessage(request, settings)` produces your worker's input message.
5. Emit the exported `WorkerEngineResponse` union: progress/completed with job ID
   and validated `RawResult`, or failed with a typed error (job ID optional during startup).

Completed results require a supported `reason`; terminal fields must agree with
the actual board state. Progress may omit the reason. A complete nonterminal
iteration contains at least one legal line. An interrupted first iteration may
return no lines with `completedIteration: false` and a time/nodes reason.
JavaScript providers can omit WASM-specific capabilities and model identity.
Only Frozenight ships as a supported adapter today.
