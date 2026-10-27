import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
// Check against the source API without requiring dist during bun check.
// At runtime these contract tests still exercise the built package.
const {
  createWorkerEngine,
  createFrozenight,
  EngineError,
}: typeof import("../src/index.ts") = await import(
  new URL("../dist/index.js", import.meta.url).href
);
import type {
  AnalyzeRequest,
  EngineEvent,
  WorkerEngineAdapter,
  WorkerClientOptions,
} from "../src/core/types.ts";
class FakeWorker {
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onmessageerror: ((e: any) => void) | null = null;
  terminated = false;
  request?: AnalyzeRequest;
  postMessage(data: any) {
    if (data.type === "initialize")
      queueMicrotask(() =>
        this.onmessage?.({ data: { type: "ready", apiVersion: 1 } }),
      );
    else this.request = data.request;
  }
  terminate() {
    this.terminated = true;
  }
  finish(handler = this.onmessage) {
    handler?.({
      data: {
        type: "completed",
        jobId: this.request!.jobId,
        result: {
          lines: [
            {
              rank: 1,
              rootMove: "e2e4",
              pv: ["e2e4"],
              score: {
                perspective: "white",
                kind: "cp",
                value: 20,
                bound: "exact",
              },
            },
          ],
          depth: 1,
          nodes: 20,
          iterationNodes: 20,
          completedIteration: true,
          reason: "depth",
        },
      },
    });
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const request = (id: string): AnalyzeRequest => ({
  apiVersion: 1,
  jobId: id,
  positionId: "position-" + id,
  position: { rootFen: new Chess().fen(), movesUci: [] },
  limits: { maxNodes: 1000, maxTimeMs: 100 },
  multiPv: 1,
});
function setup(
  loadAssets?: WorkerEngineAdapter["loadAssets"],
  javascript = false,
  supervision?: WorkerClientOptions,
) {
  const workers: FakeWorker[] = [];
  const adapter: WorkerEngineAdapter = {
    descriptor: {
      engineId: javascript ? "js-test" : "test",
      engineName: "Test",
      engineVersion: "1",
      buildHash: "test-build",
    },
    capabilities: {
      backend: javascript ? "javascript" : "wasm",
      threads: 1,
      sharedMemory: false,
      maxMultiPv: 1,
      history: "full",
      rootMoves: true,
      limits: {
        timeMs: { min: 10, max: 1000 },
        ...(javascript ? {} : { nodes: { min: 1000, max: 100000 } }),
      },
    },
    configure: (options) => ({
      values: options,
      fingerprint: JSON.stringify(options),
    }),
    loadAssets:
      loadAssets ??
      (async () => ({
        initialization: { type: "initialize" },
        offlineAssets: true,
      })),
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
    analysisMessage: (request) => ({ type: "analyze", request }),
  };
  const client = createWorkerEngine(adapter, supervision);
  const events: EngineEvent[] = [];
  client.onEvent((e) => events.push(e));
  return { client, workers, events };
}
test("100 cancellations have exactly one terminal event and reject captured stale completions", async () => {
  const { client, workers, events } = setup();
  await client.initialize();
  for (let i = 0; i < 100; i++) {
    const cancelled = client
      .analyzePosition(request("old-" + i))
      .catch((e) => e);
    await tick();
    const old = workers.at(-1)!,
      handler = old.onmessage;
    assert.equal(client.cancel("old-" + i).status, "stopped");
    assert.equal(old.onmessage, null);
    assert.equal(old.onerror, null);
    assert.equal((await cancelled).code, "CANCELLED");
    old.finish(handler);
    const done = client.analyzePosition(request("next-" + i));
    await tick();
    workers.at(-1)!.finish();
    assert.equal((await done).jobId, "next-" + i);
    assert.equal(client.cancel("next-" + i).status, "already-finished");
  }
  assert.equal(events.filter((e) => e.type !== "progress").length, 200);
  assert.equal(new Set(events.map((e) => e.jobId)).size, 200);
  client.dispose();
});
test("crashes synthesize a terminal failure and recover on the next search", async () => {
  const { client, workers, events } = setup();
  await client.initialize();
  const failed = client.analyzePosition(request("crash")).catch((e) => e);
  await tick();
  workers.at(-1)!.onerror?.({});
  assert.equal((await failed).code, "ENGINE_CRASHED");
  assert.equal(events.at(-1)!.type, "failed");
  const next = client.analyzePosition(request("recover"));
  await tick();
  workers.at(-1)!.finish();
  await next;
  client.dispose();
  await client.initialize();
  client.dispose();
});
test("invalid identities, options and uncloneable input cannot disturb valid work", async () => {
  const { client, workers } = setup();
  await assert.rejects(
    client.initialize({ expected: { buildHash: "bad" } }),
    (e) => e instanceof EngineError && e.code === "INTEGRITY_FAILED",
  );
  await client.initialize();
  const good = client.analyzePosition(request("good"));
  await tick();
  await assert.rejects(
    client.analyzePosition({ ...request("bad"), multiPv: 2 }),
  );
  await assert.rejects(
    client.analyzePosition({
      ...request("clone"),
      extension: () => {},
    } as AnalyzeRequest),
  );
  workers.at(-1)!.finish();
  assert.equal((await good).jobId, "good");
  client.dispose();
  assert.throws(
    () => createFrozenight({ hashMiB: 128 }),
    (e) => e instanceof EngineError && e.code === "INVALID_OPTIONS",
  );
});
test("disposed asset-load rejection cannot clear the new generation module", async () => {
  let loads = 0,
    rejectOld!: (e: Error) => void;
  const { client } = setup(() =>
    ++loads === 1
      ? new Promise((_, reject) => (rejectOld = reject))
      : Promise.resolve({
          initialization: { type: "initialize" },
          offlineAssets: true,
        }),
  );
  const old = client.initialize().catch((e) => e);
  await tick();
  client.dispose();
  await client.initialize();
  rejectOld(new EngineError("ASSET_FETCH_FAILED", "old failure", true));
  assert.equal((await old).code, "CANCELLED");
  client.reset();
  await client.initialize();
  assert.equal(loads, 2);
  client.dispose();
});

test(
  "replacement listeners can start another job without orphaning either request",
  { timeout: 2000 },
  async () => {
    const { client, workers, events } = setup();
    await client.initialize();
    let queued!: Promise<unknown>;
    client.onEvent((event) => {
      if (event.type === "cancelled" && event.jobId === "a")
        queued = client.analyzePosition(request("c"));
    });
    const a = client.analyzePosition(request("a")).catch((error) => error.code);
    await tick();
    const b = client.analyzePosition(request("b")).catch((error) => error.code);
    await tick();
    workers.at(-1)!.finish();
    assert.equal(await a, "CANCELLED");
    assert.equal(await b, "CANCELLED");
    assert.equal(((await queued) as { jobId: string }).jobId, "c");
    assert.deepEqual(
      events.map((event) => [event.type, event.jobId]),
      [
        ["cancelled", "a"],
        ["cancelled", "b"],
        ["completed", "c"],
      ],
    );
    client.dispose();
  },
);

test(
  "reset, reconfiguration and disposal finish before cancellation listeners run",
  { timeout: 2000 },
  async () => {
    for (const action of ["reset", "configure", "dispose"] as const) {
      const { client, workers, events } = setup();
      await client.initialize();
      const old = client
        .analyzePosition(request("old"))
        .catch((error) => error.code);
      await tick();
      let next!: Promise<any>;
      client.onEvent((event) => {
        if (event.type === "cancelled")
          next = client
            .analyzePosition(request("next"))
            .catch((error) => error);
      });
      if (action === "configure")
        await client.initialize({ engineOptions: { size: 2 } });
      else client[action]();
      assert.equal(await old, "CANCELLED");
      await tick();
      if (action === "dispose") {
        assert.equal((await next).code, "CANCELLED");
        assert.equal(events.length, 1);
      } else {
        workers.at(-1)!.finish();
        assert.equal((await next).jobId, "next");
        assert.equal(
          events.filter((event) => event.type !== "progress").length,
          2,
        );
      }
      client.dispose();
    }
  },
);

test(
  "the startup deadline bounds asset loading, aborts it, and permits retry",
  { timeout: 2000 },
  async () => {
    let attempts = 0;
    let signal: AbortSignal | undefined;
    const { client, workers, events } = setup(
      async (abortSignal) => {
        if (++attempts === 1) {
          signal = abortSignal;
          return new Promise(() => {});
        }
        return { initialization: { type: "initialize" }, offlineAssets: false };
      },
      false,
      { initializationTimeoutMs: 20 },
    );
    await assert.rejects(
      client.analyzePosition(request("startup")),
      (error: any) => error.code === "ENGINE_CRASHED",
    );
    assert.equal(signal?.aborted, true);
    assert.equal(events.filter((event) => event.type === "failed").length, 1);
    await client.initialize();
    const result = client.analyzePosition(request("retry"));
    await tick();
    workers.at(-1)!.finish();
    await result;
    client.dispose();
  },
);

test(
  "dispose settles initialization even when the provider ignores abort",
  { timeout: 2000 },
  async () => {
    const { client } = setup(() => new Promise(() => {}));
    const initialization = client.initialize().catch((error) => error);
    await tick();
    client.dispose();
    assert.equal((await initialization).code, "CANCELLED");
  },
);

test("listeners cannot mutate another listener's data or the resolved result", async () => {
  const { client, workers } = setup();
  await client.initialize();
  client.onEvent((event) => {
    if (event.type === "completed") event.result.lines[0].score.value = 999;
  });
  let observed: number | undefined;
  client.onEvent((event) => {
    if (event.type === "completed")
      observed = event.result.lines[0].score.value;
  });
  const pending = client.analyzePosition(request("snapshot"));
  await tick();
  workers.at(-1)!.finish();
  assert.equal((await pending).lines[0].score.value, 20);
  assert.equal(observed, 20);
  client.dispose();
});

test("malformed completion metadata fails closed while an empty budget result is valid", async () => {
  const base = {
    lines: [],
    depth: 0,
    nodes: 0,
    completedIteration: false,
    reason: "time",
  };
  for (const result of [
    {
      ...base,
      reason: "terminal",
      winner: "purple",
      terminalScore: { kind: "nonsense" },
    },
    { ...base, reason: "nonsense" },
    { ...base, reason: undefined },
    { ...base, reason: "depth" },
    { ...base, completedIteration: true },
    { ...base, outcome: "checkmate" },
  ]) {
    const { client, workers, events } = setup();
    await client.initialize();
    const pending = client
      .analyzePosition(request("invalid"))
      .catch((error) => error);
    await tick();
    workers.at(-1)!.onmessage!({
      data: { type: "completed", jobId: "invalid", result },
    });
    assert.equal((await pending).code, "ENGINE_CRASHED");
    assert.equal(events.at(-1)!.type, "failed");
    client.dispose();
  }
  const { client, workers } = setup();
  await client.initialize();
  const pending = client.analyzePosition(request("limited"));
  await tick();
  workers.at(-1)!.onmessage!({
    data: { type: "completed", jobId: "limited", result: base },
  });
  assert.equal((await pending).completion, "limited");
  client.dispose();
});

test("terminal mate scores require plies and the correct winner", async () => {
  const fen = "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1";
  for (const unit of [undefined, "moves", "plies"]) {
    const { client, workers } = setup();
    await client.initialize();
    const pending = client
      .analyzePosition({
        ...request("mate"),
        position: { rootFen: fen, movesUci: [] },
      })
      .catch((error) => error);
    await tick();
    workers.at(-1)!.onmessage!({
      data: {
        type: "completed",
        jobId: "mate",
        result: {
          lines: [],
          depth: 0,
          nodes: 0,
          completedIteration: true,
          reason: "terminal",
          outcome: "checkmate",
          winner: "white",
          terminalScore: {
            kind: "mate",
            value: 0,
            perspective: "white",
            bound: "exact",
            unit,
          },
        },
      },
    });
    const result = await pending;
    assert.equal(
      unit === "plies" ? result.outcome : result.code,
      unit === "plies" ? "checkmate" : "ENGINE_CRASHED",
    );
    client.dispose();
  }
});
test("model-free JavaScript adapter works with a time-only budget through the same API", async () => {
  const { client, workers } = setup(undefined, true);
  const ready = await client.initialize();
  assert.equal(ready.capabilities.backend, "javascript");
  assert.equal(ready.modelHash, undefined);
  assert.equal(ready.capabilities.maximumLinearMemoryMiB, undefined);
  await assert.rejects(
    client.analyzePosition(request("unsupported-nodes")),
    /Unsupported search limit/,
  );
  const done = client.analyzePosition({
    ...request("js"),
    limits: { maxTimeMs: 100 },
  });
  await tick();
  workers.at(-1)!.finish();
  const result = await done;
  assert.equal(result.engineId, "js-test");
  assert.equal(result.lines[0].score.perspective, "white");
  client.dispose();
});
test("SSR can import the package and create an uninitialized adapter without browser globals", () => {
  const engine = createFrozenight();
  assert.equal(engine.descriptor.engineId, "frozenight");
  engine.dispose();
});

test("malformed worker messages and results become typed terminal failures", async () => {
  for (const message of [
    null,
    {
      type: "failed",
      jobId: "bad-wire",
      error: { code: "UNKNOWN", message: "bad", retryable: true },
    },
    {
      type: "completed",
      jobId: "bad-wire",
      result: {
        lines: [{ rank: 1 }],
        depth: 1,
        nodes: 20,
        completedIteration: true,
      },
    },
  ]) {
    const { client, workers, events } = setup();
    await client.initialize();
    const pending = client.analyzePosition(request("bad-wire")).catch((e) => e);
    await tick();
    workers.at(-1)!.onmessage?.({ data: message });
    const error = await pending;
    assert.ok(error instanceof EngineError);
    assert.equal(error.code, "ENGINE_CRASHED");
    assert.equal(events.filter((e) => e.type === "failed").length, 1);
    client.dispose();
  }
});

test("unexpected adapter initialization errors are normalized to the public error type", async () => {
  const { client } = setup(async () => {
    throw new Error("adapter failure");
  });
  await assert.rejects(
    client.initialize(),
    (error) => error instanceof EngineError && error.code === "ENGINE_CRASHED",
  );
  client.dispose();
});
