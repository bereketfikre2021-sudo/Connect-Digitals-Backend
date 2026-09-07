import { defineConfig } from "vitest/config";
import { resolve } from "path";

const root = resolve(__dirname);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@cdpromo/shared": resolve(root, "src/shared/index.ts"),
    },
  },
  test: {
    root,
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
