import { defineConfig } from "vitest/config";

/**
 * Vitest config kept separate from vite.config.ts so the test runner
 * doesn't drag in the Svelte plugin for plain Node tests.
 *
 * Server tests are pure Node — colocated with source as *.test.ts.
 * When/if we add Svelte component tests, override `environment`
 * per-file with /// @vitest-environment happy-dom (after installing it).
 */
export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: "default",
    testTimeout: 10_000,
  },
});
