import type { EngineCapabilities } from "../../core/types.js";
export const FROZENIGHT_CAPABILITIES: EngineCapabilities = {
  backend: "wasm",
  threads: 1,
  sharedMemory: false,
  maxMultiPv: 3,
  history: "full",
  rootMoves: true,
  limits: {
    nodes: { min: 1000, max: 10000000 },
    timeMs: { min: 10, max: 30000 },
    depth: { min: 1, max: 40 },
  },
  hashMemoryMiB: { min: 16, max: 64 },
  maximumLinearMemoryMiB: 256,
};
