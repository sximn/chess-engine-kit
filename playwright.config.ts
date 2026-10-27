import { defineConfig, devices } from "@playwright/test";
import { reportPath } from "./scripts/lib.ts";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 120000,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: reportPath("browser-results.json") }],
  ],
  use: { baseURL: "http://localhost:4175/review/", trace: "retain-on-failure" },
  webServer: [
    {
      command: "bun scripts/verification/serve-test-app.ts",
      url: "http://localhost:4175/review/",
      reuseExistingServer: false,
    },
    {
      command:
        "bun scripts/verification/serve-test-app.ts --app minimal --base /minimal/ --port 4177",
      url: "http://localhost:4177/minimal/",
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
