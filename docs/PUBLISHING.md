# Versioning and publishing

`package.json` is the version source. Tarball names, engine metadata and example
verification follow it automatically. No release command embeds a package version.
Publication is always a separate, explicit command.

## Prepare

Verify package.json's repository, homepage and bugs URLs for
`sximn/chess-engine-kit`. Confirm you can publish the `chess-engine-kit` package
name. Configure an npm registry access token for Bun through `NPM_CONFIG_TOKEN`
or an existing `.npmrc`/`bunfig.toml` registry configuration, with publishing
access and any required 2FA. Ownership of the package name and registry
availability are not checked locally.

For a later release, choose a version bump (no automatic commit or Git tag):

```sh
bun run version:patch
# Or version:minor / version:major
# Or: bun pm version prerelease --preid=rc --no-git-tag-version
```

For the initial release, keep the current version if it has not been published.
Install development dependencies and browser binaries once, then prepare:

```sh
bun install --frozen-lockfile
bunx playwright install chromium firefox webkit
bun run release:prepare
bun run release:dry-run
```

Preparation runs `bun run check`, unit/engine tests, builds the package, and uses
`bun pm pack` to create a tarball. It installs the artifact in the browser test
app with Bun and the minimal example with npm, builds them, and runs the browser
suite. A separate lightweight patch-bump rehearsal checks the rebuilt SDK,
asset manifests and tarball identity in an isolated copy. Preparation writes
`.build/release.json` with the filename, version and SHA-256 of the verified
tarball. `.build/package.tgz` is a convenient local alias.

The dry run checks that release inputs and tarball still match the successful
preparation before invoking `bun publish <verified-tarball> --dry-run`. Bun requires
a token even for this local dry run, so the wrapper supplies a nonsecret
placeholder only when `--dry-run` is present. Real publication uses your registry
credentials. Changes to source, docs, examples, version or tarball require
preparation again. Review the packed contents
and `.build/reports/`. Commit the source and tag the chosen version when ready.

## Publish only when ready

```sh
bun pm whoami
bun run release:publish
```

This publishes the inspected tarball with public access and the `next` tag.
It does not rebuild. A previously published name/version cannot be overwritten.
For a release you intend to make the default install, explicitly choose:

```sh
bun run release:publish --tag latest
```

For manual tagging or registry inspection, use the current name/version from
package.json. Publishing requires account authentication; a successful dry run
does not prove publishing access to the package name. See Bun's
[publishing guide](https://bun.com/docs/pm/cli/publish) for authentication and
[package utilities](https://bun.com/docs/pm/cli/pm) for packing and versioning.
CI only prepares and dry-runs; it never publishes.

## Consume the release

```sh
bun add --exact chess-engine-kit@next
```

Follow the [README](../README.md) for asset copying and analysis, or copy the
[minimal example](../examples/minimal/README.md). Commit the resulting application
manifest/lockfile. Recheck your app's deployment base path, production build,
offline behavior and required devices before replacing an existing integration.
