import { run, packPackage, installApplication } from "./lib.ts";
if (process.argv.length > 2) throw Error("example:setup takes no arguments");
run("bun", ["scripts/build-package.ts"]);
const packed = packPackage();
installApplication("minimal", packed.file, { inPlace: true });
console.log("Ready: npm --prefix examples/minimal run dev");
