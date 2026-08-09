import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    // The root suite is browser-side; Cloud Functions use Node's built-in runner from functions/.
    include: ["src/**/*.{test,spec}.{js,ts,jsx,tsx}"],
  },
});
