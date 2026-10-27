import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { reportPath } from "./lib.mjs";
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const apk = arg("--android"),
  app = arg("--ios");
if (!apk && !app)
  throw Error("Select --android <apk> and/or --ios <built-app>");
const root = ".build/consumers/consumer/dist",
  files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else files.push(path.relative(root, f));
  }
}
walk(root);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const file of files) {
  const expected = sha(fs.readFileSync(path.join(root, file)));
  if (
    apk &&
    sha(
      execFileSync("unzip", ["-p", apk, "assets/public/" + file], {
        maxBuffer: 16 * 1024 * 1024,
      }),
    ) !== expected
  )
    throw Error("Android mismatch: " + file);
  if (app && sha(fs.readFileSync(path.join(app, "public", file))) !== expected)
    throw Error("iOS mismatch: " + file);
}
fs.writeFileSync(
  reportPath("capacitor-assets.json"),
  JSON.stringify(
    {
      webFiles: files.length,
      allIdentical: true,
      androidBuilt: !!apk,
      iosBuilt: !!app,
      manifest: JSON.parse(
        fs.readFileSync(
          path.join(root, "engines/frozenight/manifest.json"),
          "utf8",
        ),
      ),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "All packaged Capacitor web assets match the installed npm consumer.",
);
