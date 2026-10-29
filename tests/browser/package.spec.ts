import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { reportPath } from "../../scripts/lib.ts";

test("webpack consumes the package with its standard asset handling on a subpath", async ({
  page,
}) => {
  await page.goto("http://localhost:4179/webpack/");
  const result = await page.evaluate(() => (window as any).runEngineSmoke());
  expect(result.result.lines).toHaveLength(3);
  for (const url of result.notices) {
    expect(url).toContain("/webpack/");
    expect((await page.request.get(url)).ok()).toBe(true);
  }
});

test("development serves packaged assets from node_modules without copying", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const assets: string[] = [];
    page.on("request", (request) => {
      if (/\.(wasm|js)\?no-inline/.test(request.url()))
        assets.push(request.url());
    });
    await page.goto("http://localhost:4178/");
    const result = await page.evaluate(() => (window as any).runEngineSmoke());
    expect(result.result.lines).toHaveLength(3);
    expect(
      assets.some(
        (url) =>
          url.includes("/node_modules/chess-engine-kit/") &&
          url.includes(".wasm"),
      ),
    ).toBe(true);
    expect(
      assets.some(
        (url) =>
          url.includes("/node_modules/chess-engine-kit/") &&
          url.includes("worker-"),
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test("installed tarball runs real MultiPV and 100 cancellation/replacement cycles on a subpath", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  const result = await page.evaluate(() => (window as any).runEngineSmoke(100));
  expect(result.cycles).toBe(100);
  expect(result.terminalEvents).toBe(202);
  expect(result.result.lines).toHaveLength(3);
  expect(result.repetition.outcome).toBe("repetition");
  expect(result.sharedMemory).toBe(false);
  expect(result.assetUrls.wasm).toContain("/review/assets/");
  expect(result.assetUrls.worker).toContain("/review/assets/");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    reportPath(`browser-app-${info.project.name}.json`),
    JSON.stringify(result, null, 2),
  );
});

test("test app offline shell reloads and executes the installed package without origin traffic", async ({
  page,
  context,
}, info) => {
  let origin = "http://localhost:4175";
  let server: ReturnType<typeof spawn> | undefined;
  if (info.project.name === "webkit") {
    origin = "http://localhost:4176";
    server = spawn("bun", [
      "scripts/verification/serve-test-app.ts",
      "--port",
      "4176",
    ]);
    page.on("close", () => server?.kill());
    await once(server.stdout!, "data");
  }
  await page.goto(origin + "/review/");
  await page.getByRole("button", { name: "Run engine checks" }).click();
  await expect(page.getByRole("status")).toHaveText("All checks passed");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  // Playwright WebKit's setOffline bypasses service workers (upstream #42775).
  // Abort actual outgoing requests instead; cached SW replies still run.
  if (server) {
    server.kill();
    await once(server, "exit");
    await expect(fetch(origin + "/review/")).rejects.toThrow();
  } else await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Run engine checks" }).click();
  await expect(page.getByRole("status")).toHaveText("All checks passed");
  fs.writeFileSync(
    reportPath(`offline-${info.project.name}.json`),
    JSON.stringify(
      {
        completed: true,
        outage:
          info.project.name === "webkit"
            ? "isolated-origin-stopped"
            : "offline-emulation",
      },
      null,
      2,
    ),
  );
});

test("corrupt WASM fails closed and retry uses the verified binary", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await context.route("**/engine-*.wasm", (route) =>
    route.fulfill({ body: "corrupt wasm", contentType: "application/wasm" }),
  );
  await page.goto("http://localhost:4175/review/");
  await page.getByRole("button", { name: "Run engine checks" }).click();
  await expect(page.getByRole("status")).toContainText("SHA-256");
  await context.unroute("**/engine-*.wasm");
  await page.getByRole("button", { name: "Run engine checks" }).click();
  await expect(page.getByRole("status")).toHaveText("All checks passed");
  await context.close();
});
