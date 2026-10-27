// Test app offline shell: the SDK never installs a service worker.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative("dist", p));
  }
}
walk("dist");
const hash = createHash("sha256");
for (const file of files) {
  hash.update(file);
  hash.update(fs.readFileSync("dist/" + file));
}
fs.writeFileSync(
  "dist/service-worker.js",
  `const ROOT=new URL('./',self.location.href),CACHE='engine-browser-test-${hash.digest("hex").slice(0, 12)}',FILES=${JSON.stringify(files)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new URL(f,ROOT).href))).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||!e.request.url.startsWith(ROOT.href))return;e.respondWith(caches.open(CACHE).then(async c=>(await c.match(e.request,{ignoreSearch:true}))||fetch(e.request).catch(()=>c.match(new URL('index.html',ROOT).href))));});`,
);
