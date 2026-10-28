# Versioning and publishing

Releases are manual. Pushing commits or tags never publishes a package. The
**Publish package (manual)** GitHub workflow defaults to **verification only**;
publication requires selecting its publish checkbox. Run it from the release tag
so npm provenance identifies the same commit that was built.

`package.json` is the version source. The workflow checks the matching Git tag,
changelog entry, source commit, engine build inputs and verified tarball. Bun builds and
tests the package; npm uploads the already-tested tarball without rebuilding it.

## One-time setup

1. Merge `.github/workflows/publish.yml` onto the repository's default branch.
   It must also be present in every release tag you intend to publish.
2. In GitHub **Settings → Environments**, create an environment named `npm`.
   Allow release tags (`v*`) to deploy to it. If you choose to require reviewers,
   the publication job waits for that environment's approval.
3. Verify that `package.json` names the package you own and that its repository,
   homepage and bugs URLs refer to `sximn/chess-engine-kit`. The workflow validates
   `repository.url` against the repository it is running in. Publication always
   targets `https://registry.npmjs.org`.
4. Configure npm authentication using the appropriate path below.

### First-ever publication of the package

npm requires the package to exist before a trusted publisher can be configured.
If `chess-engine-kit` has never been published:

1. Confirm that the package name is available and that your npm account can
   create it. Create a short-lived granular npm token with permission to create
   and publish this package. It must support noninteractive publication under
   your account's 2FA policy; enable bypass 2FA for this bootstrap token if needed.
2. Add it as the **`NPM_TOKEN` secret in the GitHub `npm` environment**. Do not
   commit the token. The workflow exposes it only to the npm publication step.
3. Follow the normal release steps below, first verifying and then explicitly
   publishing. If the package is absent and the token is missing, publication
   stops with an explanation before attempting an upload.
4. After the first successful publication, configure the trusted publisher below,
   remove the environment secret and revoke the bootstrap token.

A dry run checks packaging; it cannot prove account ownership or publishing
permission. npm enforces those permissions during the real upload. See npm's
[access token documentation](https://docs.npmjs.com/about-access-tokens/).

### Subsequent publications: npm trusted publisher

In the npm package's **Settings → Trusted publishing**, add a GitHub Actions
publisher with these exact values:

| Setting              | Value                                       |
| -------------------- | ------------------------------------------- |
| Organization or user | `sximn`                                     |
| Repository           | `chess-engine-kit`                          |
| Workflow filename    | `publish.yml`                               |
| Environment          | `npm`                                       |
| Allowed action       | Allow direct publication with `npm publish` |

npm's default stage-only permission does not authorize this workflow's direct
publish command. Configure a new relationship shortly before the next real
release: npm currently expires unvalidated relationships after two days. This
workflow deliberately does not use staged publishing.

The publication job has `id-token: write` and uses npm's OIDC authentication on a
GitHub-hosted runner. It needs npm >=11.5.1; Node 24 supplies a compatible npm and
the script checks the version. Public repositories publish with provenance;
private source repositories cannot provide npm provenance. No npm token is
needed after bootstrap. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Prepare a release

1. Choose the version. Keep `0.0.1` for the initial release if it has not been
   published; for later releases run one of:

   ```sh
   bun run version:patch
   # Or: bun run version:minor / bun run version:major
   # Prerelease: bun pm version prerelease --preid=rc --no-git-tag-version
   ```

   These commands change the version without committing or tagging.

2. In [CHANGELOG.md](../CHANGELOG.md), move the release's user-facing notes from
   `Unreleased` into a dated entry matching that version. Keep `Unreleased` for
   future work. For example:

   ```md
   ## [Unreleased]

   ## [0.0.1] - 2026-10-28

   ### Added

   - Initial experimental browser chess analysis SDK.
   ```

   Use the actual release preparation date. Include API changes, fixes, breaking
   changes and migration steps. Engine/model updates should identify the changed
   revision and any behavior or deployment implications. The workflow rejects a
   missing or duplicated version heading, an invalid date, empty release notes,
   and TODO/TBD placeholders. It uses this entry as the GitHub release body.

3. If engine source, model or dependencies changed, review the source/model pins,
   notices and reference fixtures as described in the
   [development guide](DEVELOPMENT.md#engine-changes). Commit the authored inputs,
   reviewed licensing records and intentional fixture updates. Compiled WASM and
   generated manifests stay out of Git; CI creates and independently rebuilds them.

4. Commit and merge the version, changelog and implementation onto the default
   branch. Create and push the exact `v<version>` tag on that merged commit:

   ```sh
   git switch main
   git pull --ff-only
   git tag -a v0.0.1 -m "Release v0.0.1"
   git push origin v0.0.1
   ```

   Substitute your chosen version. Do not move a release tag after verification
   or publication; fix a released problem in a new version.

## Verify in GitHub, then explicitly publish

1. Open **Actions → Publish package (manual) → Run workflow**.
2. In **Use workflow from**, choose the release **tag**, for example `v0.0.1`.
   Choosing the default branch fails with a message telling you to select a tag.
   The tag's commit must belong to the default branch.
3. Choose the npm channel: `next` for experimental releases, or `latest` to make
   the version the default install. Versions such as `0.1.0-rc.1` must use `next`.
4. Leave **Publish to npm and create a GitHub release** unchecked and run.
5. Review the successful run's summary and `verified-release` artifact. It contains
   the tarball, release receipt, changelog notes and verification reports.
6. When ready, run the workflow again **from the same tag with the same channel**,
   this time selecting the publish checkbox. This run repeats verification and
   publishes its own verified tarball. It never substitutes an unverified build.

No browser dependencies or Rust toolchain need to be installed on your computer
for this route. GitHub installs the pinned Bun/Rust toolchains and browser suite.
The workflow serializes release runs and does not cancel an upload in progress.
New publications must advance their selected channel; an older version cannot
silently roll `next` or `latest` backward.

Preparation forces a fresh engine build from the tagged sources using the pinned
Linux x86_64 toolchain, then compares it with an independent source rebuild.
It verifies reviewed notices and live native parity, checks source types, rehearses
a version bump, installs/builds the npm tarball with npm and Bun, and runs
Chromium/Firefox/WebKit tests. The exact engine files embedded in the tarball must
match the independently verified build. Git is never used as a store of compiled
outputs, and generation never dirties the source checkout.

The release receipt binds package identity, source commit/fingerprint, tarball
SHA-256 and the engine-verification record's SHA-256. The engine record includes
the input key, compiler/source identities and the hash of every generated asset.

The publish job downloads that run's artifact and checks the tag, source, engine
verification and receipt again. It extracts and validates the engine, worker,
notices and deployment manifest inside that tarball against the sealed proof;
this job has no Rust toolchain or local engine cache. It uploads the verified tarball with lifecycle
scripts disabled, then checks the registry's SHA-512 integrity and selected
dist-tag. The run summary records the actual registry tags. On a package's
first-ever publication, `latest` may also be assigned even when publishing with
`next`; do not assume the first release is excluded from default installs. See
[Bun's documented registry tag behavior](https://bun.com/docs/pm/cli/publish#--tag).

After npm verification succeeds, a separate job creates a GitHub release using
the changelog entry and attaches the tarball, receipt, independent engine proof
and publication evidence. The npm tarball contains the compiled WASM and all
runtime assets; installing the package requires no Rust or Docker.
`next` releases are marked as GitHub prereleases; `latest` releases are normal
GitHub releases. No GitHub release is announced before npm is verified.

## If a release fails

- **Missing notes, mismatched tag/version, source/rebuild mismatches or failed tests:**
  nothing is uploaded. Correct and commit the inputs. Use a new tag/version if
  the original release was published; otherwise replace an unpublished candidate
  tag only after confirming no publication occurred, then verify it again.
- **Authentication fails:** check the `npm` environment secret for bootstrap, or
  the trusted publisher's exact repository/workflow/environment and direct-publish
  permission. `npm whoami` does not validate OIDC publishing permission.
- **npm may have accepted the upload, but the job failed afterward:** use
  **Re-run failed jobs** on the original publish-enabled run. The job reuses its
  original artifact. If that exact package version and bytes already exist on
  the requested channel, it verifies them and resumes without another upload.
  Different bytes, or a channel pointing elsewhere, stop the retry for review.
- **Only GitHub release creation failed:** re-run failed jobs. The final job can
  finish an existing draft or reuse the matching release and reattach its files.
  It refuses to overwrite release notes that differ from the tagged changelog.
- **The original run's artifact expired:** artifacts are retained for 30 days.
  Recover the exact tarball from the original release/retained artifact, or review
  the published package and complete release records manually. A newly built
  archive with different bytes cannot replace the published version. Do not
  blindly bump a version or move a dist-tag to conceal a partial publication.

A workflow failure after an npm upload does not undo publication. Inspect the npm
version and workflow evidence before deciding what to do. Diagnostic reports and
browser traces are attached to failed verification runs.

## Optional local verification

For development, install dependencies and browser binaries once, then run:

```sh
bun install --frozen-lockfile
bunx playwright install chromium firefox webkit
bun run release:prepare
bun run release:dry-run
```

Set up the canonical compiler and host native Rust toolchain as described in the
[development guide](DEVELOPMENT.md#first-source-build). Unlike an ordinary SDK
build, `release:prepare` deliberately bypasses the generated-asset cache and runs
a fresh build, independent rebuild and live native reference checks. It requires
no release tag, clean checkout or registry credentials for this local rehearsal. `release:dry-run`
validates its receipt and invokes `npm publish <verified-tarball> --dry-run`.
It uploads nothing and needs no placeholder token.

For a tagged release candidate, check its metadata locally with:

```sh
bun run release:check --tag v0.0.1 --channel next
```

Real publication also requires current `engine:verify` evidence, a clean checkout
and the matching tag. Use the GitHub workflow for releases; the underlying
`release:publish --release-tag v<version> --tag next|latest` command is available
for recovery by maintainers with npm credentials. It enforces the same artifact,
source, changelog, engine and registry checks. It does not create a GitHub release.

All tracked source files must be clean for real publication; generated outputs
live under ignored directories. Source, model, toolchain, documentation, fixture
or workflow changes invalidate the release receipt. Ordinary local builds reuse
the engine cache when only SDK code or package versions change; preparation
always verifies fresh engine outputs before sealing a publishable artifact.

## Consume the release

```sh
bun add --exact chess-engine-kit@next
```

Follow the [README](../README.md) for asset copying and analysis, or copy the
[minimal example](../examples/minimal/README.md). Commit the application's manifest
and lockfile. Recheck deployment base paths, production builds, offline behavior
and required devices before replacing an existing integration.
