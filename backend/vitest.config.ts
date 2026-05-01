import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globals: false,
    include: ["tests/**/*.test.ts"],
    reporters: "default",
    sequence: {
      shuffle: false,
    },
  },
});
