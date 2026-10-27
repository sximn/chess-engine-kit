import { createWorkerEngine } from "../../core/client.js";
import {
  EngineError,
  type ChessEngine,
  type EngineOptions,
  type WorkerClientOptions,
} from "../../core/types.js";
import { FROZENIGHT_CAPABILITIES } from "./capabilities.js";
import { FROZENIGHT_MANIFEST } from "./manifest.js";
import { assetBaseUrl, loadFrozenightAssets } from "./assets.js";
import { validateFrozenightRequest } from "./validation.js";
export type FrozenightOptions = {
  assetBaseUrl?: string | URL;
  hashMiB?: number;
  cacheAssets?: boolean;
  workerFactory?: () => Worker;
  supervision?: WorkerClientOptions;
};
export function createFrozenight(options: FrozenightOptions = {}): ChessEngine {
  const base = options.assetBaseUrl ?? "/engines/frozenight/";
  const configure = (values: EngineOptions) => {
    if (Object.keys(values).some((key) => key !== "hashMiB"))
      throw new EngineError("INVALID_OPTIONS", "Unknown Frozenight option.");
    const hashMiB = values.hashMiB ?? options.hashMiB ?? 32;
    if (
      typeof hashMiB !== "number" ||
      !Number.isInteger(hashMiB) ||
      hashMiB < 16 ||
      hashMiB > 64
    )
      throw new EngineError(
        "INVALID_OPTIONS",
        "Hash memory must be between 16 and 64 MiB.",
      );
    return {
      values: { hashMiB },
      fingerprint: `api1:frozenight:scalar:cold-hash:hash${hashMiB}:rules1`,
    };
  };
  return createWorkerEngine(
    {
      descriptor: FROZENIGHT_MANIFEST.descriptor,
      capabilities: FROZENIGHT_CAPABILITIES,
      configure,
      validateRequest: validateFrozenightRequest,
      loadAssets: () =>
        loadFrozenightAssets(
          FROZENIGHT_MANIFEST,
          base,
          options.cacheAssets !== false,
        ),
      createWorker:
        options.workerFactory ??
        (() =>
          new Worker(
            new URL(FROZENIGHT_MANIFEST.worker.file, assetBaseUrl(base)),
            { type: "module", name: "Frozenight analysis" },
          )),
      analysisMessage: (request, settings) => ({
        type: "analyze",
        request,
        hashMiB: settings.values.hashMiB,
      }),
    },
    options.supervision,
  );
}
export { FROZENIGHT_MANIFEST as frozenightManifest } from "./manifest.js";
