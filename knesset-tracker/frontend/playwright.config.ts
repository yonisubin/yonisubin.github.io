import { defineConfig, devices } from "@playwright/test";

// Expects the app on BASE_URL (default http://localhost:8000), serving frontend/dist with a
// database seeded by `python -m scripts.seed_fixtures`. CI starts both.
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:8000", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
