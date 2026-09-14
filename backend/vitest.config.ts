import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PostgresStore 整合測試可能跑在遠端 DB（SSH tunnel），每次往返較慢
    testTimeout: 30_000,
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
