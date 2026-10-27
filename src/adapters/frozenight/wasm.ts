import { EngineError, type RawResult } from "../../core/types.js";
export type WasmExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  engine_alloc(length: number): number;
  engine_free(pointer: number, length: number): void;
  engine_run(pointer: number, length: number): void;
  engine_result_ptr(): number;
  engine_result_len(): number;
};
export async function instantiateEngine(
  module: WebAssembly.Module,
  progress: (value: RawResult) => void,
) {
  let exports: WasmExports;
  const decoder = new TextDecoder();
  const instance = await WebAssembly.instantiate(module, {
    env: {
      out_of_memory: () => {
        throw new EngineError(
          "OUT_OF_MEMORY",
          "The engine reached its memory limit. Retry analysis.",
          true,
        );
      },
      now_ms: () => performance.now(),
      emit_progress: (ptr: number, len: number) =>
        progress(
          JSON.parse(
            decoder.decode(new Uint8Array(exports.memory.buffer, ptr, len)),
          ),
        ),
    },
  });
  exports = instance.exports as WasmExports;
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    exports.memory.buffer instanceof SharedArrayBuffer
  )
    throw new Error("Unexpected shared engine memory");
  return {
    exports,
    run(input: unknown): RawResult {
      const bytes = new TextEncoder().encode(JSON.stringify(input));
      if (bytes.length > 65536) throw new Error("Engine request too large");
      const pointer = exports.engine_alloc(bytes.length);
      try {
        new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
        exports.engine_run(pointer, bytes.length);
        return JSON.parse(
          decoder.decode(
            new Uint8Array(
              exports.memory.buffer,
              exports.engine_result_ptr(),
              exports.engine_result_len(),
            ),
          ),
        );
      } finally {
        exports.engine_free(pointer, bytes.length);
      }
    },
  };
}
