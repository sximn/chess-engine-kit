import { EngineError, type ChessEngine } from "../../core/types.js";
import { assetBaseUrl } from "./assets.js";
import { createFrozenightAdapter } from "./adapter.js";
import { FROZENIGHT_MANIFEST } from "./manifest.js";
import type { FrozenightAssetUrls, FrozenightOptions } from "./options.js";

export type ManualFrozenightOptions = FrozenightOptions &
  (
    | { assetUrls: FrozenightAssetUrls; assetBaseUrl?: never }
    | { assetBaseUrl: string | URL; assetUrls?: never }
  );

export function createFrozenight(
  options: ManualFrozenightOptions,
): ChessEngine {
  if (
    !options ||
    (options.assetUrls !== undefined) === (options.assetBaseUrl !== undefined)
  ) {
    throw new EngineError(
      "INVALID_OPTIONS",
      "Provide either assetUrls or assetBaseUrl, not both.",
    );
  }

  return createFrozenightAdapter(options, () => {
    if (options.assetUrls !== undefined) {
      return options.assetUrls;
    }

    const base = assetBaseUrl(options.assetBaseUrl!);
    return {
      wasm: new URL(FROZENIGHT_MANIFEST.wasm.file, base),
      worker: new URL(FROZENIGHT_MANIFEST.worker.file, base),
    };
  });
}
