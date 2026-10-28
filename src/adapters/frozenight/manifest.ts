import type { EngineAssetManifest } from "../../core/types.js";

// scripts/build-package.ts injects the generated manifest into the SDK bundle.
// This authored bridge keeps type checking independent of generated build files.
declare const __CHESS_ENGINE_MANIFEST__: EngineAssetManifest;
export const FROZENIGHT_MANIFEST: EngineAssetManifest =
  __CHESS_ENGINE_MANIFEST__;
