# Browser package test app

This app installs the packed npm artifact and exposes engine checks to Playwright.
It is a test harness. The learning example lives in `examples/minimal/`.

The browser suite checks development loading directly from `node_modules`,
automatic and manual entry points, MultiPV, repetition history, 100 cancellation/replacement
cycles, offline reload and recovery after a corrupt WASM download. The app owns
its service worker and offline shell; the SDK does not register a service worker.

From the repository root:

```sh
bun run test:package
bun run test:browser
```

Package verification copies this app and the minimal example to `.build/apps/`,
installs this app's pinned tooling from `bun.lock` with Bun and the minimal
example with npm, installs the exact package tarball in both, then builds them.
This app's build runs `bun run check` (Bun's native checker) against the installed
package before bundling. Source manifests and lockfiles stay unchanged. This app
is excluded from the published npm package.

A separate webpack consumer verifies the same package using standard URL asset
handling, including analysis and deployed license URLs, without a package plugin.

To inspect the built harness manually after package verification:

```sh
bun scripts/verification/serve-test-app.ts
```

Open `http://localhost:4175/review/` and click **Run engine checks**. The server
serves `.build/apps/browser-app/dist/`; rerun `bun run test:package` after changing
the harness. Stop the manual server before running Playwright, which starts its
own servers.
