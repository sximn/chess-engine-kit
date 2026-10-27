import {
  createFrozenight,
  API_VERSION,
  type ChessEngine,
  type EngineEvent,
  type AnalyzeRequest,
} from "@upapawn/chess-engine-runtime";
import { Capacitor } from "@capacitor/core";
const ROOT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const base = new URL("./engines/frozenight/", document.baseURI);
const make = (jobId: string, multiPv = 3): AnalyzeRequest => ({
  apiVersion: API_VERSION,
  jobId,
  positionId: jobId,
  position: { rootFen: ROOT, movesUci: [] },
  limits: { maxNodes: 10000, maxTimeMs: 1000, maxDepth: 3 },
  multiPv,
});
async function smoke(cycles = 1) {
  const engine: ChessEngine = createFrozenight({
    assetBaseUrl: base,
    hashMiB: 16,
  });
  const events: EngineEvent[] = [];
  engine.onEvent((e) => events.push(e));
  try {
    const ready = await engine.initialize();
    const result = await engine.analyzePosition(make("multipv"));
    if (
      result.lines.length !== 3 ||
      new Set(result.lines.map((l) => l.rootMove)).size !== 3
    )
      throw Error("Distinct MultiPV roots missing");
    const repetition = await engine.analyzePosition({
      ...make("repetition", 1),
      position: {
        rootFen: ROOT,
        movesUci: [
          "g1f3",
          "g8f6",
          "f3g1",
          "f6g8",
          "g1f3",
          "g8f6",
          "f3g1",
          "f6g8",
        ],
      },
    });
    if (repetition.outcome !== "repetition") throw Error("History was lost");
    const cancelled: string[] = [];
    for (let i = 0; i < cycles; i++) {
      const job = {
        ...make("cancel-" + i),
        limits: { maxNodes: 1000000, maxTimeMs: 2000 },
      };
      const pending = engine.analyzePosition(job).catch((e) => e);
      await new Promise((r) => setTimeout(r, 2));
      if (engine.cancel(job.jobId).status !== "stopped")
        throw Error("Cancellation acknowledgement failed");
      if ((await pending).code !== "CANCELLED")
        throw Error("Cancellation lost");
      cancelled.push(job.jobId);
      await engine.analyzePosition({
        ...make("next-" + i, 1),
        limits: { maxNodes: 1000, maxTimeMs: 1000, maxDepth: 1 },
      });
      if (i % 10 === 9) engine.reset();
    }
    const terminal = events.filter((e) => e.type !== "progress");
    if (
      terminal.length !== 2 + cycles * 2 ||
      new Set(terminal.map((e) => e.jobId)).size !== terminal.length
    )
      throw Error("Terminal-event contract failed");
    return {
      ready,
      result,
      repetition,
      cycles,
      terminalEvents: terminal.length,
      cancelled,
      baseUrl: String(base),
      sharedMemory: ready.capabilities.sharedMemory,
    };
  } finally {
    engine.dispose();
  }
}
async function run() {
  const status = document.querySelector("#status")!,
    output = document.querySelector("#output")!;
  status.textContent = "Running";
  try {
    const result = await smoke(1);
    output.textContent = JSON.stringify(result, null, 2);
    status.textContent = "All checks passed";
  } catch (e) {
    status.textContent = e instanceof Error ? e.message : String(e);
  }
}
Object.assign(window, { runEngineSmoke: smoke });
document.querySelector("#run")!.addEventListener("click", () => void run());
if (Capacitor.isNativePlatform()) void run();
else if ("serviceWorker" in navigator)
  void navigator.serviceWorker
    .register(new URL("./service-worker.js", document.baseURI))
    .catch(() => {});
