import type { ChessEngine } from "../../core/types.js";
import { createFrozenightAdapter } from "./adapter.js";
import type { FrozenightOptions } from "./options.js";
import { frozenightAssetUrls } from "./urls.js";

export function createFrozenight(options: FrozenightOptions = {}): ChessEngine {
  return createFrozenightAdapter(options, frozenightAssetUrls);
}
export { FROZENIGHT_MANIFEST as frozenightManifest } from "./manifest.js";
