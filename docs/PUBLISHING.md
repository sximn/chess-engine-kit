# Versioning and publishing

`package.json` is the version source. Tarball names, engine metadata and example
verification follow it automatically. No release command embeds a package version.
Publication is always a separate, explicit command.

## Prepare

Replace `REPLACE_ME` in package.json's repository, homepage and bugs URLs when the
repository is chosen. Dry runs allow placeholders; actual publication refuses
them. Confirm the package name/scope is yours and sign into npm with publishing
access and 2FA. Scope ownership/registry availability are not checked locally.

For a later release, choose a version bump (no automatic commit or Git tag):

```sh
npm run version:patch
# Or version:minor / version:major
# Or: npm version prerelease --preid=rc --no-git-tag-version
```

For the initial release, keep the current version if it has not been published.
Install development dependencies and browser binaries once, then prepare:

```sh
bun install --frozen-lockfile
bunx playwright install chromium firefox webkit
npm run release:prepare
npm run release:dry-run
```

Preparation type-checks, runs unit/engine tests, builds and packs the package,
installs the exact tarball in the browser test app and minimal example, builds
them, and runs the browser
suite. A separate lightweight patch-bump rehearsal checks the rebuilt SDK and
asset manifests and tarball identity in an isolated copy, without reinstalling
or rebuilding the applications. Preparation writes
`.build/release.json` with the filename, version and SHA-256 of
the verified tarball. `.build/package.tgz` is a convenient local alias.

The dry run checks that release inputs and tarball still match the successful
preparation before invoking `npm publish --dry-run`. Changes to source, docs,
examples, version or tarball require preparation again. Review the packed contents
and `.build/reports/`. Commit the source and tag the chosen version when ready.

## Publish only when ready

```sh
npm login
npm whoami
npm run release:publish
```

This publishes the inspected tarball with public access and the `next` tag.
It does not rebuild. A previously published name/version cannot be overwritten.
For a release you intend to make the default install, explicitly choose:

```sh
npm run release:publish -- --tag latest
```

For manual tagging or registry inspection, use the current name/version from
package.json. Publishing requires account authentication; a successful dry run
does not prove access to the scope. See npm's
[scoped publishing guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
and [publish command](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
CI only prepares and dry-runs; it never publishes. Future CI publishing can use
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Consume the release

```sh
npm install --save-exact @upapawn/chess-engine-runtime@next
```

Follow the [README](../README.md) for asset copying and analysis, or copy the
[minimal example](../examples/minimal/README.md). Commit the resulting application
manifest/lockfile. Recheck your app's deployment base path, production build,
offline behavior and required devices before replacing an existing integration.
