export const API_VERSION = 1 as const;
export type ErrorCode =
  | "INVALID_POSITION"
  | "INVALID_OPTIONS"
  | "ASSET_FETCH_FAILED"
  | "NETWORK_MISMATCH"
  | "INTEGRITY_FAILED"
  | "UNSUPPORTED_BROWSER"
  | "OUT_OF_MEMORY"
  | "ENGINE_CRASHED"
  | "CANCELLED";
export class EngineError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.retryable = retryable;
  }
}
export type Score =
  | {
      perspective: "white";
      kind: "cp";
      value: number;
      bound: "exact" | "lower" | "upper";
    }
  | {
      perspective: "white";
      kind: "mate";
      value: number;
      unit: "plies";
      bound: "exact" | "lower" | "upper";
    };
export type Position = { rootFen: string; movesUci: string[] };
/** At least one supported limit is required; the first reached limit wins. */
export type SearchLimits = {
  maxNodes?: number;
  maxTimeMs?: number;
  maxDepth?: number;
};
export type AnalyzeRequest = {
  apiVersion: 1;
  jobId: string;
  positionId: string;
  position: Position;
  limits: SearchLimits;
  multiPv: number;
  rootMoves?: string[];
};
export type Line = {
  rank: number;
  rootMove: string;
  pv: string[];
  score: Score;
};
export type RawResult = {
  lines: Line[];
  depth: number | null;
  nodes: number | null;
  iterationNodes?: number | null;
  completedIteration: boolean;
  reason?: "time" | "nodes" | "depth" | "terminal";
  outcome?:
    | "checkmate"
    | "stalemate"
    | "repetition"
    | "fifty-move"
    | "insufficient-material";
  winner?: "white" | "black" | null;
  terminalScore?: Score;
  error?: ErrorCode;
};
/** Model-free engines omit modelHash; identity describes the exact provider build. */
export type EngineDescriptor = {
  engineId: string;
  engineName: string;
  engineVersion: string;
  sourceRevision?: string;
  buildHash: string;
  modelHash?: string;
  /** Hash of the provider's worker/normalization implementation, when available. */
  adapterHash?: string;
};
export type Identity = EngineDescriptor & { settingsFingerprint: string };
export type IntegerRange = { min: number; max: number };
export type EngineCapabilities = {
  backend: "wasm" | "javascript" | "native";
  threads: number;
  sharedMemory: boolean;
  maxMultiPv: number;
  history: "full" | "fen-only";
  rootMoves: boolean;
  limits: { nodes?: IntegerRange; timeMs?: IntegerRange; depth?: IntegerRange };
  hashMemoryMiB?: IntegerRange;
  maximumLinearMemoryMiB?: number;
};
export type EngineOptions = Readonly<
  Record<string, string | number | boolean | null>
>;
export type InitializeConfig = {
  apiVersion?: number;
  expected?: { engineId?: string; buildHash?: string; modelHash?: string };
  engineOptions?: EngineOptions;
};
export type NormalizedSettings = { values: EngineOptions; fingerprint: string };
export type EngineReady = Identity & {
  apiVersion: 1;
  capabilities: EngineCapabilities;
  settings: EngineOptions;
  /** Provider asset-cache status; Frozenight caches WASM only, not the page or worker. */
  offlineAssets: boolean;
};
export type AnalysisResult = RawResult &
  Identity & {
    apiVersion: 1;
    jobId: string;
    positionId: string;
    elapsedMs: number;
    completion: "completed" | "limited" | "progress";
    sequence: number;
    memoryBytes?: number | null;
  };
export type EngineEvent =
  | ({
      type: "progress" | "completed";
      result: AnalysisResult;
    } & AnalysisResult)
  | ({
      type: "failed" | "cancelled";
      apiVersion: 1;
      jobId: string;
      positionId: string;
      error: { code: ErrorCode; retryable: boolean; message: string };
      elapsedMs: number;
      nodes: number | null;
      depth: number | null;
      completion: "cancelled" | "failed";
      lines: Line[];
      completedIteration: boolean;
    } & Identity);
export type CancelAcknowledgement = {
  jobId: string;
  status: "stopped" | "already-finished" | "unknown";
};
export interface ChessEngine {
  readonly descriptor: Readonly<EngineDescriptor>;
  readonly capabilities: Readonly<EngineCapabilities>;
  readonly identity: Identity;
  initialize(config?: InitializeConfig): Promise<EngineReady>;
  analyzePosition(request: AnalyzeRequest): Promise<AnalysisResult>;
  cancel(jobId: string): CancelAcknowledgement;
  onEvent(listener: (event: EngineEvent) => void): () => void;
  reset(): void;
  dispose(): void;
}
/** Adapter authors normalize their engine's wire output to RawResult. No UI or framework dependency. */
export interface WorkerEngineAdapter {
  readonly descriptor: Readonly<EngineDescriptor>;
  readonly capabilities: Readonly<EngineCapabilities>;
  configure(options: EngineOptions): NormalizedSettings;
  validateRequest?(request: AnalyzeRequest, settings: NormalizedSettings): void;
  loadAssets(
    signal?: AbortSignal,
  ): Promise<{ initialization: unknown; offlineAssets: boolean }>;
  createWorker(): Worker;
  analysisMessage(
    request: AnalyzeRequest,
    settings: NormalizedSettings,
  ): unknown;
}
export type WorkerClientOptions = {
  /** Full asset-loading, compilation and worker startup deadline; default 30,000 ms. */
  initializationTimeoutMs?: number;
  nodeOnlyWatchdogMs?: number;
};
export type AssetEntry = { file: string; sha256: string; bytes: number };
/** Normalized messages emitted by a provider worker to createWorkerEngine. */
export type WorkerEngineResponse =
  | { type: "ready"; apiVersion: 1 }
  | {
      type: "progress" | "completed";
      jobId: string;
      result: RawResult;
      memoryBytes?: number | null;
    }
  | {
      type: "failed";
      jobId?: string;
      error: { code: ErrorCode; message: string; retryable: boolean };
    };
export type EngineAssetManifest = {
  apiVersion: 1;
  packageVersion: string;
  descriptor: EngineDescriptor;
  wasm: AssetEntry;
  worker: AssetEntry;
  notices: AssetEntry[];
  toolchain: string;
  maximumLinearMemoryMiB: number;
};
