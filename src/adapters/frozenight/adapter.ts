import { createWorkerEngine } from "../../core/client.js";
import {
  EngineError,
  type ChessEngine,
  type EngineOptions,
} from "../../core/types.js";
import { FROZENIGHT_CAPABILITIES } from "./capabilities.js";
import { FROZENIGHT_MANIFEST } from "./manifest.js";
import { assetUrl, loadFrozenightAssets } from "./assets.js";
import type { FrozenightAssetUrls, FrozenightOptions } from "./options.js";
import { validateFrozenightRequest } from "./validation.js";

export function createFrozenightAdapter(
  options: FrozenightOptions,
  urls: () => FrozenightAssetUrls,
): ChessEngine {
  const configure = (values: EngineOptions) => {
    if (Object.keys(values).some((key) => key !== "hashMiB")) {
      throw new EngineError("INVALID_OPTIONS", "Unknown Frozenight option.");
    }

    const hashMiB = values.hashMiB ?? options.hashMiB ?? 32;

    if (
      typeof hashMiB !== "number" ||
      !Number.isInteger(hashMiB) ||
      hashMiB < 16 ||
      hashMiB > 64
    ) {
      throw new EngineError(
        "INVALID_OPTIONS",
        "Hash memory must be between 16 and 64 MiB.",
      );
    }

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
      loadAssets: (signal) =>
        loadFrozenightAssets(
          FROZENIGHT_MANIFEST,
          urls().wasm,
          options.cacheAssets !== false,
          signal,
        ),
      createWorker:
        options.workerFactory ??
        (() =>
          new Worker(assetUrl(urls().worker), {
            type: "module",
            name: "Frozenight analysis",
          })),
      analysisMessage: (request, settings) => ({
        type: "analyze",
        request,
        hashMiB: settings.values.hashMiB,
      }),
    },
    options.supervision,
  );
}
