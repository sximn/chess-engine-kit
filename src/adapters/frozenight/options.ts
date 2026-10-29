import type { WorkerClientOptions } from "../../core/types.js";

export type FrozenightAssetUrls = {
  wasm: string | URL;
  worker: string | URL;
};

export type FrozenightOptions = {
  hashMiB?: number;
  cacheAssets?: boolean;
  workerFactory?: () => Worker;
  supervision?: WorkerClientOptions;
};
