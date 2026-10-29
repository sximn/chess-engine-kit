import {
  API_VERSION,
  EngineError,
  createFrozenight,
  type AnalysisResult,
  type Score,
} from "chess-engine-kit";

const engine = createFrozenight({ hashMiB: 16 });
const form = document.querySelector<HTMLFormElement>("#analysis")!;
const fen = document.querySelector<HTMLTextAreaElement>("#fen")!;
const moves = document.querySelector<HTMLInputElement>("#moves")!;
const analyze = document.querySelector<HTMLButtonElement>("#analyze")!;
const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#result")!;
let activeJobId: string | undefined;

function formatScore(score: Score): string {
  if (score.kind === "mate") {
    const winner = score.value > 0 ? "White" : "Black";
    return `${winner} mates in ${Math.abs(score.value)} plies`;
  }
  const bound =
    score.bound === "lower" ? ">=" : score.bound === "upper" ? "<=" : "";
  return `${bound}${score.value >= 0 ? "+" : ""}${(score.value / 100).toFixed(2)} pawns`;
}

function render(result: AnalysisResult): void {
  if (result.outcome) {
    output.textContent = `${result.outcome}${result.winner ? ` — ${result.winner} wins` : " — draw"}`;
    return;
  }
  output.textContent = result.lines.length
    ? result.lines
        .map(
          (line) =>
            `${line.rank}. ${formatScore(line.score)} | ${line.pv.join(" ")}`,
        )
        .join("\n")
    : "No complete search iteration yet. Try again with a larger budget.";
  status.textContent = `Depth ${result.depth ?? "unknown"} · ${result.nodes ?? "unknown"} nodes · ${result.completion}`;
}

const unsubscribe = engine.onEvent((event) => {
  if (event.type === "progress" && event.jobId === activeJobId)
    render(event.result);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (activeJobId) return;
  const jobId = crypto.randomUUID();
  activeJobId = jobId;
  // Capture input before the asynchronous initialization.
  const position = {
    rootFen: fen.value.trim(),
    movesUci: moves.value.trim().split(/\s+/).filter(Boolean),
  };
  analyze.disabled = true;
  status.textContent = "Loading engine…";
  output.textContent = "";
  try {
    await engine.initialize();
    status.textContent = "Analyzing…";
    cancel.disabled = false;
    const result = await engine.analyzePosition({
      apiVersion: API_VERSION,
      jobId,
      positionId: "input-position",
      position,
      limits: { maxNodes: 100_000, maxTimeMs: 1500 },
      multiPv: 3,
    });
    render(result);
    if (result.outcome) status.textContent = "Game over";
    else if (result.completion === "limited")
      status.textContent += " · search budget reached";
  } catch (error) {
    status.textContent =
      error instanceof EngineError
        ? error.code === "CANCELLED"
          ? "Analysis cancelled"
          : `${error.code}: ${error.message}`
        : String(error);
  } finally {
    activeJobId = undefined;
    analyze.disabled = false;
    cancel.disabled = true;
  }
});

cancel.addEventListener("click", () => {
  if (activeJobId) engine.cancel(activeJobId);
});

// A framework component should do the same in its unmount/destroy callback.
window.addEventListener("pagehide", () => engine.reset());
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    unsubscribe();
    engine.dispose();
  });
