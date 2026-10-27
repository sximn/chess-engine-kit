import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import { createHash } from "node:crypto";

export const root = fileURLToPath(new URL("../", import.meta.url));

export const readPackage = () =>
  JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

export const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export function run(
  command: string,
  args: string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding"> & {
    encoding?: BufferEncoding;
  } = {},
) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    encoding: "utf8",
    ...options,
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  }

  return result;
}

export function reportPath(name: string) {
  const directory = path.join(root, ".build/reports");

  fs.mkdirSync(directory, { recursive: true });

  return path.join(directory, name);
}

export async function packPackage({
  cwd = root,
  destination = path.join(cwd, ".build"),
} = {}) {
  fs.mkdirSync(destination, { recursive: true });

  const pkg = JSON.parse(
    fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
  );

  const filename =
    pkg.name.replace(/^@/, "").replace("/", "-") + "-" + pkg.version + ".tgz";

  const file = path.join(destination, filename);

  run(
    "bun",
    ["pm", "pack", "--ignore-scripts", "--quiet", "--filename", file],
    { cwd },
  );

  // Inspect the archive itself instead of parsing a package manager's file list.
  const entries = await new Bun.Archive(fs.readFileSync(file)).files();

  const manifest = entries.get("package/package.json");
  if (!manifest) {
    throw Error("Packed package.json is missing");
  }

  const packed = JSON.parse(await manifest.text());
  if (packed.name !== pkg.name || packed.version !== pkg.version) {
    throw Error("Packed package identity does not match package.json");
  }

  fs.copyFileSync(file, path.join(destination, "package.tgz"));

  return {
    file,
    name: packed.name as string,
    version: packed.version as string,
    files: [...entries.keys()]
      .map((entry) => entry.replace(/^package\//, ""))
      .sort(),
    sha256: sha256(fs.readFileSync(file)),
  };
}

export const applications: Record<string, string> = {
  "browser-app": "tests/integration/browser-app",
  minimal: "examples/minimal",
};

export async function installApplication(
  name: string,
  tarball: string,
  { inPlace = false } = {},
) {
  if (!Object.hasOwn(applications, name)) {
    throw Error("Unknown application");
  }

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

  if (name === "minimal") {
    // Keep this example as the npm installation compatibility check.
    const options = {
      cwd: destination,
      env: { npm_config_cache: path.join(root, ".build/npm-cache") },
    };

    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], options);
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
      options,
    );
  } else {
    run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: destination,
    });
    run("bun", ["add", "--no-save", "--ignore-scripts", tarball], {
      cwd: destination,
    });
  }

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

  if (installed.version !== readPackage().version) {
    throw Error("Application installed the wrong package version");
  }

  const entries = await new Bun.Archive(fs.readFileSync(tarball)).files();

  for (const [entry, file] of entries) {
    const relative = entry.replace(/^package\//, "");
    const actual = fs.readFileSync(
      path.join(destination, "node_modules", readPackage().name, relative),
    );

    if (!actual.equals(Buffer.from(await file.arrayBuffer()))) {
      throw Error(
        "Installed package differs from the verified tarball: " +
          name +
          "/" +
          relative,
      );
    }
  }

  return destination;
}

export function releaseFingerprint() {
  const hash = createHash("sha256");
  const skip = new Set(["node_modules", "dist", ".build", "public"]);

  function walk(relative: string) {
    if (
      relative === path.join("src", "adapters", "frozenight", "manifest.ts")
    ) {
      return;
    }

    const file = path.join(root, relative);
    if (fs.statSync(file).isDirectory()) {
      for (const entry of fs.readdirSync(file).sort())
        if (!skip.has(entry)) {
          walk(path.join(relative, entry));
        }
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
  ]) {
    walk(entry);
  }

  return hash.digest("hex");
}
