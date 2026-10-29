import type { FrozenightAssetUrls } from "./options.js";

// The package build injects literal, module-relative URL references so consuming
// bundlers can discover and emit the prebuilt assets, including their notices.
declare const __CHESS_ENGINE_ASSET_URLS__: () => FrozenightAssetUrls & {
  notices: Readonly<Record<string, URL>>;
};

export function frozenightAssetUrls(): FrozenightAssetUrls & {
  notices: Readonly<Record<string, URL>>;
} {
  return __CHESS_ENGINE_ASSET_URLS__();
}
