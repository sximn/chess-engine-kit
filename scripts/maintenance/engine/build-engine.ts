import { ensureEngine } from "./engine-cache.ts";
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--force") || args.length > 1)
  throw Error("Use engine:build [--force].");
ensureEngine({ force: args.includes("--force") });
