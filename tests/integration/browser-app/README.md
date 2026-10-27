# Browser package test app

This app installs the packed npm artifact and exposes engine checks to Playwright.
It is a test harness. The learning example lives in `examples/minimal/`.

The browser suite checks MultiPV, repetition history, 100 cancellation/replacement
cycles, offline reload and recovery after a corrupt WASM download. The app owns
its service worker and offline shell; the SDK does not register a service worker.

From the repository root:

```sh
npm run test:package
npm run test:browser
```

Package verification copies this app and the minimal example to `.build/apps/`,
installs their pinned tooling and the exact package tarball, then builds them.
Source manifests and lockfiles stay unchanged. This app is excluded from the
published npm package.

To inspect the built harness manually after package verification:

```sh
bun scripts/verification/serve-test-app.ts
```

Open `http://localhost:4175/review/` and click **Run engine checks**. The server
serves `.build/apps/browser-app/dist/`; rerun `npm run test:package` after changing
the harness. Stop the manual server before running Playwright, which starts its
own servers.
