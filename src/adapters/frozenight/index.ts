import { EngineError, type ChessEngine } from "../../core/types.js";
import { createFrozenightAdapter } from "./adapter.js";
import type { FrozenightOptions } from "./options.js";
import { frozenightAssetUrls } from "./urls.js";

export function createFrozenight(options: FrozenightOptions = {}): ChessEngine {
  const legacy = options as { assetUrls?: unknown; assetBaseUrl?: unknown };
  if (legacy.assetUrls !== undefined || legacy.assetBaseUrl !== undefined) {
    throw new EngineError(
      "INVALID_OPTIONS",
      "Use chess-engine-kit/frozenight/manual for assetUrls or assetBaseUrl.",
    );
  }
  return createFrozenightAdapter(options, frozenightAssetUrls);
}

export { FROZENIGHT_MANIFEST as frozenightManifest } from "./manifest.js";
