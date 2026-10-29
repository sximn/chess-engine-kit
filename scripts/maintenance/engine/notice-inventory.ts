import path from "node:path";

export type DependencyUse = "build" | "wasm";

// Use Cargo's actual compilation units, not metadata.packages (which includes
// unused optional/target dependencies). Build scripts and proc macros run on the
// host; their notices are retained conservatively for generated code/data.
export function compilationInventory(
  output: string,
  targetDirectory: string,
  target: string,
  targetLibdir: string,
) {
  const packages = new Map<string, Set<DependencyUse>>();
  for (const line of output.split("\n")) {
    if (!line.startsWith("{")) continue;
    const message = JSON.parse(line);
    if (message.reason !== "compiler-artifact") continue;
    const uses = packages.get(message.package_id) ?? new Set<DependencyUse>();
    for (const file of message.filenames as string[]) {
      const relative = path.relative(targetDirectory, file);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw Error(`Artifact outside notice build directory: ${file}`);
      uses.add(relative.startsWith(target + path.sep) ? "wasm" : "build");
    }
    packages.set(message.package_id, uses);
  }

  // rustc --print=link-args quotes paths with Rust's Debug string formatting.
  // Read only archive arguments in the compiler's target libdir; host libraries
  // and Cargo-built archives must not select standard-library notices.
  const libraries = new Set<string>();
  for (const [quoted] of output.matchAll(/"(?:[^"\\]|\\.)*\.rlib"/g)) {
    const file: string = JSON.parse(quoted);
    if (path.dirname(file) !== targetLibdir) continue;
    const name = /^lib([a-zA-Z0-9_]+)-[a-f0-9]+\.rlib$/.exec(
      path.basename(file),
    )?.[1];
    if (!name) throw Error(`Unrecognized Rust archive: ${file}`);
    libraries.add(name);
  }
  if (
    !packages.size ||
    !libraries.has("std") ||
    !libraries.has("compiler_builtins")
  )
    throw Error("Missing Cargo artifacts or Rust link inputs in notice build");
  return { packages, libraries };
}

type RustPackage = { name: string; version: string; source?: string };

export function rustLibraryPackages(
  libraries: Set<string>,
  locked: RustPackage[],
): RustPackage[] {
  return [...libraries].sort().map((name) => {
    const matches = locked.filter((p) => p.name.replace(/-/g, "_") === name);
    if (matches.length !== 1)
      throw Error(
        `Cannot identify linked Rust crate ${name} in source lockfile`,
      );
    const { name: packageName, version, source } = matches[0];
    return { name: packageName, version, ...(source ? { source } : {}) };
  });
}
