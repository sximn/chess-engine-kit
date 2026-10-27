import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const readPackage = () =>
  JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
    env: {
      ...process.env,
      npm_config_cache:
        process.env.npm_config_cache ?? path.join(root, ".build/npm-cache"),
      ...options.env,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  return result;
}
export function reportPath(name) {
  const directory = path.join(root, ".build/reports");
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}
export function packPackage() {
  const directory = path.join(root, ".build");
  fs.mkdirSync(directory, { recursive: true });
  const result = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", directory],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const [packed] = JSON.parse(result.stdout);
  const pkg = readPackage();
  if (packed.name !== pkg.name || packed.version !== pkg.version)
    throw Error("Packed package identity does not match package.json");
  const file = path.join(directory, packed.filename);
  fs.copyFileSync(file, path.join(directory, "package.tgz"));
  return {
    file,
    name: pkg.name,
    version: pkg.version,
    files: packed.files.map((entry) => entry.path),
    sha256: sha256(fs.readFileSync(file)),
  };
}
export const applications = {
  "browser-app": "tests/integration/browser-app",
  minimal: "examples/minimal",
};
export function installApplication(name, tarball, { inPlace = false } = {}) {
  if (!Object.hasOwn(applications, name)) throw Error("Unknown application");
  const source = path.join(root, applications[name]);
  const destination = inPlace ? source : path.join(root, ".build/apps", name);
  if (!inPlace) {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(source, destination, {
      recursive: true,
      filter: (file) =>
        !["node_modules", "dist", "public"].includes(path.basename(file)),
    });
  }
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: destination,
  });
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-save",
      "--package-lock=false",
      tarball,
    ],
    { cwd: destination },
  );
  const installed = JSON.parse(
    fs.readFileSync(
      path.join(
        destination,
        "node_modules",
        readPackage().name,
        "package.json",
      ),
      "utf8",
    ),
  );
  if (installed.version !== readPackage().version)
    throw Error("Application installed the wrong package version");
  return destination;
}
export function releaseFingerprint() {
  const hash = createHash("sha256");
  const skip = new Set(["node_modules", "dist", ".build", "public"]);
  function walk(relative) {
    if (relative === path.join("src", "adapters", "frozenight", "manifest.ts"))
      return;
    const file = path.join(root, relative);
    if (fs.statSync(file).isDirectory()) {
      for (const entry of fs.readdirSync(file).sort())
        if (!skip.has(entry)) walk(path.join(relative, entry));
    } else {
      hash.update(relative);
      hash.update("\0");
      hash.update(fs.readFileSync(file));
      hash.update("\0");
    }
  }
  for (const entry of [
    "package.json",
    "bun.lock",
    "tsconfig.json",
    "tsconfig.build.json",
    "playwright.config.ts",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "src",
    "bin",
    "scripts",
    "docs",
    "tests",
    "examples",
    "assets",
  ])
    walk(entry);
  return hash.digest("hex");
}
