import { EngineError, type EngineAssetManifest } from "../../core/types.js";
export function assetBaseUrl(value: string | URL): URL {
  if (typeof location === "undefined")
    throw new EngineError(
      "UNSUPPORTED_BROWSER",
      "Initialize the engine in a browser or Capacitor WebView.",
    );
  const raw = String(value);
  const base = new URL(raw.endsWith("/") ? raw : raw + "/", location.href);
  if (
    base.protocol !== location.protocol ||
    base.host !== location.host ||
    base.search ||
    base.hash
  )
    throw new EngineError(
      "INVALID_OPTIONS",
      "Engine assets must be served from a folder on the application origin.",
    );
  return base;
}
async function digest(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function loadFrozenightAssets(
  manifest: EngineAssetManifest,
  base: string | URL,
  useCache: boolean,
) {
  if (
    typeof WebAssembly === "undefined" ||
    typeof Worker === "undefined" ||
    !globalThis.crypto?.subtle
  )
    throw new EngineError(
      "UNSUPPORTED_BROWSER",
      "This environment cannot run local WebAssembly analysis.",
    );
  const url = new URL(manifest.wasm.file, assetBaseUrl(base)).href;
  let cache: Cache | undefined;
  if (useCache)
    try {
      cache = await caches.open("chess-engine-runtime-assets-v1");
    } catch {
      /* Installed assets still work without CacheStorage. */
    }
  let cached: ArrayBuffer | undefined;
  try {
    const hit = await cache?.match(url);
    if (hit) cached = await hit.arrayBuffer();
  } catch {
    cache = undefined;
  }
  if (cached) {
    if (
      cached.byteLength === manifest.wasm.bytes &&
      (await digest(cached)) === manifest.wasm.sha256
    )
      return {
        initialization: { type: "initialize", module: await compile(cached) },
        offlineAssets: true,
      };
    try {
      await cache?.delete(url);
    } catch {
      cache = undefined;
    }
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30000);
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(url, {
      cache: "reload",
      signal: abort.signal,
    });
    if (!response.ok)
      throw new EngineError(
        "ASSET_FETCH_FAILED",
        "The packaged engine asset is unavailable.",
        true,
      );
    bytes = await response.arrayBuffer();
  } catch (error) {
    throw error instanceof EngineError
      ? error
      : new EngineError(
          "ASSET_FETCH_FAILED",
          "Could not load the packaged engine asset.",
          true,
        );
  } finally {
    clearTimeout(timer);
  }
  if (
    bytes.byteLength !== manifest.wasm.bytes ||
    (await digest(bytes)) !== manifest.wasm.sha256
  )
    throw new EngineError(
      "INTEGRITY_FAILED",
      "The engine asset failed SHA-256 verification.",
      true,
    );
  let offlineAssets = false;
  try {
    if (cache) {
      await cache.put(
        url,
        new Response(bytes, {
          headers: { "Content-Type": "application/wasm" },
        }),
      );
      offlineAssets = true;
    }
  } catch {
    /* Quota cannot disable the current session. */
  }
  return {
    initialization: { type: "initialize", module: await compile(bytes) },
    offlineAssets,
  };
}
async function compile(bytes: ArrayBuffer) {
  try {
    return await WebAssembly.compile(bytes);
  } catch {
    throw new EngineError(
      "UNSUPPORTED_BROWSER",
      "This environment cannot compile the engine.",
    );
  }
}
