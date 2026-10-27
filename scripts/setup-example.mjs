import { run, packPackage, installExample } from "./lib.mjs";
const name = process.argv[2] ?? "minimal";
run(process.execPath, ["scripts/build-package.mjs"]);
const packed = packPackage();
installExample(name, packed.file, { inPlace: true });
console.log(`Ready: npm --prefix examples/${name} run dev`);
