import { fileURLToPath } from "node:url";

export default {
  entry: "./src/main.js",
  output: {
    path: fileURLToPath(new URL("./dist/", import.meta.url)),
    filename: "main.js",
    clean: true,
  },
  plugins: [
    {
      apply(compiler) {
        compiler.hooks.thisCompilation.tap("test-page", (compilation) => {
          compilation.hooks.processAssets.tap("test-page", () => {
            compilation.emitAsset(
              "index.html",
              new compiler.webpack.sources.RawSource(
                '<!doctype html><title>Webpack engine test</title><script defer src="./main.js"></script>',
              ),
            );
          });
        });
      },
    },
  ],
};
