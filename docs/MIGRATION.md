# Later app migration (not performed by this extraction)

1. Install a pinned tarball/version and add `chess-engine-assets --to static/engines/frozenight` to the application build before Vite/Capacitor sync.
2. Create the provider in the browser and inject its `ChessEngine` interface into the app's review controller. Preserve the controller, PGN parser, classification thresholds, scheduling, UI and result database in the app.
3. Replace Frozenight `BUILD` imports in app cache keys with `engine.identity`. `engineCommit` maps to optional `sourceRevision`, and `networkHash` maps to optional `modelHash`. Include `engineId`, build, settings and exact budget/history in keys; retain the app classification policy version.
4. Initialization now returns identity plus `capabilities`, `settings` and `offlineAssets`. Frozenight hash configuration uses factory `hashMiB` or `initialize({engineOptions:{hashMiB:32}})`. Unsupported limits fail predictably. Other providers may report unknown depth/nodes as null, so classify uncertain results conservatively.
5. Register the app's own service worker and include the deployed engine assets. Native/document visibility handlers must pause/cancel through the engine interface; the SDK does not add global listeners.
6. Repeat app production/offline and Capacitor integration tests against the installed npm artifact. Only then remove duplicated engine sources, native reference tests and engine-build CI from the app.

The extraction leaves all existing app files, generated assets, requirements and evidence in place. It does not replace any app dependency or change its behavior.
