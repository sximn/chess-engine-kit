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
  private eventQueue: {
    event: EngineEvent;
    listeners: Set<(event: EngineEvent) => void>;
  }[] = [];
  private transitionDepth = 0;
  private deliveringEvents = false;
  private finished = new Set<string>();
  private settings: NormalizedSettings;
  private offlineAssets = false;
  private rejectStartup?: (error: EngineError) => void;
  private disposed = false;
  private assetController?: AbortController;
  private adapter: WorkerEngineAdapter;
  private supervision: WorkerClientOptions;
  private descriptorSnapshot: WorkerEngineAdapter["descriptor"];
  private capabilitiesSnapshot: WorkerEngineAdapter["capabilities"];
  constructor(
    adapter: WorkerEngineAdapter,
    supervision: WorkerClientOptions = {},
  ) {
    this.adapter = adapter;
    this.descriptorSnapshot = structuredClone(adapter.descriptor);
    this.capabilitiesSnapshot = structuredClone(adapter.capabilities);
    this.supervision = supervision;
    for (const value of [
      supervision.initializationTimeoutMs,
      supervision.nodeOnlyWatchdogMs,
    ]) {
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value < 1 || value > 2_147_481_647)
      )
        throw new EngineError(
          "INVALID_OPTIONS",
          "Supervision deadlines must be positive integer milliseconds.",
        );
    }
    this.settings = structuredClone(adapter.configure({}));
  }
  get descriptor() {
    return structuredClone(this.descriptorSnapshot);
  }
  get capabilities() {
    return structuredClone(this.capabilitiesSnapshot);
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
    this.eventQueue.push({ event, listeners: new Set(this.listeners) });
    this.deliverEvents();
  }
  private transition<T>(operation: () => T): T {
    this.transitionDepth++;
    try {
      return operation();
    } finally {
      this.transitionDepth--;
      this.deliverEvents();
    }
  }
  private deliverEvents() {
    if (this.transitionDepth || this.deliveringEvents) return;
    this.deliveringEvents = true;
    try {
      while (this.eventQueue.length) {
        const { event, listeners } = this.eventQueue.shift()!;
        for (const listener of listeners) {
          try {
            listener(structuredClone(event));
          } catch {
            /* Consumer errors cannot break engine supervision. */
          }
        }
      }
    } finally {
      this.deliveringEvents = false;
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
    this.transition(() => {
      this.disposed = false;
      if (settings.fingerprint !== this.settings.fingerprint) {
        if (this.active) this.cancel(this.active.request.jobId);
        this.dropWorker();
        this.settings = settings;
      }
    });
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
    return this.transition(() => this.startAnalysis(request));
  }
  private startAnalysis(request: AnalyzeRequest): Promise<AnalysisResult> {
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
    return this.transition(() => this.cancelJob(jobId));
  }
  private cancelJob(jobId: string): ReturnType<ChessEngine["cancel"]> {
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
    this.transition(() => {
      if (this.active) this.cancel(this.active.request.jobId);
      this.dropWorker();
      this.finished.clear();
    });
  }
  dispose() {
    this.transition(() => {
      if (this.active) this.cancel(this.active.request.jobId);
      this.dropWorker();
      this.assets = undefined;
      this.disposed = true;
      this.listeners.clear();
      this.finished.clear();
    });
  }
  private remember(id: string) {
    this.finished.add(id);
    if (this.finished.size > 128)
      this.finished.delete(this.finished.values().next().value!);
  }
  private dropWorker(
    error = new EngineError("CANCELLED", "Engine startup was cancelled.", true),
  ) {
    this.generation++;
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = undefined;
    if (this.assetController) {
      this.assetController.abort();
      this.assetController = undefined;
      this.assets = undefined;
    }
    this.rejectStartup?.(error);
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
    this.dropWorker(error);
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
    let interrupt!: (error: EngineError) => void;
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = reject;
    });
    this.rejectStartup = interrupt;
    const deadline = setTimeout(
      () =>
        interrupt(
          new EngineError(
            "ENGINE_CRASHED",
            "The engine did not initialize before its startup deadline.",
            true,
          ),
        ),
      this.supervision.initializationTimeoutMs ?? 30_000,
    );
    const run = async () => {
      if (!this.assets) {
        const controller = new AbortController();
        this.assetController = controller;
        const loading = Promise.resolve()
          .then(() => this.adapter.loadAssets(controller.signal))
          .then(
            (asset) => {
              if (this.assetController === controller)
                this.assetController = undefined;
              return asset;
            },
            (error) => {
              if (this.assets === loading) this.assets = undefined;
              if (this.assetController === controller)
                this.assetController = undefined;
              throw error;
            },
          );
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
        const ready = () => {
          resolve();
        };
        worker.onerror = () => {
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
              data.type,
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
          reject(
            new EngineError(
              "UNSUPPORTED_BROWSER",
              "This browser cannot start a local engine worker.",
            ),
          );
        }
      });
    };
    const pending = Promise.race([run(), interrupted]);
    this.startup = pending;
    void pending.then(
      () => {
        clearTimeout(deadline);
        if (this.startup === pending) {
          this.startup = undefined;
          this.rejectStartup = undefined;
        }
      },
      (error) => {
        clearTimeout(deadline);
        if (this.startup === pending) {
          this.dropWorker(error instanceof EngineError ? error : undefined);
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
