import { createHash } from "node:crypto";
import { registry, type Channel } from "./metadata.ts";

export type RegistryRequest = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export type RegistryPackage = {
  versions: Record<
    string,
    { name: string; version: string; dist: { integrity?: string } }
  >;
  "dist-tags": Record<string, string>;
};

export async function readRegistryPackage(
  name: string,
  request: RegistryRequest = fetch,
): Promise<RegistryPackage | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await request(
        `${registry}/${encodeURIComponent(name)}`,
        { signal: AbortSignal.timeout(15000), cache: "no-store" },
      );
      if (response.status === 404) return null;
      if (!response.ok)
        throw Error(`npm registry returned HTTP ${response.status}`);
      const pkg = (await response.json()) as RegistryPackage;
      if (!pkg.versions || !pkg["dist-tags"])
        throw Error("npm registry returned an invalid package document");
      return pkg;
    } catch (error) {
      if (attempt >= 3)
        throw Error(
          `Could not read ${name} from the npm registry. No missing-version assumption was made.`,
          { cause: error },
        );
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

export function verifyRegistryArtifact(
  pkg: RegistryPackage,
  name: string,
  version: string,
  tarball: Uint8Array,
) {
  const published = pkg.versions[version];
  const integrity =
    "sha512-" + createHash("sha512").update(tarball).digest("base64");
  if (
    !published ||
    published.name !== name ||
    published.version !== version ||
    published.dist?.integrity !== integrity
  ) {
    throw Error(
      `${name}@${version} exists on npm with different bytes or metadata. It cannot be overwritten. Use the original workflow's verified artifact or prepare a new version.`,
    );
  }
  return integrity;
}

export function verifyRegistryChannel(
  pkg: RegistryPackage,
  version: string,
  channel: Channel,
) {
  if (pkg["dist-tags"][channel] !== version) {
    throw Error(
      `npm ${channel} does not point to ${version}. Inspect registry dist-tags before retrying; this workflow will not silently move an existing tag.`,
    );
  }
}

export function verifyChannelAdvance(
  pkg: RegistryPackage | null,
  version: string,
  channel: Channel,
) {
  const current = pkg?.["dist-tags"][channel];
  if (current && Bun.semver.order(version, current) <= 0) {
    throw Error(
      `npm ${channel} already points to ${current}. Choose a higher version; publishing must not roll the channel backward.`,
    );
  }
}
