# Webpack package test app

Installs the packed SDK and uses webpack 5's built-in `new URL(...,
import.meta.url)` asset handling. There are no engine loaders, copy steps or
package-specific webpack plugins. The small inline plugin only creates the HTML
test page. Package verification checks that WASM and licenses retain their bytes;
Playwright runs real MultiPV analysis and fetches the license URLs on a subpath.

Run `bun run test:package` followed by `bun run test:browser` from the repository
root. This fixture and its tooling are not included in the npm package.
