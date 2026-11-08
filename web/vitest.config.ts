import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests for the pure helpers (no DOM). Browser behaviour is covered by Playwright (e2e/).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["lib/**/*.test.ts", "components/**/*.test.ts"], environment: "node" },
});
