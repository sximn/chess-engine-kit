import { run, packPackage, installApplication } from "./lib.mjs";
if (process.argv.length > 2) throw Error("example:setup takes no arguments");
run(process.execPath, ["scripts/build-package.mjs"]);
const packed = packPackage();
installApplication("minimal", packed.file, { inPlace: true });
console.log("Ready: npm --prefix examples/minimal run dev");
