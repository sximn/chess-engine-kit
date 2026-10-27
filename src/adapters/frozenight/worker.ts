/// <reference lib="webworker" />
import {
  API_VERSION,
  EngineError,
  type AnalyzeRequest,
  type RawResult,
} from "../../core/types.js";
import { instantiateEngine } from "./wasm.js";
import { validateResult, terminalResult } from "../../core/validation.js";
import { validateFrozenightRequest as validateRequest } from "./validation.js";
let engine: Awaited<ReturnType<typeof instantiateEngine>> | undefined;
let active: AnalyzeRequest | undefined;
let lastProgress = -Infinity;
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }) => {
  try {
    if (data.type === "initialize") {
      engine = await instantiateEngine(data.module, (result: RawResult) => {
        if (!active || performance.now() - lastProgress < 100) return;
        validateResult(
          result,
          active.position,
          active.multiPv,
          active.rootMoves,
        );
        lastProgress = performance.now();
        scope.postMessage({
          type: "progress",
          jobId: active.jobId,
          result,
          memoryBytes: engine?.exports.memory.buffer.byteLength ?? 0,
        });
      });
      scope.postMessage({ type: "ready", apiVersion: API_VERSION });
    } else if (data.type === "analyze") {
      if (!engine || active)
        throw new EngineError(
          "ENGINE_CRASHED",
          "Engine state is unavailable.",
          true,
        );
      validateRequest(data.request);
      active = data.request;
      lastProgress = -Infinity;
      const result =
        terminalResult(active!.position) ??
        engine.run({ ...active, hashMiB: data.hashMiB });
      if (result.error)
        throw new EngineError(
          result.error,
          "The engine rejected this request.",
          true,
        );
      validateResult(
        result,
        active!.position,
        active!.multiPv,
        active!.rootMoves,
      );
      scope.postMessage({
        type: "completed",
        jobId: active!.jobId,
        result,
        memoryBytes: engine.exports.memory.buffer.byteLength,
      });
      active = undefined;
    }
  } catch (error) {
    const e =
      error instanceof EngineError
        ? error
        : new EngineError(
            "ENGINE_CRASHED",
            "The local engine stopped unexpectedly.",
            true,
          );
    scope.postMessage({
      type: "failed",
      jobId: active?.jobId ?? data.request?.jobId,
      error: { code: e.code, message: e.message, retryable: e.retryable },
    });
    active = undefined;
  }
};
