import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../.local/playwright-results",
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
