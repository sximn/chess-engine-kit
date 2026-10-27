import fs from "node:fs";
import path from "node:path";
import http from "node:http";
const root = path.resolve("examples/consumer/dist"),
  base = "/review/";
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
server.listen(
  Number(process.argv[process.argv.indexOf("--port") + 1]) || 4175,
  "127.0.0.1",
  () => console.log("Consumer http://localhost:4175/review/"),
);
