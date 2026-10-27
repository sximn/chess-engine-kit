import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { root as projectRoot, applications } from "../lib.mjs";
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const app = option("--app", "browser-app");
if (!Object.hasOwn(applications, app)) throw Error("Unknown application");
const root = path.join(projectRoot, ".build/apps", app, "dist"),
  base = option("--base", "/review/");
const port = Number(option("--port", "4175"));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".txt": "text/plain",
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith(base)) {
    res.writeHead(404).end();
    return;
  }
  const rel =
    decodeURIComponent(url.pathname.slice(base.length)) || "index.html";
  const file = path.resolve(root, rel);
  if (
    !file.startsWith(root + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": types[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  res.end(fs.readFileSync(file));
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Test app http://localhost:${port}${base}`),
);
