import fs from "node:fs";
import path from "node:path";
import { root } from "../lib.ts";
import { releaseArguments, validateRelease } from "./metadata.ts";

const { tag, channel } = releaseArguments(process.argv.slice(2));
const release = validateRelease(tag, channel);
fs.mkdirSync(path.join(root, ".build"), { recursive: true });
fs.writeFileSync(path.join(root, ".build/release-notes.md"), release.notes);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `commit=${release.commit}\nversion=${release.version}\n`,
  );
}
console.log(
  `Release inputs checked: ${release.name}@${release.version}, ${tag}, ${channel}, commit ${release.commit}. Nothing published.`,
);
