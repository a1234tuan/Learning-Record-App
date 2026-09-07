import { defineConfig, devices } from "@playwright/test";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/playwright",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4190",
    browserName: "chromium",
    launchOptions: { executablePath: chromePath },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "android-narrow", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "npm run dev -- --port 4190 --strictPort",
    url: "http://127.0.0.1:4190",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
