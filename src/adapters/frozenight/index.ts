import { createWorkerEngine } from "../../core/client.js";
import {
  EngineError,
  type ChessEngine,
  type EngineOptions,
  type WorkerClientOptions,
} from "../../core/types.js";
import { FROZENIGHT_CAPABILITIES } from "./capabilities.js";
import { FROZENIGHT_MANIFEST } from "./manifest.js";
import { assetBaseUrl, assetUrl, loadFrozenightAssets } from "./assets.js";
import { frozenightAssetUrls, type FrozenightAssetUrls } from "./urls.js";
import { validateFrozenightRequest } from "./validation.js";
export type FrozenightOptions = {
  /** Override both URLs when the host manages asset delivery itself. */
  assetUrls?: FrozenightAssetUrls;
  /** Optional manually served folder; otherwise use the package's assets. */
  assetBaseUrl?: string | URL;
  hashMiB?: number;
  cacheAssets?: boolean;
  workerFactory?: () => Worker;
  supervision?: WorkerClientOptions;
};
export function createFrozenight(options: FrozenightOptions = {}): ChessEngine {
  if (options.assetUrls && options.assetBaseUrl !== undefined)
    throw new EngineError(
      "INVALID_OPTIONS",
      "Choose assetUrls or assetBaseUrl, not both.",
    );
  const urls = () => {
    if (options.assetUrls) return options.assetUrls;
    if (options.assetBaseUrl !== undefined) {
      const base = assetBaseUrl(options.assetBaseUrl);
      return {
        wasm: new URL(FROZENIGHT_MANIFEST.wasm.file, base),
        worker: new URL(FROZENIGHT_MANIFEST.worker.file, base),
      };
    }
    return frozenightAssetUrls();
  };
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
export { FROZENIGHT_MANIFEST as frozenightManifest } from "./manifest.js";
