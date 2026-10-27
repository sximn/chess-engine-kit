import {
  API_VERSION,
  EngineError,
  type AnalyzeRequest,
  type AnalysisResult,
  type ChessEngine,
  type EngineReady,
  type InitializeConfig,
  type NormalizedSettings,
  type WorkerEngineAdapter,
  type WorkerClientOptions,
  type EngineEvent,
  type Identity,
  type ErrorCode,
} from "./types.js";
import { validateRequest, validateResult } from "./validation.js";

type Job = {
  request: AnalyzeRequest;
  resolve: (value: AnalysisResult) => void;
  reject: (error: EngineError) => void;
  started: number;
  sequence: number;
  last?: AnalysisResult;
  timer?: ReturnType<typeof setTimeout>;
};
export class WorkerEngineClient implements ChessEngine {
  private worker?: Worker;
  private generation = 0;
  private startup?: Promise<void>;
  private assets?: ReturnType<WorkerEngineAdapter["loadAssets"]>;
  private active?: Job;
  private listeners = new Set<(event: EngineEvent) => void>();
  private finished = new Set<string>();
  private settings: NormalizedSettings;
  private offlineAssets = false;
  private rejectStartup?: (error: EngineError) => void;
  private disposed = false;
  private adapter: WorkerEngineAdapter;
  private supervision: WorkerClientOptions;
  constructor(
    adapter: WorkerEngineAdapter,
    supervision: WorkerClientOptions = {},
  ) {
    this.adapter = adapter;
    this.supervision = supervision;
    this.settings = structuredClone(adapter.configure({}));
  }
  get descriptor() {
    return this.adapter.descriptor;
  }
  get capabilities() {
    return this.adapter.capabilities;
  }
  get identity(): Identity {
    return {
      ...this.descriptor,
      settingsFingerprint: this.settings.fingerprint,
    };
  }
  onEvent(listener: (event: EngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: EngineEvent) {
    if (this.disposed) return;
    for (const listener of this.listeners)
      try {
        listener(event);
      } catch {
        /* Consumer errors cannot break engine supervision. */
      }
  }
  async initialize(config: InitializeConfig = {}): Promise<EngineReady> {
    if (config.apiVersion !== undefined && config.apiVersion !== API_VERSION)
      throw new EngineError(
        "INVALID_OPTIONS",
        "Unsupported analysis API version.",
      );
    if (
      config.expected?.engineId &&
      config.expected.engineId !== this.descriptor.engineId
    )
      throw new EngineError("INVALID_OPTIONS", "Unexpected engine provider.");
    if (
      config.expected?.buildHash &&
      config.expected.buildHash !== this.descriptor.buildHash
    )
      throw new EngineError(
        "INTEGRITY_FAILED",
        "The engine build is incompatible.",
      );
    if (
      config.expected?.modelHash &&
      config.expected.modelHash !== this.descriptor.modelHash
    )
      throw new EngineError(
        "NETWORK_MISMATCH",
        "The engine model is incompatible.",
      );
    const settings = config.engineOptions
      ? structuredClone(
          this.adapter.configure(structuredClone(config.engineOptions)),
        )
      : this.settings;
    this.disposed = false;
    if (settings.fingerprint !== this.settings.fingerprint) {
      if (this.active) this.cancel(this.active.request.jobId);
      this.dropWorker();
      this.settings = settings;
    }
    try {
      await this.ensureWorker();
    } catch (error) {
      throw error instanceof EngineError
        ? error
        : new EngineError(
            "ENGINE_CRASHED",
            "The engine could not initialize.",
            true,
          );
    }
    return {
      ...this.identity,
      apiVersion: API_VERSION,
      capabilities: this.capabilities,
      settings: { ...this.settings.values },
      offlineAssets: this.offlineAssets,
    };
  }
  analyzePosition(request: AnalyzeRequest): Promise<AnalysisResult> {
    let accepted: AnalyzeRequest;
    try {
      validateRequest(request, this.capabilities);
      this.adapter.validateRequest?.(request, this.settings);
      accepted = structuredClone(request);
      if (this.disposed)
        throw new EngineError(
          "CANCELLED",
          "The engine has been disposed.",
          true,
        );
    } catch (error) {
      return Promise.reject(
        error instanceof EngineError
          ? error
          : new EngineError(
              "INVALID_OPTIONS",
              "Request must contain cloneable analysis data.",
            ),
      );
    }
    if (this.active) this.cancel(this.active.request.jobId);
    // Clone accepted input so the caller cannot mutate a queued position/history.

    return new Promise((resolve, reject) => {
      const job: Job = {
        request: accepted,
        resolve,
        reject,
        started: performance.now(),
        sequence: 0,
      };
      this.active = job;
      void this.ensureWorker()
        .then(() => {
          if (this.active !== job) return;
          job.timer = setTimeout(
            () =>
              this.fail(
                new EngineError(
                  "ENGINE_CRASHED",
                  "The engine exceeded its response deadline. Retry analysis.",
                  true,
                ),
              ),
            (accepted.limits.maxTimeMs ??
              this.supervision.nodeOnlyWatchdogMs ??
              30_000) + 2000,
          );
          this.worker!.postMessage(
            this.adapter.analysisMessage(accepted, this.settings),
          );
        })
        .catch((error) => {
          if (this.active === job)
            this.fail(
              error instanceof EngineError
                ? error
                : new EngineError(
                    "ENGINE_CRASHED",
                    "The engine could not start.",
                    true,
                  ),
            );
        });
    });
  }
  cancel(jobId: string): {
    jobId: string;
    status: "stopped" | "already-finished" | "unknown";
  } {
    const job = this.active;
    if (!job || job.request.jobId !== jobId)
      return {
        jobId,
        status: this.finished.has(jobId) ? "already-finished" : "unknown",
      };
    clearTimeout(job.timer);
    this.active = undefined;
    this.remember(jobId);
    this.dropWorker();
    const error = new EngineError("CANCELLED", "Analysis was cancelled.", true);
    this.emit({
      type: "cancelled",
      apiVersion: 1,
      jobId,
      positionId: job.request.positionId,
      error: { code: error.code, message: error.message, retryable: true },
      ...this.identity,
      elapsedMs: performance.now() - job.started,
      nodes: job.last?.nodes ?? null,
      depth: job.last?.depth ?? null,
      lines: job.last?.lines ?? [],
      completedIteration: !!job.last?.completedIteration,
      completion: "cancelled",
    });
    job.reject(error);
    return { jobId, status: "stopped" };
  }
  reset() {
    if (this.active) this.cancel(this.active.request.jobId);
    this.dropWorker();
    this.finished.clear();
  }
  dispose() {
    if (this.active) this.cancel(this.active.request.jobId);
    this.dropWorker();
    this.assets = undefined;
    this.disposed = true;
    this.listeners.clear();
    this.finished.clear();
  }
  private remember(id: string) {
    this.finished.add(id);
    if (this.finished.size > 128)
      this.finished.delete(this.finished.values().next().value!);
  }
  private dropWorker() {
    this.generation++;
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = undefined;
    this.rejectStartup?.(
      new EngineError("CANCELLED", "Engine startup was cancelled.", true),
    );
    this.rejectStartup = undefined;
    this.startup = undefined;
  }
  private fail(cause: unknown) {
    const error =
      cause instanceof EngineError
        ? cause
        : new EngineError(
            "ENGINE_CRASHED",
            "The engine returned malformed analysis data.",
            true,
          );
    const job = this.active;
    this.active = undefined;
    this.dropWorker();
    if (!job) return;
    clearTimeout(job.timer);
    this.remember(job.request.jobId);
    this.emit({
      type: error.code === "CANCELLED" ? "cancelled" : "failed",
      apiVersion: 1,
      jobId: job.request.jobId,
      positionId: job.request.positionId,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
      ...this.identity,
      elapsedMs: performance.now() - job.started,
      nodes: job.last?.nodes ?? null,
      depth: job.last?.depth ?? null,
      lines: job.last?.lines ?? [],
      completedIteration: !!job.last?.completedIteration,
      completion: error.code === "CANCELLED" ? "cancelled" : "failed",
    });
    job.reject(error);
  }
  private ensureWorker(): Promise<void> {
    if (this.worker && !this.startup) return Promise.resolve();
    if (this.startup) return this.startup;
    const generation = this.generation;
    const run = async () => {
      if (!this.assets) {
        const loading = this.adapter.loadAssets().catch((error) => {
          if (this.assets === loading) this.assets = undefined;
          throw error;
        });
        this.assets = loading;
      }
      const asset = await this.assets;
      if (this.disposed || generation !== this.generation)
        throw new EngineError(
          "CANCELLED",
          "Engine startup was cancelled.",
          true,
        );
      this.offlineAssets = asset.offlineAssets;
      const worker = this.adapter.createWorker();
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.fail(
            new EngineError(
              "ENGINE_CRASHED",
              "The engine did not initialize.",
              true,
            ),
          );
          reject(
            new EngineError(
              "ENGINE_CRASHED",
              "The engine did not initialize.",
              true,
            ),
          );
        }, this.supervision.initializationTimeoutMs ?? 5000);
        const ready = () => {
          clearTimeout(timeout);
          this.rejectStartup = undefined;
          resolve();
        };
        this.rejectStartup = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
        worker.onerror = () => {
          clearTimeout(timeout);
          this.fail(
            new EngineError(
              "ENGINE_CRASHED",
              "The local engine worker stopped unexpectedly.",
              true,
            ),
          );
          reject(
            new EngineError(
              "ENGINE_CRASHED",
              "The local engine worker stopped unexpectedly.",
              true,
            ),
          );
        };
        worker.onmessageerror = () => {
          clearTimeout(timeout);
          this.fail(
            new EngineError(
              "ENGINE_CRASHED",
              "The engine communication failed.",
              true,
            ),
          );
          reject(
            new EngineError(
              "ENGINE_CRASHED",
              "The engine communication failed.",
              true,
            ),
          );
        };
        worker.onmessage = ({ data }) => {
          if (generation !== this.generation || this.disposed) return;
          const codes = [
            "INVALID_POSITION",
            "INVALID_OPTIONS",
            "ASSET_FETCH_FAILED",
            "NETWORK_MISMATCH",
            "INTEGRITY_FAILED",
            "UNSUPPORTED_BROWSER",
            "OUT_OF_MEMORY",
            "ENGINE_CRASHED",
            "CANCELLED",
          ];
          if (
            !data ||
            typeof data !== "object" ||
            (data.type === "failed" &&
              (!data.error ||
                !codes.includes(data.error.code) ||
                typeof data.error.message !== "string" ||
                typeof data.error.retryable !== "boolean"))
          ) {
            this.fail(
              new EngineError(
                "ENGINE_CRASHED",
                "The worker returned an invalid protocol message.",
                true,
              ),
            );
            return;
          }
          if (data.type === "ready") {
            if (data.apiVersion !== API_VERSION) {
              this.fail(
                new EngineError(
                  "ENGINE_CRASHED",
                  "Engine API version mismatch.",
                  true,
                ),
              );
              return;
            }
            ready();
            return;
          }
          if (data.type === "failed" && !data.jobId) {
            const error = new EngineError(
              data.error.code,
              data.error.message,
              data.error.retryable,
            );
            clearTimeout(timeout);
            this.fail(error);
            reject(error);
            return;
          }
          const job = this.active;
          if (!job || data.jobId !== job.request.jobId) return;
          if (data.type === "failed") {
            this.fail(
              new EngineError(
                data.error.code as ErrorCode,
                data.error.message,
                data.error.retryable,
              ),
            );
            return;
          }
          if (data.type !== "progress" && data.type !== "completed") return;
          try {
            validateResult(
              data.result,
              job.request.position,
              job.request.multiPv,
              job.request.rootMoves,
            );
          } catch (error) {
            this.fail(error as EngineError);
            return;
          }
          const result: AnalysisResult = {
            ...data.result,
            ...this.identity,
            apiVersion: 1,
            jobId: job.request.jobId,
            positionId: job.request.positionId,
            elapsedMs: performance.now() - job.started,
            completion:
              data.type === "progress"
                ? "progress"
                : data.result.reason === "depth" ||
                    data.result.reason === "terminal"
                  ? "completed"
                  : "limited",
            sequence: ++job.sequence,
            memoryBytes: data.memoryBytes,
          };
          if (data.type === "progress") {
            job.last = result;
            this.emit({ type: "progress", result, ...result });
            return;
          }
          clearTimeout(job.timer);
          this.active = undefined;
          this.remember(job.request.jobId);
          this.emit({ type: "completed", result, ...result });
          job.resolve(result);
        };
        try {
          worker.postMessage(asset.initialization);
        } catch {
          clearTimeout(timeout);
          reject(
            new EngineError(
              "UNSUPPORTED_BROWSER",
              "This browser cannot start a local engine worker.",
            ),
          );
        }
      });
    };
    const pending = run();
    this.startup = pending;
    void pending.then(
      () => {
        if (this.startup === pending) this.startup = undefined;
      },
      () => {
        if (this.startup === pending) {
          this.worker?.terminate();
          this.worker = undefined;
          this.startup = undefined;
        }
      },
    );
    return pending;
  }
}

export function createWorkerEngine(
  adapter: WorkerEngineAdapter,
  options?: WorkerClientOptions,
): ChessEngine {
  return new WorkerEngineClient(adapter, options);
}
